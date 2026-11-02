const request = require("supertest");
const { buildApp, prisma, RATE_LIMITS } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

// The real limits (windows and messages), with `limits` replacing some of the
// numbers so a test can reach them; the others stay out of reach.
const limitsWith = (limits) =>
  Object.fromEntries(
    Object.entries(RATE_LIMITS).map(([name, value]) => [
      name,
      { ...value, limit: limits[name] ?? 1_000_000 },
    ]),
  );

const signup = (app, email) =>
  request(app).post("/signup").send({ email, password: "password123" });
const login = (app, email, password) => request(app).post("/login").send({ email, password });

test("the real limits, as announced in the RateLimit-Policy header", async () => {
  const app = buildApp({ rateLimits: RATE_LIMITS });

  const res = await login(app, "ada@example.com", "password123");

  const policy = res.headers["ratelimit-policy"];
  expect(policy).toMatch(/"general"; q=1000; w=300;/); // per 5 minutes
  expect(policy).toMatch(/"auth"; q=30; w=900;/); // per 15 minutes
  expect(policy).toMatch(/"failed-logins"; q=10; w=900;/);
});

describe("signups and logins", () => {
  test("share one count; past the limit they get 429 RATE_LIMITED with Retry-After", async () => {
    const app = buildApp({ rateLimits: limitsWith({ auth: 3 }) });
    expect((await signup(app, "ada@example.com")).status).toBe(201);
    expect((await signup(app, "bob@example.com")).status).toBe(201);
    expect((await login(app, "ada@example.com", "password123")).status).toBe(200);

    const res = await signup(app, "cy@example.com");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Too many sign-up and login attempts. Try again in 15 minutes.",
      code: "RATE_LIMITED",
    });
    // Seconds until the count resets, 15 minutes after the first attempt.
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(14 * 60);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(15 * 60);
    // The refused signup never ran.
    await expect(prisma.user.count()).resolves.toBe(2);
  });

  test("other routes aren't affected by the signup and login limit", async () => {
    const app = buildApp({ rateLimits: limitsWith({ auth: 1 }) });
    const { body } = await signup(app, "ada@example.com").expect(201);
    expect((await login(app, "ada@example.com", "password123")).status).toBe(429);

    const res = await request(app).get("/capsules").set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(200);
  });
});

describe("failed logins", () => {
  test("only failures count; once over the limit, even the right password waits", async () => {
    const app = buildApp({ rateLimits: limitsWith({ failedLogins: 2 }) });
    await signup(app, "ada@example.com").expect(201);

    for (let i = 0; i < 4; i++) {
      expect((await login(app, "ada@example.com", "password123")).status).toBe(200);
    }
    expect((await login(app, "ada@example.com", "wrong-password")).status).toBe(401);
    expect((await login(app, "nobody@example.com", "password123")).status).toBe(401);

    const res = await login(app, "ada@example.com", "password123");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Too many failed logins. Try again in 15 minutes.",
      code: "RATE_LIMITED",
    });
  });
});

describe("the general limit", () => {
  test("covers every route, unknown ones included", async () => {
    const app = buildApp({ rateLimits: limitsWith({ general: 2 }) });
    await request(app).get("/").expect(200);
    await request(app).get("/capsules").expect(401);

    const res = await request(app).get("/no-such-route");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Too many requests. Try again in 5 minutes.",
      code: "RATE_LIMITED",
    });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("doesn't count the browser's CORS preflight requests", async () => {
    const app = buildApp({ rateLimits: limitsWith({ general: 1 }) });

    for (let i = 0; i < 3; i++) {
      await request(app)
        .options("/capsules")
        .set("Origin", "http://localhost:3000")
        .set("Access-Control-Request-Method", "POST")
        .expect(204);
    }

    await request(app).get("/").expect(200);
  });
});

describe("which address a request counts against", () => {
  const from = (app, forwardedFor) => request(app).get("/").set("X-Forwarded-For", forwardedFor);

  test("behind one proxy (TRUST_PROXY=1), each caller has its own count", async () => {
    const app = buildApp({ trustProxy: 1, rateLimits: limitsWith({ general: 1 }) });

    expect((await from(app, "203.0.113.1")).status).toBe(200);
    expect((await from(app, "203.0.113.1")).status).toBe(429);
    expect((await from(app, "203.0.113.2")).status).toBe(200);
  });

  test("behind one proxy, a caller can't dodge the limit with a forged X-Forwarded-For", async () => {
    const app = buildApp({ trustProxy: 1, rateLimits: limitsWith({ general: 1 }) });

    // The proxy appends the address it saw (last); anything before it came from the caller.
    expect((await from(app, "198.51.100.7, 203.0.113.1")).status).toBe(200);
    expect((await from(app, "198.51.100.8, 203.0.113.1")).status).toBe(429);
  });

  test("IPv6 addresses in the same /56 block share a count", async () => {
    const app = buildApp({ trustProxy: 1, rateLimits: limitsWith({ general: 1 }) });

    expect((await from(app, "2001:db8:abcd:1200::1")).status).toBe(200);
    expect((await from(app, "2001:db8:abcd:12ff::2")).status).toBe(429);
    expect((await from(app, "2001:db8:abcd:1300::1")).status).toBe(200);
  });

  test("with no proxy (TRUST_PROXY=0), X-Forwarded-For is ignored and reported", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp({ trustProxy: 0, rateLimits: limitsWith({ general: 1 }) });

    expect((await from(app, "203.0.113.1")).status).toBe(200);
    expect((await from(app, "203.0.113.2")).status).toBe(429);
    // A hint, in the server's log, that TRUST_PROXY may be set wrong.
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR" }),
    );
  });
});

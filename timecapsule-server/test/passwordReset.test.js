const { createHash } = require("node:crypto");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { app, buildApp, prisma, mailer, settle } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { linkToken } = require("./helpers/mailer");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const hashOf = (token) => createHash("sha256").update(token).digest("hex");

const forgot = (email) => request(app).post("/forgot-password").send({ email });
const reset = (token, password = "new-password-1") =>
  request(app).post("/reset-password").send({ token, password });
const login = (email, password) => request(app).post("/login").send({ email, password });
const capsules = (token) => request(app).get("/capsules").set("Authorization", `Bearer ${token}`);

// Asks for a reset link for `email` and returns its token.
async function resetLink(email) {
  await forgot(email).expect(202);
  await settle();
  return linkToken(mailer.to(email).at(-1), "reset-password");
}

const forgotAnswer = (email) => ({
  message: `If ${email} has an account, we've emailed it a link to choose a new password. The link works for 1 hour.`,
});
const INVALID_RESET_LINK = {
  error: "This password reset link is invalid or has expired. Ask for a new one.",
  code: "INVALID_LINK",
};

describe("POST /forgot-password", () => {
  test("202: emails the account a link to choose a new password", async () => {
    await signUp("ada@example.com");
    mailer.reset();

    const res = await forgot("ada@example.com");

    expect(res.status).toBe(202);
    expect(res.body).toEqual(forgotAnswer("ada@example.com"));
    await settle();
    const [email] = mailer.to("ada@example.com");
    expect(email.subject).toBe("Reset your TimeCapsule password");
    expect(email.text).toMatch(
      /^http:\/\/localhost:3000\/reset-password#token=[A-Za-z0-9_-]{43}$/m,
    );
    expect(email.text).toContain("The link works once, for 1 hour.");
  });

  test("stores only a hash of the link's token, and the link works for 1 hour", async () => {
    await signUp("ada@example.com");
    const token = await resetLink("ada@example.com");

    const stored = await prisma.authToken.findFirst({ where: { kind: "RESET_PASSWORD" } });

    expect(stored).toMatchObject({ tokenHash: hashOf(token), usedAt: null, passwordHash: null });
    expect(JSON.stringify(stored)).not.toContain(token);
    const lifetime = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(Math.abs(lifetime - 60 * 60 * 1000)).toBeLessThan(5000);
  });

  test("an address with no account gets the same answer, and no email", async () => {
    const res = await forgot("nobody@example.com");

    expect(res.status).toBe(202);
    expect(res.body).toEqual(forgotAnswer("nobody@example.com"));
    await settle();
    expect(mailer.sent).toEqual([]);
    await expect(prisma.emailLog.count()).resolves.toBe(0);
    await expect(prisma.authToken.count()).resolves.toBe(0);
  });

  test("finds the account whatever the case and spacing of the email", async () => {
    await signUp("ada@example.com");
    mailer.reset();

    const res = await forgot("  Ada@Example.COM ");

    expect(res.body).toEqual(forgotAnswer("ada@example.com"));
    await settle();
    expect(mailer.to("ada@example.com")).toHaveLength(1);
  });

  test("at most 3 account emails an hour to one address: a 4th request sends nothing", async () => {
    await signUp("ada@example.com"); // its confirmation link was the 1st
    mailer.reset();

    for (let i = 0; i < 3; i++) {
      expect((await forgot("ada@example.com")).status).toBe(202);
      await settle();
    }

    expect(mailer.to("ada@example.com")).toHaveLength(2);
    await expect(prisma.authToken.count({ where: { kind: "RESET_PASSWORD" } })).resolves.toBe(2);
  });

  test("a link the provider didn't take isn't kept", async () => {
    await signUp("ada@example.com");
    mailer.failNext("rejected");

    await forgot("ada@example.com").expect(202);
    await settle();

    await expect(prisma.authToken.count({ where: { kind: "RESET_PASSWORD" } })).resolves.toBe(0);
    const log = await prisma.emailLog.findFirst({ where: { kind: "RESET_PASSWORD" } });
    expect(log.status).toBe("FAILED");
  });

  test("503 EMAIL_LIMIT_REACHED once the day's account emails are used up", async () => {
    await signUp("ada@example.com"); // 1 account email today
    const limited = buildApp({
      emailLimits: { daily: 10, account: 1, unlock: 9, perOwner: 2, perAddressPerHour: 3 },
    });

    const res = await request(limited).post("/forgot-password").send({ email: "ada@example.com" });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("EMAIL_LIMIT_REACHED");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  test("400 VALIDATION_FAILED for a missing or malformed email", async () => {
    const missing = await request(app).post("/forgot-password").send({});
    const malformed = await forgot("not-an-email");

    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: "Email is required", code: "VALIDATION_FAILED" });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({
      error: "Enter a valid email address",
      code: "VALIDATION_FAILED",
    });
  });
});

describe("POST /reset-password", () => {
  test("sets the new password and logs the user in", async () => {
    const ada = await signUp("ada@example.com", "old-password");
    const token = await resetLink("ada@example.com");

    const res = await reset(token, "new-password-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: ada.user.id, email: "ada@example.com" },
    });
    expect((await capsules(res.body.token)).status).toBe(200);
    expect((await login("ada@example.com", "new-password-1")).status).toBe(200);
    expect((await login("ada@example.com", "old-password")).status).toBe(401);
  });

  test("logs out every session from before: old tokens get 401 TOKEN_REVOKED", async () => {
    const ada = await signUp("ada@example.com", "old-password");
    const token = await resetLink("ada@example.com");

    const res = await reset(token);

    expect(jwt.decode(res.body.token).ver).toBe(1);
    const old = await capsules(ada.token);
    expect(old.status).toBe(401);
    expect(old.body.code).toBe("TOKEN_REVOKED");
  });

  test("a link works once", async () => {
    await signUp("ada@example.com");
    const token = await resetLink("ada@example.com");
    await reset(token, "new-password-1").expect(200);

    const again = await reset(token, "new-password-2");

    expect(again.status).toBe(400);
    expect(again.body).toEqual(INVALID_RESET_LINK);
    expect((await login("ada@example.com", "new-password-1")).status).toBe(200);
  });

  test("using one link ends the account's other links", async () => {
    await signUp("ada@example.com");
    const first = await resetLink("ada@example.com");
    const second = await resetLink("ada@example.com");
    await reset(second, "new-password-1").expect(200);

    const res = await reset(first, "new-password-2");

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_RESET_LINK);
  });

  test("400 INVALID_LINK for an expired link, and the password doesn't change", async () => {
    await signUp("ada@example.com", "old-password");
    const token = await resetLink("ada@example.com");
    await prisma.authToken.updateMany({
      where: { kind: "RESET_PASSWORD" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await reset(token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_RESET_LINK);
    expect((await login("ada@example.com", "old-password")).status).toBe(200);
  });

  test("400 INVALID_LINK for a token that matches no link", async () => {
    const res = await reset("A".repeat(43));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_RESET_LINK);
  });

  test("a confirmation link can't reset a password", async () => {
    await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "password123" })
      .expect(202);
    await settle();
    const confirmation = linkToken(mailer.to("ada@example.com").at(-1), "verify-email");

    const res = await reset(confirmation);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_RESET_LINK);
  });

  test("confirms an unconfirmed address, and ends a signup a stranger started with it", async () => {
    // A stranger signs up with Ada's address and never confirms it (they can't).
    await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "strangers-password" })
      .expect(202);
    await settle();
    const strangersLink = linkToken(mailer.to("ada@example.com").at(-1), "verify-email");
    // Ada, who never signed up, uses "Forgot your password?".
    const token = await resetLink("ada@example.com");

    await reset(token, "adas-password").expect(200);

    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user.emailVerifiedAt).toEqual(expect.any(Date));
    expect((await login("ada@example.com", "adas-password")).status).toBe(200);
    expect((await login("ada@example.com", "strangers-password")).status).toBe(401);
    // The stranger's link no longer sets their password, even if Ada opens it.
    await request(app).post("/verify-email").send({ token: strangersLink });
    expect((await login("ada@example.com", "strangers-password")).status).toBe(401);
  });

  test("two resets with one link at the same moment: one works, the other gets 400", async () => {
    await signUp("ada@example.com");
    const token = await resetLink("ada@example.com");

    const results = await Promise.all([
      reset(token, "new-password-1"),
      reset(token, "new-password-2"),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    const winner = results[0].status === 200 ? "new-password-1" : "new-password-2";
    expect((await login("ada@example.com", winner)).status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user.tokenVersion).toBe(1);
  });

  test("400 VALIDATION_FAILED for a new password that's too short, and the link still works", async () => {
    await signUp("ada@example.com");
    const token = await resetLink("ada@example.com");

    const res = await reset(token, "short");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Password must be at least 8 characters",
      code: "VALIDATION_FAILED",
      details: [{ field: "password", message: "Password must be at least 8 characters" }],
    });
    expect((await reset(token, "long-enough")).status).toBe(200);
  });

  test("400 VALIDATION_FAILED without a token", async () => {
    const res = await request(app).post("/reset-password").send({ password: "new-password-1" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Token is required", code: "VALIDATION_FAILED" });
  });
});

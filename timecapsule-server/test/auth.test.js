const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { app, prisma } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const verify = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

describe("POST /signup", () => {
  test("creates the user and returns a token and the public user fields", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: expect.any(Number), email: "ada@example.com" },
    });
  });

  test("signs a one-day HS256 token holding the user's id and email", async () => {
    const { token, user } = await signUp("ada@example.com");

    const payload = verify(token);
    expect(payload).toMatchObject({ id: user.id, email: "ada@example.com" });
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  test("stores a bcrypt hash, never the password itself", async () => {
    await signUp("ada@example.com", "password123");

    const stored = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(stored.password).not.toBe("password123");
    await expect(bcrypt.compare("password123", stored.password)).resolves.toBe(true);
  });

  test.each([
    ["email", { password: "password123" }, "Email is required"],
    ["password", { email: "ada@example.com" }, "Password is required"],
  ])("rejects a missing %s with 400", async (field, body, message) => {
    const res = await request(app).post("/signup").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: message,
      code: "VALIDATION_FAILED",
      details: [{ field, message }],
    });
  });

  test("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "1234567" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Password must be at least 8 characters",
      code: "VALIDATION_FAILED",
    });
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  test("trims and lowercases the email, so case doesn't create a second account", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "  Ada@Example.COM ", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("ada@example.com");

    const again = await request(app)
      .post("/signup")
      .send({ email: "ADA@example.com", password: "password123" });
    expect(again.body.code).toBe("EMAIL_TAKEN");
    await expect(prisma.user.count()).resolves.toBe(1);
  });

  test.each([
    ["not an email address", { email: "ada.example.com", password: "password123" }],
    [
      "an email over 254 characters",
      { email: `${"a".repeat(245)}@example.com`, password: "password123" },
    ],
    ["a number as password", { email: "ada@example.com", password: 12345678 }],
    ["an object as email", { email: { $gt: "" }, password: "password123" }],
  ])("rejects %s with 400 (not 500)", async (_case, body) => {
    const res = await request(app).post("/signup").send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  test("accepts a 72-byte password and rejects 73 bytes, counting bytes, not characters", async () => {
    const ok = await request(app)
      .post("/signup")
      .send({ email: "a@example.com", password: "x".repeat(72) });
    const tooLong = await request(app)
      .post("/signup")
      .send({ email: "b@example.com", password: "x".repeat(73) });
    const accents = await request(app)
      .post("/signup")
      .send({ email: "c@example.com", password: "é".repeat(37) }); // 37 characters, 74 bytes

    expect(ok.status).toBe(200);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/^Password must be at most 72 bytes/);
    expect(accents.status).toBe(400);
  });

  test("lists every problem in details, with the first one as the error", async () => {
    const res = await request(app).post("/signup").send({ email: "nope", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Enter a valid email address",
      code: "VALIDATION_FAILED",
      details: [
        { field: "email", message: "Enter a valid email address" },
        { field: "password", message: "Password must be at least 8 characters" },
      ],
    });
  });

  test.each([
    ["a JSON array", (req) => req.send(["ada@example.com", "password123"])],
    ["no JSON body at all", (req) => req.set("Content-Type", "text/plain").send("hello")],
  ])("rejects %s with 400", async (_case, send) => {
    const res = await send(request(app).post("/signup"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "The request body must be a JSON object",
      code: "VALIDATION_FAILED",
      details: [{ message: "The request body must be a JSON object" }],
    });
  });

  test("rejects an email that is already registered", async () => {
    await signUp("ada@example.com");

    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "another-password" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email already exists", code: "EMAIL_TAKEN" });
    await expect(prisma.user.count()).resolves.toBe(1);
  });
});

describe("POST /login", () => {
  test("returns a token and the user for the right password", async () => {
    const { user } = await signUp("ada@example.com", "password123");

    const res = await request(app)
      .post("/login")
      .send({ email: "ada@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: user.id, email: "ada@example.com" },
    });
    expect(verify(res.body.token)).toMatchObject({ id: user.id, email: "ada@example.com" });
  });

  const INVALID_CREDENTIALS = {
    error: "Incorrect email or password",
    code: "INVALID_CREDENTIALS",
  };

  test("rejects a wrong password with 401", async () => {
    await signUp("ada@example.com", "password123");

    const res = await request(app)
      .post("/login")
      .send({ email: "ada@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(res.body).toEqual(INVALID_CREDENTIALS);
  });

  test("gives an unknown email the same answer as a wrong password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_CREDENTIALS);
  });

  test("rejects missing fields with 400", async () => {
    const res = await request(app).post("/login").send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Password is required",
      code: "VALIDATION_FAILED",
      details: [{ field: "password", message: "Password is required" }],
    });
  });

  test("finds the account whatever the case and spacing of the email", async () => {
    const { user } = await signUp("ada@example.com", "password123");

    const res = await request(app)
      .post("/login")
      .send({ email: " ADA@Example.com ", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: user.id, email: "ada@example.com" });
  });
});

describe("token check on protected routes", () => {
  const INVALID_TOKEN = { error: "Invalid token", code: "INVALID_TOKEN" };
  const get = (authorization) => request(app).get("/capsules").set("Authorization", authorization);

  test("401 without an Authorization header", async () => {
    const res = await request(app).get("/capsules");

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(res.body).toEqual({ error: "No token provided", code: "AUTH_REQUIRED" });
  });

  test("401 when the header has no token after the scheme", async () => {
    const res = await get("Bearer");

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe('Bearer error="invalid_request"');
    expect(res.body).toEqual({
      error: "The Authorization header must be: Bearer <token>",
      code: "AUTH_REQUIRED",
    });
  });

  test.each([
    ["the Basic scheme (was accepted)", (token) => `Basic ${token}`],
    ["a token with no scheme", (token) => token],
    ["extra text after the token", (token) => `Bearer ${token} extra`],
  ])("401 for %s", async (_case, header) => {
    const { token } = await signUp();

    const res = await get(header(token));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_REQUIRED");
  });

  test("accepts the scheme name in any case, as HTTP allows", async () => {
    const { token } = await signUp();

    const res = await get(`bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test("401 for a token signed with HS512, even with the right secret (was accepted)", async () => {
    const { user } = await signUp();
    const hs512 = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      algorithm: "HS512",
    });

    const res = await get(`Bearer ${hs512}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  test('401 for an unsigned token (alg "none")', async () => {
    const { user } = await signUp();
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({ id: user.id })}.`;

    const res = await get(`Bearer ${unsigned}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  test("401 (was 403) for a token that isn't a valid JWT", async () => {
    const res = await get("Bearer not-a-real-token");

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  test("401 TOKEN_EXPIRED (was 403) for an expired token", async () => {
    const { user } = await signUp();
    const expired = jwt.sign(
      { id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
    );

    const res = await get(`Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer error="invalid_token"/);
    expect(res.body).toEqual({
      error: "Your session has expired. Please log in again.",
      code: "TOKEN_EXPIRED",
    });
  });

  test("401 (was 403) for a token signed with a different secret", async () => {
    const { user } = await signUp();
    const forged = jwt.sign(
      { id: user.id, email: user.email },
      "some-other-secret-at-least-32-chars-long",
    );

    const res = await get(`Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN);
  });
});

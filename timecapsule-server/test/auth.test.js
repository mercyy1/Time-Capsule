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
    ["email", { password: "password123" }],
    ["password", { email: "ada@example.com" }],
  ])("rejects a missing %s with 400", async (_field, body) => {
    const res = await request(app).post("/signup").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email and password required" });
  });

  test("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "1234567" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Password must be at least 8 characters" });
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  test("rejects an email that is already registered", async () => {
    await signUp("ada@example.com");

    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "another-password" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email already exists" });
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
    expect(res.body).toEqual({ token: expect.any(String), user: { id: user.id, email: "ada@example.com" } });
    expect(verify(res.body.token)).toMatchObject({ id: user.id, email: "ada@example.com" });
  });

  test("rejects a wrong password with 400", async () => {
    await signUp("ada@example.com", "password123");

    const res = await request(app)
      .post("/login")
      .send({ email: "ada@example.com", password: "wrong-password" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });

  test("gives an unknown email the same answer as a wrong password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });

  test("rejects missing fields with 400", async () => {
    const res = await request(app).post("/login").send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Email and password required" });
  });
});

describe("token check on protected routes", () => {
  test("401 without an Authorization header", async () => {
    const res = await request(app).get("/capsules");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No token provided" });
  });

  test("401 when the header has no token after the scheme", async () => {
    const res = await request(app).get("/capsules").set("Authorization", "Bearer");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Malformed token" });
  });

  test("403 for a token that isn't a valid JWT", async () => {
    const res = await request(app).get("/capsules").set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid token" });
  });

  test("403 for an expired token", async () => {
    const { user } = await signUp();
    const expired = jwt.sign(
      { id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
    );

    const res = await request(app).get("/capsules").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid token" });
  });

  test("403 for a token signed with a different secret", async () => {
    const { user } = await signUp();
    const forged = jwt.sign({ id: user.id, email: user.email }, "some-other-secret-at-least-32-chars-long");

    const res = await request(app).get("/capsules").set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid token" });
  });
});

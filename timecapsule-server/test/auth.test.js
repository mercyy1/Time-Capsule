const { createHash } = require("node:crypto");
const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { app, buildApp, prisma, mailer, settle } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { linkToken } = require("./helpers/mailer");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const verify = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
const hashOf = (token) => createHash("sha256").update(token).digest("hex");

const signup = (email, password = "password123") =>
  request(app).post("/signup").send({ email, password });
const confirm = (token) => request(app).post("/verify-email").send({ token });
const login = (email, password = "password123") =>
  request(app).post("/login").send({ email, password });

// The token in the newest confirmation link emailed to `address`.
const confirmationToken = (address) => linkToken(mailer.to(address).at(-1), "verify-email");

// What signup answers, whether or not the address has an account.
const signupAnswer = (email) => ({
  message: `We've sent an email to ${email}. Open the link in it to finish signing up.`,
});
const INVALID_CONFIRMATION_LINK = {
  error: "This confirmation link is invalid or has expired. Log in to get a new one.",
  code: "INVALID_LINK",
};

describe("POST /signup", () => {
  test("202 (was 201 with a token): emails a link to confirm the address, and logs nobody in", async () => {
    const res = await signup("ada@example.com");

    expect(res.status).toBe(202);
    expect(res.body).toEqual(signupAnswer("ada@example.com"));
    await settle();
    const emails = mailer.to("ada@example.com");
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("Confirm your email address for TimeCapsule");
    expect(emails[0].text).toMatch(
      /\nhttp:\/\/localhost:3000\/verify-email#token=[A-Za-z0-9_-]{43}\n/,
    );
    expect(emails[0].text).toContain("The link works for 24 hours.");
    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  test("opening the link confirms the address, and the account can log in", async () => {
    await signup("ada@example.com");
    await settle();

    const res = await confirm(confirmationToken("ada@example.com"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Your email address is confirmed. You can log in now.",
      email: "ada@example.com",
    });
    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user.emailVerifiedAt).toEqual(expect.any(Date));
    expect((await login("ada@example.com")).status).toBe(200);
  });

  test("signs a one-day HS256 token holding the user's id, email and token version", async () => {
    const { token, user } = await signUp("ada@example.com");

    const payload = verify(token);
    expect(payload).toMatchObject({ id: user.id, email: "ada@example.com", ver: 0 });
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
    const res = await signup("  Ada@Example.COM ");
    expect(res.status).toBe(202);
    expect(res.body).toEqual(signupAnswer("ada@example.com"));

    await signup("ADA@example.com").expect(202);
    await settle();

    const users = await prisma.user.findMany({ select: { email: true } });
    expect(users).toEqual([{ email: "ada@example.com" }]);
    expect(mailer.to("ada@example.com")).toHaveLength(2);
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

    expect(ok.status).toBe(202);
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

  test("an address with an account gets the same answer (was 409), and its owner an email saying so", async () => {
    await signUp("ada@example.com", "password123");
    mailer.reset();

    const res = await signup("ada@example.com", "another-password");

    expect(res.status).toBe(202);
    expect(res.body).toEqual(signupAnswer("ada@example.com"));
    await settle();
    const emails = mailer.to("ada@example.com");
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("You already have a TimeCapsule account");
    expect(emails[0].text).toContain("http://localhost:3000/login");
    expect(emails[0].text).toContain("http://localhost:3000/forgot-password");
    expect(emails[0].text).not.toContain("token=");
    // Nothing changed: the old password still works, the new one doesn't.
    expect((await login("ada@example.com", "password123")).status).toBe(200);
    expect((await login("ada@example.com", "another-password")).status).toBe(401);
    await expect(prisma.user.count()).resolves.toBe(1);
  });

  test("signing up again before confirming: a new link replaces the old one, with the new password", async () => {
    await signup("ada@example.com", "first-password");
    await settle();
    const first = confirmationToken("ada@example.com");
    await signup("ada@example.com", "second-password");
    await settle();
    const second = confirmationToken("ada@example.com");

    expect(await confirm(first)).toMatchObject({ status: 400, body: INVALID_CONFIRMATION_LINK });
    expect((await confirm(second)).status).toBe(200);
    expect((await login("ada@example.com", "second-password")).status).toBe(200);
    expect((await login("ada@example.com", "first-password")).status).toBe(401);
  });

  test("six signups with one email at the same moment: six 202s and one account (was 500s, then 409s)", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => signup("ada@example.com")));

    expect(results.map((res) => res.status)).toEqual([202, 202, 202, 202, 202, 202]);
    await settle(); // fails the test if any of them failed in the background
    await expect(prisma.user.count()).resolves.toBe(1);
    // Three emails at most (the hourly limit per address), and only the newest
    // link still works.
    const tokens = mailer.to("ada@example.com").map((email) => linkToken(email, "verify-email"));
    expect(tokens).toHaveLength(3);
    const unused = await prisma.authToken.findMany({ where: { usedAt: null } });
    expect(unused).toHaveLength(1);
    const working = tokens.find((token) => hashOf(token) === unused[0].tokenHash);
    expect((await confirm(working)).status).toBe(200);
    expect((await login("ada@example.com")).status).toBe(200);
  });
});

describe("POST /verify-email", () => {
  test("stores only a hash of the link's token, and the link works for 24 hours", async () => {
    await signup("ada@example.com");
    await settle();
    const token = confirmationToken("ada@example.com");

    const [stored] = await prisma.authToken.findMany();

    expect(stored).toMatchObject({ kind: "VERIFY_EMAIL", tokenHash: hashOf(token), usedAt: null });
    expect(JSON.stringify(stored)).not.toContain(token);
    const lifetime = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(Math.abs(lifetime - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  test("a link opened again (or by an email scanner first) still says the address is confirmed", async () => {
    await signup("ada@example.com");
    await settle();
    const token = confirmationToken("ada@example.com");
    await confirm(token).expect(200);

    const again = await confirm(token);

    expect(again.status).toBe(200);
    expect(again.body.email).toBe("ada@example.com");
  });

  test("400 INVALID_LINK for an expired link, and the address stays unconfirmed", async () => {
    await signup("ada@example.com");
    await settle();
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await confirm(confirmationToken("ada@example.com"));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_CONFIRMATION_LINK);
    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  test("400 INVALID_LINK for a token that matches no link", async () => {
    const res = await confirm("A".repeat(43));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_CONFIRMATION_LINK);
  });

  test("400 INVALID_LINK, without a database query, for a token that can't be one", async () => {
    const query = jest.spyOn(prisma.authToken, "findUnique");

    const res = await confirm("not-a-token");

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_CONFIRMATION_LINK);
    expect(query).not.toHaveBeenCalled();
  });

  test("a password reset link can't confirm an address", async () => {
    await signup("ada@example.com");
    await settle();
    const user = await prisma.user.findUnique({ where: { email: "ada@example.com" } });
    const token = "R".repeat(43);
    await prisma.authToken.create({
      data: {
        kind: "RESET_PASSWORD",
        userId: user.id,
        tokenHash: hashOf(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const res = await confirm(token);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(INVALID_CONFIRMATION_LINK);
  });

  test("400 VALIDATION_FAILED without a token", async () => {
    const res = await request(app).post("/verify-email").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Token is required",
      code: "VALIDATION_FAILED",
      details: [{ field: "token", message: "Token is required" }],
    });
  });
});

describe("account emails and the sending limits", () => {
  test("at most 3 emails an hour to one address: a 4th signup changes nothing", async () => {
    for (const password of ["password-1", "password-2", "password-3", "password-4"]) {
      await signup("ada@example.com", password).expect(202);
      await settle();
    }

    expect(mailer.to("ada@example.com")).toHaveLength(3);
    // The last link sent still works, and sets the password of the signup that sent it.
    expect((await confirm(confirmationToken("ada@example.com"))).status).toBe(200);
    expect((await login("ada@example.com", "password-3")).status).toBe(200);
    expect((await login("ada@example.com", "password-4")).status).toBe(401);
  });

  test("503 EMAIL_LIMIT_REACHED, with Retry-After, once the day's account emails are used up", async () => {
    const limited = buildApp({
      emailLimits: { daily: 10, account: 1, unlock: 9, perOwner: 2, perAddressPerHour: 3 },
    });
    const signupTo = (email) =>
      request(limited).post("/signup").send({ email, password: "password123" });
    await signupTo("ada@example.com").expect(202);
    await settle();

    const res = await signupTo("bob@example.com");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: "We've sent as many emails as we can today. Please try again tomorrow.",
      code: "EMAIL_LIMIT_REACHED",
    });
    const retryAfter = Number(res.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);
    await settle();
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
    expect(res.headers["www-authenticate"]).toBe("Bearer");
    expect(res.body).toEqual(INVALID_CREDENTIALS);
  });

  test("403 EMAIL_NOT_VERIFIED for the right password before the address is confirmed, and a new link", async () => {
    await signup("ada@example.com");
    await settle();

    const res = await login("ada@example.com");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error:
        "Please confirm your email address first: open the link we've emailed to ada@example.com.",
      code: "EMAIL_NOT_VERIFIED",
    });
    expect(res.body).not.toHaveProperty("token");
    await settle();
    expect(mailer.to("ada@example.com")).toHaveLength(2);
    expect((await confirm(confirmationToken("ada@example.com"))).status).toBe(200);
    expect((await login("ada@example.com")).status).toBe(200);
  });

  test("before the address is confirmed, a wrong password is the usual 401, and sends nothing", async () => {
    await signup("ada@example.com");
    await settle();
    mailer.reset();

    const res = await login("ada@example.com", "wrong-password");

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_CREDENTIALS);
    await settle();
    expect(mailer.sent).toHaveLength(0);
  });

  test("checks a password for an unknown email too, so it takes as long as a wrong password", async () => {
    const { user } = await signUp("ada@example.com", "password123");
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    const compare = jest.spyOn(bcrypt, "compare");

    const res = await request(app)
      .post("/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    // Against a hash as costly as a real one.
    const [, hash] = compare.mock.calls[0];
    expect(bcrypt.getRounds(hash)).toBe(bcrypt.getRounds(stored.password));
    compare.mockRestore();
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
    const hs512 = jwt.sign({ id: user.id, email: user.email, ver: 0 }, process.env.JWT_SECRET, {
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
      { id: user.id, email: user.email, ver: 0, exp: Math.floor(Date.now() / 1000) - 60 },
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

  test("401 for the token of an account that no longer exists (creating a capsule was a 500)", async () => {
    const ada = await signUp();
    await prisma.user.delete({ where: { id: ada.user.id } });

    const list = await get(ada.auth);
    const create = await request(app)
      .post("/capsules")
      .set("Authorization", ada.auth)
      .send({
        title: "t",
        message: "m",
        unlockDate: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(list.status).toBe(401);
    expect(list.body).toEqual(INVALID_TOKEN);
    expect(create.status).toBe(401);
    expect(create.body).toEqual(INVALID_TOKEN);
  });

  test("401 (was 403) for a token signed with a different secret", async () => {
    const { user } = await signUp();
    const forged = jwt.sign(
      { id: user.id, email: user.email, ver: 0 },
      "some-other-secret-at-least-32-chars-long",
    );

    const res = await get(`Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  test("401 for a token made before token versions existed (no ver)", async () => {
    const { user } = await signUp();
    const old = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    const res = await get(`Bearer ${old}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID_TOKEN);
  });

  test("401 TOKEN_REVOKED once the account's token version has moved on (password changed)", async () => {
    const ada = await signUp();
    await prisma.user.update({
      where: { id: ada.user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    const res = await get(ada.auth);

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe(
      'Bearer error="invalid_token", error_description="The token has been revoked"',
    );
    expect(res.body).toEqual({
      error: "You've been logged out because your password was changed. Please log in again.",
      code: "TOKEN_REVOKED",
    });
    // A new login gets a token with the new version, which works.
    const again = await login(ada.user.email);
    expect(verify(again.body.token).ver).toBe(1);
    expect((await get(`Bearer ${again.body.token}`)).status).toBe(200);
  });
});

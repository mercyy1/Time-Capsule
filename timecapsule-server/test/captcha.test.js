const http = require("node:http");
const request = require("supertest");
const { buildApp, prisma, mailer, settle, captcha } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { signUp } = require("./helpers/users");

const { CaptchaUnavailableError, createTurnstileCaptcha, createCaptcha } = captcha;

// A stand-in for Turnstile's siteverify endpoint on a local port: it records
// every request and answers with whatever the test set (or never, with hang).
async function startFakeSiteverify() {
  let reply;
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (reply.hang) return;
      res.writeHead(reply.status, { "Content-Type": reply.contentType ?? "application/json" });
      res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/turnstile/v0/siteverify`,
    requests,
    answer: (next) => (reply = next),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

describe("Turnstile captcha", () => {
  let siteverify;
  const captchaFor = (options = {}) =>
    createTurnstileCaptcha({ secret: "0x-test-secret", verifyUrl: siteverify.url, ...options });
  const failureOf = (promise) =>
    promise.then(
      () => {
        throw new Error("expected the check to fail");
      },
      (err) => err,
    );

  beforeAll(async () => (siteverify = await startFakeSiteverify()));
  afterAll(() => siteverify.close());
  beforeEach(() => {
    siteverify.requests.length = 0;
    siteverify.answer({ status: 200, body: { success: true, "error-codes": [] } });
  });

  test("POSTs the secret and the token as a form, and nothing else", async () => {
    await captchaFor().verify("token-from-the-widget");

    expect(siteverify.requests).toHaveLength(1);
    const [req] = siteverify.requests;
    expect(req).toMatchObject({ method: "POST", url: "/turnstile/v0/siteverify" });
    expect(req.headers["content-type"]).toMatch(/^application\/x-www-form-urlencoded/);
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      secret: "0x-test-secret",
      response: "token-from-the-widget",
    });
  });

  test("a token Cloudflare vouches for passes", async () => {
    await expect(captchaFor().verify("token")).resolves.toBe(true);
  });

  test.each(["invalid-input-response", "timeout-or-duplicate", "missing-input-response"])(
    "a token Cloudflare refuses (%s) fails",
    async (code) => {
      siteverify.answer({ status: 200, body: { success: false, "error-codes": [code] } });

      await expect(captchaFor().verify("token")).resolves.toBe(false);
    },
  );

  test.each(["invalid-input-secret", "missing-input-secret", "bad-request", "internal-error"])(
    "an answer about our side of the check (%s) means the check is unavailable",
    async (code) => {
      siteverify.answer({ status: 200, body: { success: false, "error-codes": [code] } });

      const err = await failureOf(captchaFor().verify("token"));
      expect(err).toBeInstanceOf(CaptchaUnavailableError);
      expect(err.message).toContain(code);
    },
  );

  test.each([
    ["a server error", { status: 500, body: { success: false } }],
    [
      "an answer that isn't JSON",
      { status: 200, body: "<html>oops</html>", contentType: "text/html" },
    ],
    ["an answer without a verdict", { status: 200, body: { hello: "world" } }],
  ])("%s means the check is unavailable", async (_, reply) => {
    siteverify.answer(reply);

    await expect(failureOf(captchaFor().verify("token"))).resolves.toBeInstanceOf(
      CaptchaUnavailableError,
    );
  });

  test("gives up on an answer that doesn't come in time", async () => {
    siteverify.answer({ hang: true });

    const err = await failureOf(captchaFor({ timeoutMs: 200 }).verify("token"));
    expect(err).toBeInstanceOf(CaptchaUnavailableError);
    expect(err.message).toMatch(/Couldn't reach Turnstile/);
  });

  test("an unreachable Cloudflare means the check is unavailable", async () => {
    const closed = await startFakeSiteverify();
    await closed.close();

    const err = await failureOf(captchaFor({ verifyUrl: closed.url }).verify("token"));
    expect(err).toBeInstanceOf(CaptchaUnavailableError);
  });

  test("the settings turn the check on only when TURNSTILE_SECRET_KEY is set", () => {
    expect(createCaptcha({})).toBeNull();
    expect(createCaptcha({ TURNSTILE_SECRET_KEY: "0x-test-secret" })).toHaveProperty("verify");
  });
});

describe("the security check on signup and forgot-password", () => {
  // A captcha that vouches for the token "human" only, or throws `failure`.
  const fakeCaptcha = () => {
    const fake = { failure: null, tokens: [] };
    fake.verify = async (token) => {
      fake.tokens.push(token);
      if (fake.failure) throw fake.failure;
      return token === "human";
    };
    return fake;
  };

  let check;
  let app;

  // Ada has an account, so both routes would email her if they went ahead
  // (signup: "you already have an account"; forgot-password: a reset link).
  beforeEach(async () => {
    await resetDatabase();
    await signUp("ada@example.com");
    mailer.reset();
    check = fakeCaptcha();
    app = buildApp({ captcha: check });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => prisma.$disconnect());

  const ROUTES = [
    ["POST /signup", "/signup", { email: "ada@example.com", password: "password123" }],
    ["POST /forgot-password", "/forgot-password", { email: "ada@example.com" }],
  ];
  const FAILED = {
    error: "The security check didn't go through. Please try again.",
    code: "CAPTCHA_FAILED",
  };

  describe.each(ROUTES)("%s", (_, path, body) => {
    test("goes ahead with a token Cloudflare vouches for", async () => {
      const res = await request(app)
        .post(path)
        .send({ ...body, captchaToken: "human" });

      expect(res.status).toBe(202);
      expect(check.tokens).toEqual(["human"]);
      await settle();
      expect(mailer.to("ada@example.com")).toHaveLength(1);
    });

    test("400 CAPTCHA_FAILED without a token, and sends nothing", async () => {
      const res = await request(app).post(path).send(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual(FAILED);
      expect(check.tokens).toEqual([]);
      await settle();
      expect(mailer.sent).toHaveLength(0);
    });

    test("400 CAPTCHA_FAILED with a token Cloudflare refuses, and sends nothing", async () => {
      const res = await request(app)
        .post(path)
        .send({ ...body, captchaToken: "robot" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual(FAILED);
      await settle();
      expect(mailer.sent).toHaveLength(0);
    });

    test("503 CAPTCHA_UNAVAILABLE when Cloudflare can't tell, logged for whoever runs the server", async () => {
      check.failure = new CaptchaUnavailableError(
        "Turnstile refused the check: invalid-input-secret",
      );
      const logged = jest.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(app)
        .post(path)
        .send({ ...body, captchaToken: "human" });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "The security check isn't working right now. Please try again in a few minutes.",
        code: "CAPTCHA_UNAVAILABLE",
      });
      expect(logged).toHaveBeenCalledWith(
        "The security check is unavailable:",
        "Turnstile refused the check: invalid-input-secret",
      );
    });

    test("any other failure of the check is a 500, like any bug", async () => {
      check.failure = new TypeError("a bug");
      jest.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(app)
        .post(path)
        .send({ ...body, captchaToken: "human" });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });

    test("checks the fields first: an invalid email is a 400 without asking Cloudflare", async () => {
      const res = await request(app)
        .post(path)
        .send({ ...body, email: "not-an-email", captchaToken: "human" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(check.tokens).toEqual([]);
    });

    test("a token that isn't text, or is too long, is a validation error", async () => {
      for (const captchaToken of [42, "x".repeat(2049)]) {
        const res = await request(app)
          .post(path)
          .send({ ...body, captchaToken });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_FAILED");
        expect(res.body.details.map((d) => d.field)).toEqual(["captchaToken"]);
      }
      expect(check.tokens).toEqual([]);
    });
  });

  test("logging in, confirming an address and choosing a new password don't ask for it", async () => {
    await request(app)
      .post("/login")
      .send({ email: "ada@example.com", password: "password123" })
      .expect(200);
    const confirm = await request(app).post("/verify-email").send({ token: "not-a-real-link" });
    expect(confirm.body.code).toBe("INVALID_LINK");
    const reset = await request(app)
      .post("/reset-password")
      .send({ token: "not-a-real-link", password: "new-password-1" });
    expect(reset.body.code).toBe("INVALID_LINK");

    expect(check.tokens).toEqual([]);
  });

  test("with the check off (no TURNSTILE_SECRET_KEY), a token is accepted and ignored", async () => {
    const res = await request(buildApp({ captcha: null }))
      .post("/forgot-password")
      .send({ email: "ada@example.com", captchaToken: "anything" });

    expect(res.status).toBe(202);
  });
});

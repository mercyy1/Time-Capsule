const http = require("node:http");
const { mailers } = require("./helpers/app");

const { MailerError, createResendMailer, createConsoleMailer, createMailer } = mailers;

const FROM = "TimeCapsule <capsules@timecapsule.example>";
const EMAIL = { to: "ada@example.com", subject: "Hello", text: "Hello from the past" };
const RESEND_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";

// A stand-in for Resend's API on a local port: it records every request and
// answers with whatever the test set (or never answers, with hang: true).
async function startFakeResend() {
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
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    answer: (next) => (reply = next),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

describe("Resend mailer", () => {
  let resend;
  const mailerFor = (options = {}) =>
    createResendMailer({ apiKey: "re_test_key", from: FROM, apiUrl: resend.url, ...options });
  const failureOf = (promise) =>
    promise.then(
      () => {
        throw new Error("expected the email to fail");
      },
      (err) => err,
    );

  beforeAll(async () => (resend = await startFakeResend()));
  afterAll(() => resend.close());
  beforeEach(() => {
    resend.requests.length = 0;
    resend.answer({ status: 200, body: { id: RESEND_ID } });
  });

  test("POSTs the email as JSON to /emails, with the API key and a User-Agent", async () => {
    const result = await mailerFor().send({ ...EMAIL, replyTo: "bob@example.com" });

    expect(result).toEqual({ id: RESEND_ID });
    expect(resend.requests).toHaveLength(1);
    const [request] = resend.requests;
    expect(request).toMatchObject({ method: "POST", url: "/emails" });
    expect(request.headers).toMatchObject({
      authorization: "Bearer re_test_key",
      "content-type": "application/json",
      // Resend refuses requests without one.
      "user-agent": "timecapsule-server",
    });
    expect(JSON.parse(request.body)).toEqual({
      from: FROM,
      to: ["ada@example.com"],
      subject: "Hello",
      text: "Hello from the past",
      reply_to: "bob@example.com",
    });
  });

  test("sends no reply_to or Idempotency-Key unless asked to", async () => {
    await mailerFor().send(EMAIL);

    const [request] = resend.requests;
    expect(JSON.parse(request.body)).not.toHaveProperty("reply_to");
    expect(request.headers).not.toHaveProperty("idempotency-key");
  });

  test("the Idempotency-Key is the same for the same email, and changes with its text", async () => {
    const email = { ...EMAIL, idempotencyKey: "capsule-7-CAPSULE_OPENED" };
    const mailer = mailerFor();

    await mailer.send(email);
    await mailer.send(email);
    await mailer.send({ ...email, text: "Edited after a deploy" });

    const keys = resend.requests.map((request) => request.headers["idempotency-key"]);
    expect(keys[0]).toMatch(/^capsule-7-CAPSULE_OPENED\/[0-9a-f]{16}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test.each([
    [429, "daily_quota_exceeded", "quota"],
    [429, "monthly_quota_exceeded", "quota"],
    [429, "rate_limit_exceeded", "unavailable"],
    [409, "concurrent_idempotent_requests", "unavailable"],
    [500, "application_error", "unavailable"],
    [503, "service_unavailable", "unavailable"],
    [400, "validation_error", "rejected"],
    [422, "missing_required_field", "rejected"],
    [401, "missing_api_key", "config"],
    [403, "validation_error", "config"],
  ])("an answer of %i %s is a %s failure", async (status, name, kind) => {
    resend.answer({ status, body: { statusCode: status, name, message: "Details from Resend" } });

    const error = await failureOf(mailerFor().send(EMAIL));

    expect(error).toBeInstanceOf(MailerError);
    expect(error).toMatchObject({ kind, status, outcomeUnknown: false });
    expect(error.message).toBe(`Resend refused the email (${status} ${name}): Details from Resend`);
  });

  test("an error page that isn't JSON (from a proxy, say) is a failure to retry later", async () => {
    resend.answer({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" });

    const error = await failureOf(mailerFor().send(EMAIL));

    expect(error).toMatchObject({ kind: "unavailable", status: 502, outcomeUnknown: false });
  });

  test("a success without an email id may or may not have been sent", async () => {
    resend.answer({ status: 200, body: {} });

    const error = await failureOf(mailerFor().send(EMAIL));

    expect(error).toMatchObject({ kind: "unavailable", outcomeUnknown: true });
  });

  test("no answer in time: gives up, and the email may or may not have been sent", async () => {
    resend.answer({ hang: true });
    const started = Date.now();

    const error = await failureOf(mailerFor({ timeoutMs: 200 }).send(EMAIL));

    expect(error).toMatchObject({ kind: "unavailable", outcomeUnknown: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a server that can't be reached is a failure to retry later", async () => {
    const gone = await startFakeResend();
    await gone.close();

    const error = await failureOf(mailerFor({ apiUrl: gone.url }).send(EMAIL));

    expect(error).toMatchObject({ kind: "unavailable", outcomeUnknown: true });
  });
});

describe("console mailer", () => {
  test("prints the email, links included, instead of sending it", async () => {
    const printed = [];
    const mailer = createConsoleMailer({ from: FROM, log: (text) => printed.push(text) });

    const result = await mailer.send({
      ...EMAIL,
      text: "Confirm: http://localhost:3000/verify-email#token=abc",
      replyTo: "bob@example.com",
    });

    expect(result).toEqual({ id: "console-1" });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain(`From: ${FROM}`);
    expect(printed[0]).toContain("To: ada@example.com");
    expect(printed[0]).toContain("Reply-To: bob@example.com");
    expect(printed[0]).toContain("Subject: Hello");
    expect(printed[0]).toContain("http://localhost:3000/verify-email#token=abc");
  });
});

describe("choosing a mailer from the settings", () => {
  afterEach(() => jest.restoreAllMocks());

  test("without RESEND_API_KEY, emails are printed", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const fetch = jest.spyOn(globalThis, "fetch");

    await createMailer({}).send(EMAIL);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("From: TimeCapsule <no-reply@localhost>"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("with RESEND_API_KEY, emails go to Resend's API, from EMAIL_FROM", async () => {
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: RESEND_ID }));

    await createMailer({ RESEND_API_KEY: "re_live_key", EMAIL_FROM: FROM }).send(EMAIL);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_live_key");
    expect(JSON.parse(init.body).from).toBe(FROM);
  });
});

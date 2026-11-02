// How emails leave the server. A mailer has one method,
//   send({ to, subject, text, replyTo, idempotencyKey }) -> Promise<{ id }>
// which throws a MailerError when the email isn't sent. There are two:
//   - Resend's HTTP API, in production. (Render's free plan blocks the ports
//     mail servers use, so it has to be an HTTP API.)
//   - The console mailer, in development: it prints each email, links included,
//     in the server's log instead of sending it.
// Tests use a fake one that records emails (test/helpers/mailer.js).
const { createHash } = require("node:crypto");

const RESEND_API_URL = "https://api.resend.com";
// Resend refuses requests without a User-Agent header (403).
const USER_AGENT = "timecapsule-server";
// Long enough for a slow answer, short enough that a run of the unlock-email
// job stays well within the 30 seconds its scheduler waits.
const TIMEOUT_MS = 8_000;

// Why an email wasn't sent, in the terms the code sending it acts on (`kind`):
//   quota        the provider's daily or monthly quota is used up
//   unavailable  the provider failed, was busy or couldn't be reached: try later
//   rejected     the provider refused this particular email (its address, say)
//   config       the provider refused our credentials or our sender domain
// `outcomeUnknown` is true when the request may have reached the provider (it
// timed out, or the connection dropped), so the email may have gone out anyway.
class MailerError extends Error {
  constructor(kind, message, { status, outcomeUnknown = false, cause } = {}) {
    super(message, { cause });
    this.name = "MailerError";
    this.kind = kind;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

// The kind of an error answer from Resend, by its status and error name (see
// https://resend.com/docs/api-reference/errors).
function kindOf(status, name) {
  // 429 is also "too many requests per second" (rate_limit_exceeded).
  if (status === 429) return QUOTA_ERRORS.has(name) ? "quota" : "unavailable";
  // 409: an email with the same Idempotency-Key is being sent right now.
  if (status === 409 || status >= 500) return "unavailable";
  // A field of this email is invalid, the recipient's address for example.
  if (status === 400 || status === 422) return "rejected";
  // 401/403: a missing, wrong or suspended API key, or a sender domain that
  // isn't verified. 404/405: a wrong API address.
  return "config";
}

// Resend sends one email per Idempotency-Key (keys are kept for 24 hours), so a
// request repeated after a crash or a timeout can't send it twice. A key may only
// be reused with the same request body, so the key ends with a fingerprint of
// the body: if an email's text changes between two attempts (after a deploy, for
// example), it gets a new key instead of an error.
const fingerprint = (body) => createHash("sha256").update(body).digest("hex").slice(0, 16);

function createResendMailer({ apiKey, from, apiUrl = RESEND_API_URL, timeoutMs = TIMEOUT_MS }) {
  return {
    async send({ to, subject, text, replyTo, idempotencyKey }) {
      const body = JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        ...(replyTo && { reply_to: replyTo }),
      });
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      };
      if (idempotencyKey) headers["Idempotency-Key"] = `${idempotencyKey}/${fingerprint(body)}`;

      let res;
      try {
        res = await fetch(`${apiUrl}/emails`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new MailerError("unavailable", `Couldn't reach Resend: ${err.message}`, {
          outcomeUnknown: true,
          cause: err,
        });
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        // Not JSON (a proxy's error page, say), or cut off by the timeout.
      }

      if (res.ok) {
        if (typeof data?.id === "string") return { id: data.id };
        throw new MailerError("unavailable", `Resend answered ${res.status} without an email id`, {
          status: res.status,
          outcomeUnknown: true,
        });
      }
      const name = typeof data?.name === "string" ? data.name : "unknown_error";
      const detail = typeof data?.message === "string" ? `: ${data.message}` : "";
      throw new MailerError(
        kindOf(res.status, name),
        `Resend refused the email (${res.status} ${name})${detail}`,
        { status: res.status },
      );
    },
  };
}

function createConsoleMailer({ from, log = console.log }) {
  let printed = 0;
  return {
    async send({ to, subject, text, replyTo }) {
      printed += 1;
      const id = `console-${printed}`;
      log(
        [
          `----- Email ${id}: printed, not sent (RESEND_API_KEY isn't set) -----`,
          `From: ${from}`,
          `To: ${to}`,
          ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
          `Subject: ${subject}`,
          "",
          text,
          "----- End of email -----",
        ].join("\n"),
      );
      return { id };
    },
  };
}

const DEVELOPMENT_SENDER = "TimeCapsule <no-reply@localhost>";

// The mailer the settings call for: Resend once RESEND_API_KEY is set (always,
// in production), otherwise the console.
function createMailer(env) {
  if (env.RESEND_API_KEY) {
    return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  return createConsoleMailer({ from: env.EMAIL_FROM ?? DEVELOPMENT_SENDER });
}

module.exports = { MailerError, createMailer, createResendMailer, createConsoleMailer };

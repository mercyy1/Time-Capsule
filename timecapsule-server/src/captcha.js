// The check that a person, not a bot, is signing up or asking for a password
// reset: Cloudflare Turnstile. Both send an email to whatever address they're
// given, and the day's emails are few, so a bot repeating them could use them up.
//
// The page shows Turnstile's widget, which hands it a token once it's satisfied
// (usually without asking the visitor anything). The form sends the token along,
// and the server asks Cloudflare whether it's genuine. A token works once, for 5
// minutes. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
// A captcha has one method,
//   verify(token) -> Promise<boolean>
// which resolves to whether Cloudflare vouches for the token, and throws a
// CaptchaUnavailableError when it can't find out. Tests use a fake one.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Cloudflare's examples wait 10 seconds; the visitor is waiting too.
const TIMEOUT_MS = 8_000;

// Nobody can pass the check right now: Cloudflare couldn't be reached, or it
// refused our secret key. Not the visitor's doing.
class CaptchaUnavailableError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "CaptchaUnavailableError";
  }
}

// Answers about our side of the check rather than the visitor's token.
const NOT_THE_VISITOR = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "bad-request",
  "internal-error",
]);

function createTurnstileCaptcha({ secret, verifyUrl = SITEVERIFY_URL, timeoutMs = TIMEOUT_MS }) {
  return {
    async verify(token) {
      let res;
      try {
        // Sent as a form, the way Cloudflare's own examples do. The visitor's
        // address (remoteip) is left out: it's optional, and the address the
        // visitor used to reach Cloudflare can differ from the one that reaches
        // this server (IPv6 there, IPv4 here), which would fail genuine people.
        res = await fetch(verifyUrl, {
          method: "POST",
          body: new URLSearchParams({ secret, response: token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new CaptchaUnavailableError(`Couldn't reach Turnstile: ${err.message}`, {
          cause: err,
        });
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        // Not JSON (a proxy's error page, say), or cut off by the timeout.
      }
      if (!res.ok || typeof data?.success !== "boolean") {
        throw new CaptchaUnavailableError(`Turnstile answered ${res.status} without a verdict`);
      }

      const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
      const ours = codes.filter((code) => NOT_THE_VISITOR.has(code));
      if (ours.length > 0) {
        throw new CaptchaUnavailableError(`Turnstile refused the check: ${ours.join(", ")}`);
      }
      return data.success;
    },
  };
}

// The captcha the settings call for: Turnstile once TURNSTILE_SECRET_KEY is set
// (always, in production), or none at all (null), which turns the check off.
const createCaptcha = (env) =>
  env.TURNSTILE_SECRET_KEY ? createTurnstileCaptcha({ secret: env.TURNSTILE_SECRET_KEY }) : null;

module.exports = { CaptchaUnavailableError, createTurnstileCaptcha, createCaptcha, SITEVERIFY_URL };

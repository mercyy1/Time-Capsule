// Rate limits: how many requests one client may make in a time window. A client
// is an IP address (IPv6 addresses are grouped by /56, the block one household
// or office usually gets), so people behind one shared network share a count.
const { rateLimit } = require("express-rate-limit");
const { HttpError } = require("../errors");

const MINUTE = 60 * 1000;

const RATE_LIMITS = Object.freeze({
  // Every request: far above what people clicking around need (a page watching a
  // locked capsule asks every 10 seconds), but it stops floods and scraping.
  general: { limit: 1000, windowMs: 5 * MINUTE, message: "Too many requests." },
  // The account routes together: signing up, confirming an address, logging in,
  // and resetting a password. Most run bcrypt, which is slow on purpose, so this
  // also keeps a flood of them from tying up the server. Room for a class signing
  // up together on one network.
  auth: {
    limit: 30,
    windowMs: 15 * MINUTE,
    message: "Too many sign-up, login and password reset attempts.",
  },
  // Failed logins only (a wrong password, for example): slows down password
  // guessing without ever stopping someone who types theirs correctly.
  failedLogins: { limit: 10, windowMs: 15 * MINUTE, message: "Too many failed logins." },
});

const minutesUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / MINUTE));

function limiter(name, { limit, windowMs, message }, options = {}) {
  return rateLimit({
    limit,
    windowMs,
    // RateLimit and RateLimit-Policy headers (IETF draft 8) on every response, and
    // Retry-After (seconds) once the limit is reached.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: name,
    // Answers 429 Too Many Requests in the API's error shape.
    handler: (req, res, next) => {
      const resetTime = req.rateLimit.resetTime ?? new Date(Date.now() + windowMs);
      const minutes = minutesUntil(resetTime);
      const wait = `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
      next(new HttpError(429, "RATE_LIMITED", `${message} ${wait}`));
    },
    ...options,
  });
}

// New limiters with their own counts (each app gets its own, so tests don't share
// them). `limits` has the shape of RATE_LIMITS.
function createRateLimiters(limits = RATE_LIMITS) {
  return {
    general: limiter("general", limits.general),
    auth: limiter("auth", limits.auth),
    // Every login is counted, then taken off again if it succeeded (status < 400).
    failedLogins: limiter("failed-logins", limits.failedLogins, {
      skipSuccessfulRequests: true,
    }),
  };
}

module.exports = { RATE_LIMITS, createRateLimiters };

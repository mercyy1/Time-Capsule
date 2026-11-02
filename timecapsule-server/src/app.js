const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { getEnv } = require("./config/env");
const { prisma } = require("./db");
const { createRateLimiters, RATE_LIMITS } = require("./middleware/rateLimits");
const { createMailer } = require("./email/mailers");
const { createSender, emailLimits } = require("./email/sender");
const { createAccounts } = require("./services/accounts");
const { BackgroundTasks } = require("./background");
const { createCaptcha } = require("./captcha");
const { createAuthRouter } = require("./routes/auth");
const { createJobsRouter } = require("./routes/jobs");
const { createStatusRouter } = require("./routes/status");
const { sendUnlockEmails } = require("./jobs/unlockEmails");
const capsuleRoutes = require("./routes/capsules");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Builds the Express app without starting it, so tests can send it requests
// directly. Tests can also replace settings that normally come from the
// environment, and the parts that reach outside the server:
//   clientOrigins  the sites whose pages may call the API (CLIENT_ORIGIN)
//   trustProxy     how many proxies are in front of the server (TRUST_PROXY)
//   rateLimits     the limits, shaped like RATE_LIMITS
//   mailer         sends emails (see email/mailers.js)
//   emailLimits    how many emails may be sent (see email/sender.js)
//   appUrl         the web client's address, for links in emails (APP_URL)
//   tasks          runs work after responding (see background.js)
//   jobSecret      the scheduler's password; without one, /jobs is off (JOB_SECRET)
//   captcha        tells people from bots on signup and "forgot password" (see
//                  captcha.js); null turns the check off (TURNSTILE_SECRET_KEY)
//   checkDatabase  resolves once the database answers, for GET /health
function createApp({
  clientOrigins = getEnv().CLIENT_ORIGIN,
  trustProxy = getEnv().TRUST_PROXY,
  rateLimits = RATE_LIMITS,
  mailer = createMailer(getEnv()),
  emailLimits: limits = emailLimits(getEnv().EMAIL_DAILY_LIMIT),
  appUrl = getEnv().APP_URL,
  tasks = new BackgroundTasks(),
  jobSecret = getEnv().JOB_SECRET,
  captcha = createCaptcha(getEnv()),
  checkDatabase = () => prisma.$queryRaw`SELECT 1`,
} = {}) {
  const app = express();
  const limiters = createRateLimiters(rateLimits);
  const sender = createSender({ mailer, limits });
  const accounts = createAccounts({ sender, appUrl });

  // req.ip, which rate limits count by: behind trustProxy proxies it is taken from
  // X-Forwarded-For, otherwise it is the address that connected. (false rather than
  // 0, so express-rate-limit warns if X-Forwarded-For shows up unexpectedly.)
  app.set("trust proxy", trustProxy > 0 ? trustProxy : false);

  // Security headers on every response, errors included (e.g. X-Content-Type-Options:
  // nosniff, a strict Content-Security-Policy, Strict-Transport-Security), and no
  // X-Powered-By header advertising Express.
  app.use(helmet());
  // CORS (Cross-Origin Resource Sharing): browsers let a page call the API only
  // if the API names the page's origin in Access-Control-Allow-Origin. A listed
  // origin is echoed back there; any other origin gets no CORS headers, so the
  // browser blocks the call.
  app.use(cors({ origin: clientOrigins }));
  // After CORS, so the browser's preflight requests aren't counted; before the body
  // is parsed, so a flood is turned away cheaply.
  app.use(limiters.general);
  // The largest valid request, a capsule whose 10,000-character message is all
  // 4-byte characters such as emoji, is about 41 kB; anything over 64 kB is refused
  // before it is read into memory (Express's default limit is 100 kB).
  app.use(express.json({ limit: "64kb" }));

  // GET /, /health and /ip, for the host and for monitoring.
  app.use(createStatusRouter({ checkDatabase }));

  app.post(["/signup", "/verify-email", "/forgot-password", "/reset-password"], limiters.auth);
  app.post("/login", limiters.auth, limiters.failedLogins);
  // signup, verify-email, login, forgot-password, reset-password
  app.use(createAuthRouter({ accounts, sender, tasks, captcha }));
  app.use("/capsules", capsuleRoutes);
  if (jobSecret) {
    const runUnlockEmails = () => sendUnlockEmails({ sender, appUrl });
    app.use("/jobs", createJobsRouter({ jobSecret, runUnlockEmails }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

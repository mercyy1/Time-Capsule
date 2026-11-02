// The one place tests get the app (and the server's other parts) from, so the
// server's files can be reorganized without changing any test.
const { createApp } = require("../../src/app");
const { prisma } = require("../../src/db");
const { RATE_LIMITS } = require("../../src/middleware/rateLimits");
const { BackgroundTasks } = require("../../src/background");
const mailers = require("../../src/email/mailers");
const emailSender = require("../../src/email/sender");
const unlockEmails = require("../../src/jobs/unlockEmails");
const status = require("../../src/routes/status");
const shutdown = require("../../src/shutdown");
const errorHandling = require("../../src/middleware/errorHandler");
const { createFakeMailer } = require("./mailer");

// The real limits, but too high for any test to reach: each test file shares one
// app, and its tests sign up far more often than the real limits allow.
const UNREACHABLE_LIMITS = Object.fromEntries(
  Object.entries(RATE_LIMITS).map(([name, limits]) => [name, { ...limits, limit: 1_000_000 }]),
);

// Every app built here sends its emails to this fake mailer, and runs the work
// it does after responding (sending emails, mostly) through these tasks.
const mailer = createFakeMailer();
const backgroundErrors = [];
const tasks = new BackgroundTasks({ onError: (err) => backgroundErrors.push(err) });

// Waits until the work that requests started after responding is done, and
// throws the first failure, if any. Runs after every test (test/setup/settle.js).
async function settle() {
  await tasks.idle();
  const [failure] = backgroundErrors.splice(0);
  if (failure) throw failure;
}

// An app with some settings replaced (see createApp), for the tests that need one.
// Rate limits stay out of reach unless a test passes its own.
const buildApp = (options = {}) =>
  createApp({ rateLimits: UNREACHABLE_LIMITS, mailer, tasks, ...options });

module.exports = {
  app: buildApp(),
  buildApp,
  prisma,
  mailer,
  tasks,
  settle,
  BackgroundTasks,
  RATE_LIMITS,
  mailers,
  emailSender,
  unlockEmails,
  status,
  shutdown,
  errorHandling,
};

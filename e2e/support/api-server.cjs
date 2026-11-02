// Starts the API for the end-to-end tests. It's the real app (createApp, as
// src/server.js builds it) with three differences: its settings come from
// settings.cjs instead of a .env file, its rate limits are out of reach (the
// tests sign up far more often than any person), and its emails are appended to
// a file (OUTBOX) instead of being sent, so the tests can open the links in them.
const fs = require("node:fs");
const path = require("node:path");
const settings = require("./settings.cjs");

// Set before the server's modules load: they read the environment.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: settings.DATABASE_URL,
  JWT_SECRET: settings.JWT_SECRET,
  CLIENT_ORIGIN: settings.CLIENT_URL,
  APP_URL: settings.CLIENT_URL,
  TRUST_PROXY: "0",
  EMAIL_DAILY_LIMIT: "100000",
  EMAIL_FROM: "",
  RESEND_API_KEY: "",
  JOB_SECRET: settings.JOB_SECRET,
});

const serverSrc = path.join(__dirname, "..", "..", "timecapsule-server", "src");
const { createApp } = require(path.join(serverSrc, "app"));
const { RATE_LIMITS } = require(path.join(serverSrc, "middleware", "rateLimits"));

let sent = 0;
const outboxMailer = {
  async send(email) {
    sent += 1;
    const id = `e2e-${sent}`;
    fs.appendFileSync(settings.OUTBOX, `${JSON.stringify({ id, ...email })}\n`);
    return { id };
  },
};

const rateLimits = Object.fromEntries(
  Object.entries(RATE_LIMITS).map(([name, limits]) => [name, { ...limits, limit: 1_000_000 }]),
);

fs.mkdirSync(path.dirname(settings.OUTBOX), { recursive: true });
createApp({ mailer: outboxMailer, rateLimits }).listen(settings.API_PORT, () => {
  console.log(`End-to-end API listening on ${settings.API_URL}`);
});

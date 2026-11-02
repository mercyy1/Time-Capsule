// Runs before each test file. Sets every variable the server reads, so nothing
// leaks in from a developer's .env file (dotenv never overrides a variable that
// is already set) and every machine runs the tests the same way.
const { testDatabaseUrl } = require("./testDatabase");

Object.assign(process.env, {
  NODE_ENV: "test",
  PORT: "5000",
  DATABASE_URL: testDatabaseUrl,
  // Only Prisma's command line reads it (migrations), but a developer's .env
  // mustn't point it at another database.
  DATABASE_URL_UNPOOLED: testDatabaseUrl,
  JWT_SECRET: "test-only-secret-that-is-at-least-32-characters",
  CLIENT_ORIGIN: "http://localhost:3000",
  TRUST_PROXY: "0",
  APP_URL: "http://localhost:3000",
  EMAIL_DAILY_LIMIT: "100",
  // Empty means not set. Tests never reach a real email provider: they give the
  // app a fake mailer (test/helpers/mailer.js) and, where needed, a job secret.
  EMAIL_FROM: "",
  RESEND_API_KEY: "",
  JOB_SECRET: "",
});

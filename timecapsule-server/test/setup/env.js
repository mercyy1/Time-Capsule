// Runs before each test file. Sets every variable the server reads, so nothing
// leaks in from a developer's .env file (dotenv never overrides a variable that
// is already set) and every machine runs the tests the same way.
const { testDatabaseUrl } = require("./testDatabase");

Object.assign(process.env, {
  NODE_ENV: "test",
  PORT: "5000",
  DATABASE_URL: testDatabaseUrl,
  JWT_SECRET: "test-only-secret-that-is-at-least-32-characters",
  CLIENT_ORIGIN: "http://localhost:3000",
  TRUST_PROXY: "0",
});

// Where the end-to-end tests run everything. The ports differ from the dev
// servers' (3000 and 5000), so the tests can run while you develop.
const path = require("node:path");

const API_PORT = 5100;
const CLIENT_PORT = 3100;

module.exports = {
  API_PORT,
  API_URL: `http://localhost:${API_PORT}`,
  CLIENT_PORT,
  CLIENT_URL: `http://localhost:${CLIENT_PORT}`,
  // The tests delete all of its data, so its name must end in _e2e (checked by
  // global-setup.js). 127.0.0.1 rather than localhost: see the server's .env.example.
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ||
    "postgresql://timecapsule:timecapsule@127.0.0.1:5432/timecapsule_e2e",
  // Every email the test API sends, one JSON object per line (see api-server.cjs).
  OUTBOX: path.join(__dirname, "..", ".outbox", "emails.jsonl"),
  // The client, built for the tests (it talks to API_URL).
  CLIENT_BUILD: path.join(__dirname, "..", ".client"),
  JWT_SECRET: "e2e-only-secret-that-is-at-least-32-characters",
  JOB_SECRET: "e2e-only-job-secret-that-is-at-least-32-chars",
  PASSWORD: "correct horse battery",
  // The security check (Cloudflare Turnstile). The client is built with
  // Cloudflare's test site key, its script is replaced by a fake that hands out
  // the dummy token Cloudflare's test keys produce (turnstile.js), and the test
  // API accepts that token and no other (api-server.cjs).
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_TOKEN: "XXXX.DUMMY.TOKEN.XXXX",
};

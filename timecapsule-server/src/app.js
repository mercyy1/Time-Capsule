const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { getEnv } = require("./config/env");
const authRoutes = require("./routes/auth");
const capsuleRoutes = require("./routes/capsules");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Builds the Express app without starting it, so tests can send it requests
// directly. Tests can also replace settings that normally come from the
// environment:
//   clientOrigins  the sites whose pages may call the API (CLIENT_ORIGIN)
function createApp({ clientOrigins = getEnv().CLIENT_ORIGIN } = {}) {
  const app = express();

  // Security headers on every response, errors included (e.g. X-Content-Type-Options:
  // nosniff, a strict Content-Security-Policy, Strict-Transport-Security), and no
  // X-Powered-By header advertising Express.
  app.use(helmet());
  // CORS (Cross-Origin Resource Sharing): browsers let a page call the API only
  // if the API names the page's origin in Access-Control-Allow-Origin. A listed
  // origin is echoed back there; any other origin gets no CORS headers, so the
  // browser blocks the call.
  app.use(cors({ origin: clientOrigins }));
  // The largest valid request, a capsule whose 10,000-character message is all
  // 4-byte characters such as emoji, is about 41 kB; anything over 64 kB is refused
  // before it is read into memory (Express's default limit is 100 kB).
  app.use(express.json({ limit: "64kb" }));

  // Health check
  app.get("/", (req, res) => res.send("Time Capsule API"));

  app.use(authRoutes); // POST /signup, POST /login
  app.use("/capsules", capsuleRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { getEnv } = require("./config/env");
const authRoutes = require("./routes/auth");
const capsuleRoutes = require("./routes/capsules");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Builds the Express app without starting it, so tests can send it requests directly.
function createApp() {
  const app = express();

  // Security headers on every response, errors included (e.g. X-Content-Type-Options:
  // nosniff, a strict Content-Security-Policy, Strict-Transport-Security), and no
  // X-Powered-By header advertising Express.
  app.use(helmet());
  app.use(cors({ origin: getEnv().CLIENT_ORIGIN }));
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

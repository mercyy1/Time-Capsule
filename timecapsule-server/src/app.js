const express = require("express");
const cors = require("cors");
const { getEnv } = require("./config/env");
const authRoutes = require("./routes/auth");
const capsuleRoutes = require("./routes/capsules");
const { errorHandler, notFound } = require("./middleware/errorHandler");

// Builds the Express app without starting it, so tests can send it requests directly.
function createApp() {
  const app = express();

  app.use(cors({ origin: getEnv().CLIENT_ORIGIN }));
  app.use(express.json());

  // Health check
  app.get("/", (req, res) => res.send("Time Capsule API"));

  app.use(authRoutes); // POST /signup, POST /login
  app.use("/capsules", capsuleRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

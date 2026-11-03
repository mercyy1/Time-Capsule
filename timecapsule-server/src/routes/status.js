const express = require("express");
const { HttpError } = require("../errors");

// Long enough for a database that was asleep (Neon's free plan stops it after 5
// idle minutes and wakes it on the next query).
const DATABASE_TIMEOUT_MS = 10_000;

// Rejects if `promise` hasn't settled after `ms`.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Routes for the host and for whoever looks after the server, beside the API:
//   GET /        answers at once and touches nothing. The host's health checks
//                (every few seconds) and the keep-awake pings use it, so they
//                never wake the database, whose free plan counts its hours awake.
//   GET /health  also asks the database (SELECT 1): 200 when it answers, 503 when
//                it doesn't. For people and occasional checks.
//   GET /ip      the caller's address as this server sees it, which is what rate
//                limits count by: for checking TRUST_PROXY on a new host.
// `checkDatabase` resolves once the database answers.
function createStatusRouter({ checkDatabase, databaseTimeoutMs = DATABASE_TIMEOUT_MS }) {
  const router = express.Router();

  router.get("/", (req, res) => res.send("Time Capsule API"));

  router.get("/health", async (req, res) => {
    try {
      await withTimeout(Promise.resolve().then(checkDatabase), databaseTimeoutMs);
    } catch (err) {
      console.error("Health check: the database didn't answer:", err.message);
      throw new HttpError(503, "DATABASE_UNAVAILABLE", "The database isn't answering.");
    }
    res.set("Cache-Control", "no-store").json({ status: "ok", database: "ok" });
  });

  router.get("/ip", (req, res) => {
    res.set("Cache-Control", "no-store").json({ ip: req.ip });
  });

  return router;
}

module.exports = { createStatusRouter };

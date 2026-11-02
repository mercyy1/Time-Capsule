// The one place tests get the app (and the server's other parts) from, so the
// server's files can be reorganized without changing any test.
const { createApp } = require("../../src/app");
const { prisma } = require("../../src/db");
const { RATE_LIMITS } = require("../../src/middleware/rateLimits");
const mailers = require("../../src/email/mailers");

// The real limits, but too high for any test to reach: each test file shares one
// app, and its tests sign up far more often than the real limits allow.
const UNREACHABLE_LIMITS = Object.fromEntries(
  Object.entries(RATE_LIMITS).map(([name, limits]) => [name, { ...limits, limit: 1_000_000 }]),
);

// An app with some settings replaced (see createApp), for the tests that need one.
// Rate limits stay out of reach unless a test passes its own.
const buildApp = (options = {}) => createApp({ rateLimits: UNREACHABLE_LIMITS, ...options });

module.exports = { app: buildApp(), buildApp, prisma, RATE_LIMITS, mailers };

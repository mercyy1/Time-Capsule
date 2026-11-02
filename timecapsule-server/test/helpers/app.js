// The one place tests get the app from, so the server's files can be
// reorganized without changing any test.
const { createApp } = require("../../src/app");
const { prisma } = require("../../src/db");

// An app with some settings replaced (see createApp), for the tests that need one.
const buildApp = (options = {}) => createApp(options);

module.exports = { app: buildApp(), buildApp, prisma };

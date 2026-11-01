// The one place tests get the app from, so the server's files can be
// reorganized without changing any test.
const { createApp } = require("../../src/app");
const { prisma } = require("../../src/db");

module.exports = { app: createApp(), prisma };

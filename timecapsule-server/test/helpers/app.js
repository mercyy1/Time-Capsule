// The one place tests get the app from, so the server's files can be
// reorganized without changing any test.
const { app, prisma } = require("../../index");

module.exports = { app, prisma };

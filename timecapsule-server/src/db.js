// The app's one database client. Prisma opens its connection pool on first use.
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = { prisma };

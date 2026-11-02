const bcrypt = require("bcrypt");
const { prisma } = require("../db");

const BCRYPT_ROUNDS = 10;

const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });

// Stores a bcrypt hash of the password, never the password itself.
async function createUser(email, password) {
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  return prisma.user.create({ data: { email, password: hashedPassword } });
}

const passwordMatches = (user, password) => bcrypt.compare(password, user.password);

// The only user fields the API ever returns.
const toPublicUser = (user) => ({ id: user.id, email: user.email });

module.exports = { findUserByEmail, createUser, passwordMatches, toPublicUser };

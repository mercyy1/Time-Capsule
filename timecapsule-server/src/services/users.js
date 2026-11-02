const bcrypt = require("bcrypt");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../db");

const BCRYPT_ROUNDS = 10;

const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });

// Prisma's error code for "this value is already in a unique column".
const UNIQUE_VIOLATION = "P2002";

// Stores a bcrypt hash of the password, never the password itself. Returns null
// if the email is already registered. The database's unique index on email is
// what decides, so two signups with one email at the same moment can't both win.
async function createUser(email, password) {
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    return await prisma.user.create({ data: { email, password: hashedPassword } });
  } catch (err) {
    // email is the only unique column a signup fills in.
    const emailTaken =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
    if (emailTaken) return null;
    throw err;
  }
}

const passwordMatches = (user, password) => bcrypt.compare(password, user.password);

// The only user fields the API ever returns.
const toPublicUser = (user) => ({ id: user.id, email: user.email });

module.exports = { findUserByEmail, createUser, passwordMatches, toPublicUser };

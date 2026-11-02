const { randomUUID } = require("node:crypto");
const bcrypt = require("bcrypt");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../db");

const BCRYPT_ROUNDS = 10;

const findUserByEmail = (email) => prisma.user.findUnique({ where: { email } });

// What checking a login token needs to know about its user (the public fields
// and the token version), or null if there is no user with this id.
const findUserForToken = (id) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, email: true, tokenVersion: true } });

// Prisma's error code for "this value is already in a unique column".
const UNIQUE_VIOLATION = "P2002";

// Passwords are stored as bcrypt hashes, never as typed. bcrypt is slow on
// purpose (about 60 ms here), so stolen hashes are slow to guess from.
const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

// Creates an account, with its email address not confirmed yet. Returns null if
// the email is already registered. The database's unique index on email is what
// decides, so two signups with one email at the same moment can't both win.
async function createUser(email, passwordHash) {
  try {
    return await prisma.user.create({ data: { email, password: passwordHash } });
  } catch (err) {
    // email is the only unique column a signup fills in.
    const emailTaken =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
    if (emailTaken) return null;
    throw err;
  }
}

// A hash of a random password nobody knows, made with the same cost as real
// ones. Made once, in the background, when the server starts.
const dummyHash = hashPassword(randomUUID());
// Avoids an "unhandled rejection" crash if it ever failed; a login that needs it
// would still see the error.
dummyHash.catch(() => {});

// Checks a login password. Without a user (the email has no account) it still
// does a full bcrypt comparison, against the dummy hash, and returns false: a
// login for an unknown email then takes as long as one with a wrong password,
// so response times don't reveal which emails have accounts.
async function passwordMatches(user, password) {
  const matches = await bcrypt.compare(password, user ? user.password : await dummyHash);
  return Boolean(user) && matches;
}

// The only user fields the API ever returns.
const toPublicUser = (user) => ({ id: user.id, email: user.email });

module.exports = {
  findUserByEmail,
  findUserForToken,
  hashPassword,
  createUser,
  passwordMatches,
  toPublicUser,
};

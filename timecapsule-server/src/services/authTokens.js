// The secrets in emailed links: "confirm your email address" and "reset your
// password". The link holds the secret (a token); the database holds only its
// hash, so a copy of the database contains no working links.
const { createHash, randomBytes } = require("node:crypto");
const { prisma } = require("../db");

const HOUR_MS = 60 * 60 * 1000;

// How long each kind of link works.
const LIFETIMES = Object.freeze({ VERIFY_EMAIL: 24 * HOUR_MS, RESET_PASSWORD: HOUR_MS });

// 32 random bytes: 256 bits, far beyond guessing. In base64url, which only uses
// characters that are safe in a URL, that's 43 characters.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => randomBytes(32).toString("base64url");

// A fast hash (SHA-256) is enough here, unlike for passwords: a token can't be
// guessed however fast guesses are checked, and links are looked up by hash.
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Stores a new link of this kind for the user. Returns the token (for the link)
// and the stored row. `passwordHash`: see AuthToken in schema.prisma.
async function createAuthToken({ kind, userId, passwordHash = null, now = new Date() }) {
  const token = newToken();
  const record = await prisma.authToken.create({
    data: {
      kind,
      userId,
      passwordHash,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + LIFETIMES[kind]),
    },
  });
  return { token, record };
}

// The stored link of this kind for `token`, with its user, or null. Whether it
// is expired or already used is for the caller to check. A token that can't be
// one of ours doesn't reach the database.
async function findAuthToken(kind, token) {
  if (!TOKEN_FORMAT.test(token)) return null;
  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  return record?.kind === kind ? record : null;
}

const deleteAuthToken = (id) => prisma.authToken.deleteMany({ where: { id } });

module.exports = { LIFETIMES, createAuthToken, findAuthToken, deleteAuthToken };

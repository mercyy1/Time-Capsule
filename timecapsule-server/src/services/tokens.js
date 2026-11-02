// Login tokens are JWTs (JSON Web Tokens): signed JSON the client sends back on
// every request to prove who it is. They hold the user's id and email, and the
// account's token version (`ver`) when they were made, and expire after one
// day. Changing the password raises the account's version, which ends every
// token made before.
const jwt = require("jsonwebtoken");
const { getEnv } = require("../config/env");

// The one signing algorithm we use. jwt.verify would otherwise accept any HMAC
// variant (HS384, HS512) signed with the secret; pinning it means a token is
// only ever checked the way it was made.
const ALGORITHM = "HS256";

function generateAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email, ver: user.tokenVersion }, getEnv().JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: "1d",
  });
}

// Checks a token. Returns { payload } ({ id, email, ver, iat, exp }) if it is valid,
// otherwise { problem: "expired" } for a token that was valid but ran out, or
// { problem: "invalid" } for anything else (garbage, another secret, tampered).
function verifyAccessToken(token) {
  try {
    return { payload: jwt.verify(token, getEnv().JWT_SECRET, { algorithms: [ALGORITHM] }) };
  } catch (err) {
    return { problem: err instanceof jwt.TokenExpiredError ? "expired" : "invalid" };
  }
}

module.exports = { generateAccessToken, verifyAccessToken };

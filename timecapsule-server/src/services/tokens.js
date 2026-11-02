// Login tokens are JWTs (JSON Web Tokens): signed JSON the client sends back on
// every request to prove who it is. They hold the user's id and email and
// expire after one day.
const jwt = require("jsonwebtoken");
const { getEnv } = require("../config/env");

function generateAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, getEnv().JWT_SECRET, {
    expiresIn: "1d",
  });
}

// Checks a token. Returns { payload } ({ id, email, iat, exp }) if it is valid,
// otherwise { problem: "expired" } for a token that was valid but ran out, or
// { problem: "invalid" } for anything else (garbage, another secret, tampered).
function verifyAccessToken(token) {
  try {
    return { payload: jwt.verify(token, getEnv().JWT_SECRET) };
  } catch (err) {
    return { problem: err instanceof jwt.TokenExpiredError ? "expired" : "invalid" };
  }
}

module.exports = { generateAccessToken, verifyAccessToken };

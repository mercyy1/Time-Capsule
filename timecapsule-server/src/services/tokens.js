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

// The token's payload ({ id, email, iat, exp }), or null if the token is
// invalid, expired or signed with another secret.
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, getEnv().JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { generateAccessToken, verifyAccessToken };

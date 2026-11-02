const { verifyAccessToken } = require("../services/tokens");

// Requires an "Authorization: Bearer <token>" header and puts the token's
// payload ({ id, email }) on req.user for the route.
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed token" });

  const user = verifyAccessToken(token);
  if (!user) return res.status(403).json({ error: "Invalid token" });

  req.user = user;
  next();
}

module.exports = { authenticate };

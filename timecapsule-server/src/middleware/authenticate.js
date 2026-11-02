const { HttpError } = require("../errors");
const { verifyAccessToken } = require("../services/tokens");

// Requires an "Authorization: Bearer <token>" header and puts the token's
// payload ({ id, email }) on req.user for the route.
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return next(new HttpError(401, "AUTH_REQUIRED", "No token provided"));

  const token = authHeader.split(" ")[1];
  if (!token) return next(new HttpError(401, "AUTH_REQUIRED", "Malformed token"));

  const user = verifyAccessToken(token);
  if (!user) return next(new HttpError(403, "INVALID_TOKEN", "Invalid token"));

  req.user = user;
  next();
}

module.exports = { authenticate };

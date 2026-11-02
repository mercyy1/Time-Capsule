const { HttpError } = require("../errors");
const { verifyAccessToken } = require("../services/tokens");

// Every failure is a 401, which tells the client "log in again". HTTP requires a
// 401 to say how to authenticate, hence the WWW-Authenticate header (RFC 6750).
const unauthorized = (code, message, challenge) =>
  new HttpError(401, code, message, { headers: { "WWW-Authenticate": challenge } });

// Requires an "Authorization: Bearer <token>" header and puts the token's
// payload ({ id, email }) on req.user for the route.
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return next(unauthorized("AUTH_REQUIRED", "No token provided", "Bearer"));

  const token = authHeader.split(" ")[1];
  if (!token) {
    return next(unauthorized("AUTH_REQUIRED", "Malformed token", 'Bearer error="invalid_request"'));
  }

  const { payload, problem } = verifyAccessToken(token);
  if (problem === "expired") {
    return next(
      unauthorized(
        "TOKEN_EXPIRED",
        "Your session has expired. Please log in again.",
        'Bearer error="invalid_token", error_description="The token has expired"',
      ),
    );
  }
  if (problem) {
    return next(unauthorized("INVALID_TOKEN", "Invalid token", 'Bearer error="invalid_token"'));
  }

  req.user = payload;
  next();
}

module.exports = { authenticate };

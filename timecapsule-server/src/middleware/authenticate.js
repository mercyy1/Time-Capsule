const { HttpError } = require("../errors");
const { verifyAccessToken } = require("../services/tokens");
const { findUserForToken } = require("../services/users");

// Every failure is a 401, which tells the client "log in again". HTTP requires a
// 401 to say how to authenticate, hence the WWW-Authenticate header (RFC 6750).
const unauthorized = (code, message, challenge) =>
  new HttpError(401, code, message, { headers: { "WWW-Authenticate": challenge } });
const invalidToken = () =>
  unauthorized("INVALID_TOKEN", "Invalid token", 'Bearer error="invalid_token"');

// "Bearer <token>". The scheme name is case-insensitive in HTTP; a token never
// contains spaces.
const BEARER = /^Bearer +(\S+)$/i;

// Requires an "Authorization: Bearer <token>" header for a user who still exists
// and hasn't changed their password since, and puts that user ({ id, email }) on
// req.user for the route.
async function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return next(unauthorized("AUTH_REQUIRED", "No token provided", "Bearer"));

  const token = BEARER.exec(authHeader)?.[1];
  if (!token) {
    return next(
      unauthorized(
        "AUTH_REQUIRED",
        "The Authorization header must be: Bearer <token>",
        'Bearer error="invalid_request"',
      ),
    );
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
  if (problem) return next(invalidToken());

  // A token outlives a deleted account, so the account must still be there.
  const user = Number.isInteger(payload.id) ? await findUserForToken(payload.id) : null;
  // Tokens made before token versions existed have none.
  if (!user || !Number.isInteger(payload.ver)) return next(invalidToken());
  // The password changed since this token was made.
  if (payload.ver !== user.tokenVersion) {
    return next(
      unauthorized(
        "TOKEN_REVOKED",
        "You've been logged out because your password was changed. Please log in again.",
        'Bearer error="invalid_token", error_description="The token has been revoked"',
      ),
    );
  }

  req.user = { id: user.id, email: user.email };
  next();
}

module.exports = { authenticate };

const { HttpError } = require("../errors");

// express.json() (body-parser) marks the errors it raises with a `type`. Its own
// messages are terse, so the common ones get clearer wording.
const BODY_PARSER_ERRORS = {
  "entity.parse.failed": () =>
    new HttpError(400, "INVALID_JSON", "The request body isn't valid JSON"),
  "entity.too.large": (err) =>
    new HttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      `The request body is too large (the limit is ${Math.floor(err.limit / 1024)} kB)`,
    ),
};

// The HttpError to send for `err`, or null if it is an unexpected server error.
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  const fromBodyParser = BODY_PARSER_ERRORS[err.type];
  if (fromBodyParser) return fromBodyParser(err);
  // Any other client error that Express or body-parser raised, such as 415 for an
  // unsupported character set.
  const status = err.status ?? err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return new HttpError(status, "BAD_REQUEST", "The request couldn't be read");
  }
  return null;
}

// Every error ends up here: Express 5 also forwards rejected promises from async
// routes. Client errors are answered quietly; anything else is logged and becomes a
// 500 that reveals nothing about the cause. Express treats a middleware as an
// error handler only if it takes four arguments, so `next` must stay.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err); // too late to answer; Express closes the connection

  let httpError = toHttpError(err);
  if (!httpError) {
    console.error(err);
    httpError = new HttpError(500, "INTERNAL_ERROR", "Something went wrong");
  }

  const { status, code, message, details, headers } = httpError;
  if (headers) res.set(headers);
  res.status(status).json({ error: message, code, ...(details && { details }) });
}

// Answers requests that matched no route (instead of Express's HTML page).
function notFound(req, res, next) {
  next(new HttpError(404, "NOT_FOUND", "Not found"));
}

module.exports = { errorHandler, notFound };

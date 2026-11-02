// An error a route or middleware can throw to send a specific HTTP status. The
// error handler turns it into the API's one error shape:
//   { "error": "<message for people>", "code": "<CODE for programs>", "details": [...] }
// `error` is always a string the client can show as is. `details` is present only
// for validation errors: one { field, message } entry per problem.
class HttpError extends Error {
  constructor(status, code, message, { details, headers } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

module.exports = { HttpError };

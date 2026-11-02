const { HttpError } = require("./errors");

// Checks `input` against a zod schema and returns the parsed value (trimmed,
// converted to the right types). If anything is wrong it throws a 400 that lists
// every problem in `details`; `error` repeats the first one, so a client that
// shows only `error` still tells the user what to fix.
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    ...(issue.path.length > 0 && { field: issue.path.join(".") }),
    message: issue.message,
  }));
  throw new HttpError(400, "VALIDATION_FAILED", details[0].message, { details });
}

module.exports = { parse };

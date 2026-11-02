// What each route accepts. Every request is checked here before it reaches the
// database, so a wrong type or an oversized value is a clear 400 instead of a
// crash, and unknown fields are dropped. Messages are written for the people
// using the app, because the client shows them as they are.
const { z } = require("zod");

const EMAIL_MAX_LENGTH = 254; // the longest address email standards allow
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignores anything after the first 72 bytes

// Messages for a field that is missing or isn't a string.
const text = (label) => ({
  error: (issue) => (issue.input === undefined ? `${label} is required` : `${label} must be text`),
});

const body = (shape) => z.object(shape, { error: "The request body must be a JSON object" });

// Emails are compared in lowercase, so Ada@Example.com and ada@example.com are
// the same account.
const email = z
  .string(text("Email"))
  .trim()
  .toLowerCase()
  .min(1, { error: "Email is required" })
  .max(EMAIL_MAX_LENGTH, { error: `Email must be at most ${EMAIL_MAX_LENGTH} characters` })
  .pipe(z.email({ error: "Enter a valid email address" }));

// Passwords are used exactly as typed: never trimmed or lowercased.
const newPassword = z
  .string(text("Password"))
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  .refine((value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES, {
    error: `Password must be at most ${PASSWORD_MAX_BYTES} bytes (accented letters and emoji count as 2 to 4 bytes each)`,
  });

const signupBody = body({ email, password: newPassword });

// Login takes any password: a wrong one simply doesn't match.
const loginBody = body({
  email,
  password: z.string(text("Password")).min(1, { error: "Password is required" }),
});

module.exports = { signupBody, loginBody };

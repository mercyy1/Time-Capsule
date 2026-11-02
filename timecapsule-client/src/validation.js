// The form rules the API also enforces (see the README's input rules), checked
// in the browser first so mistakes show next to the field straight away. They
// are react-hook-form rules: register("email", emailRules).

export const emailRules = {
  required: "Enter your email address",
  maxLength: { value: 254, message: "Use an email address of at most 254 characters" },
  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" },
};

// A new password: at least 8 characters, and at most 72 bytes (bcrypt, which
// stores passwords, ignores the rest).
export const newPasswordRules = {
  required: "Choose a password",
  minLength: { value: 8, message: "Use at least 8 characters" },
  validate: (value) =>
    new TextEncoder().encode(value).length <= 72 ||
    "Use at most 72 bytes (accented letters and emoji count as 2 to 4 bytes each)",
};

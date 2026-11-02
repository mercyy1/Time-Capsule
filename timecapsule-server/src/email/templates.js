// The text of every email the server sends. Plain text only: whatever users
// typed stays text, with no way to turn into HTML or a disguised link. Each
// function returns { subject, text } (and replyTo when replies should go to
// someone), always the same for the same input, so that a retried email is the
// same email.

const lines = (...parts) => parts.join("\n");

// After signing up: confirms the address (and that the person signing up can
// read its inbox).
function confirmEmail({ link }) {
  return {
    subject: "Confirm your email address for TimeCapsule",
    text: lines(
      "Welcome to TimeCapsule!",
      "",
      "Confirm your email address to finish signing up:",
      link,
      "",
      "The link works for 24 hours. If you didn't sign up, you can ignore this email.",
    ),
  };
}

// Sent instead of a confirmation link when someone signs up with an address that
// already has an account, so signing up doesn't reveal which addresses have one.
function accountExists({ appUrl }) {
  return {
    subject: "You already have a TimeCapsule account",
    text: lines(
      "Someone, probably you, tried to sign up for TimeCapsule with this email address, but it already has an account.",
      "",
      `Log in: ${appUrl}/login`,
      `Forgot your password? Choose a new one: ${appUrl}/forgot-password`,
      "",
      "If it wasn't you, you can ignore this email: nothing has changed.",
    ),
  };
}

// After "Forgot your password?": a link to choose a new one.
function resetPassword({ link }) {
  return {
    subject: "Reset your TimeCapsule password",
    text: lines(
      "Someone, probably you, asked to reset the password of your TimeCapsule account.",
      "",
      "Choose a new password:",
      link,
      "",
      "The link works once, for 1 hour. If you didn't ask, you can ignore this email: your password hasn't changed.",
    ),
  };
}

module.exports = { confirmEmail, accountExists, resetPassword };

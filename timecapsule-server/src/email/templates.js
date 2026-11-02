// The text of every email the server sends. Plain text only: whatever users
// typed stays text, with no way to turn into HTML or a disguised link. Each
// function returns { subject, text } (and replyTo when replies should go to
// someone), always the same for the same input, so that a retried email is the
// same email.

const lines = (...parts) => parts.join("\n");

// Text on one line (titles may hold line breaks; subjects can't), at most `max`
// characters. Counted in code points, so an emoji is never cut in half.
function oneLine(text, max = Infinity) {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"}`;

// How long a capsule stayed sealed, in words: "2 years", "5 months", "12 days",
// "3 hours"... A length of time, rather than dates, reads the same in every time
// zone (and the server doesn't know the reader's).
function sealedFor(from, to) {
  const msIntoMonth = (date) =>
    date.getTime() - Date.UTC(date.getUTCFullYear(), date.getUTCMonth());
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // Not a whole month yet if `to` is earlier in its month than `from` was.
  if (msIntoMonth(to) < msIntoMonth(from)) months -= 1;
  if (months >= 12) return plural(Math.floor(months / 12), "year");
  if (months >= 1) return plural(months, "month");

  const minutes = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 60_000));
  if (minutes >= 24 * 60) return plural(Math.floor(minutes / (24 * 60)), "day");
  if (minutes >= 60) return plural(Math.floor(minutes / 60), "hour");
  return plural(minutes, "minute");
}

// Subjects show at most this much of a capsule's title (titles go up to 200).
const SUBJECT_TITLE_LENGTH = 80;

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

// To the owner when their capsule opens. The message itself only when the owner
// asked for it to be emailed to themselves (`includeMessage`); otherwise a link
// to read it in the app, and who else it was emailed to (`recipientEmail`).
// `capsule`: { title, message, slug, createdAt, unlockDate }.
function capsuleOpened({ capsule, appUrl, recipientEmail = null, includeMessage = false }) {
  const opened = `Your time capsule "${oneLine(capsule.title)}" has opened. It stayed sealed for ${sealedFor(capsule.createdAt, capsule.unlockDate)}.`;
  const link = `${appUrl}/capsule/${capsule.slug}`;
  return {
    subject: `Your time capsule "${oneLine(capsule.title, SUBJECT_TITLE_LENGTH)}" has opened`,
    text: includeMessage
      ? lines(
          `${opened} Here's what you wrote:`,
          "",
          capsule.message,
          "",
          "---",
          `You can also read it in TimeCapsule: ${link}`,
        )
      : lines(
          opened,
          "",
          `Read it (you'll need to log in): ${link}`,
          ...(recipientEmail
            ? ["", `We've also emailed it to ${recipientEmail}, as you asked.`]
            : []),
        ),
  };
}

// To the recipient the owner chose, with the message. Replies go to the owner.
// `capsule`: { title, message, slug, isPublic, createdAt, unlockDate }.
function capsuleDelivered({ capsule, ownerEmail, appUrl }) {
  return {
    subject: `A time capsule from ${ownerEmail}: "${oneLine(capsule.title, SUBJECT_TITLE_LENGTH)}"`,
    text: lines(
      `${ownerEmail} wrote you a message on TimeCapsule and sealed it for ${sealedFor(capsule.createdAt, capsule.unlockDate)}. It has now opened.`,
      "",
      `"${oneLine(capsule.title)}"`,
      "",
      capsule.message,
      "",
      ...(capsule.isPublic
        ? [`You can also read it online: ${appUrl}/public/${capsule.slug}`, ""]
        : []),
      "---",
      `You're getting this email because ${ownerEmail} asked TimeCapsule to send it to you when the capsule opened. Replying reaches them. If you don't know them, you can ignore this email.`,
    ),
    replyTo: ownerEmail,
  };
}

module.exports = { confirmEmail, accountExists, resetPassword, capsuleOpened, capsuleDelivered };

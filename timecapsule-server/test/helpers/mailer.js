// A mailer for tests: it records the emails it's given instead of sending them,
// and can be told to fail the way the real provider does.
const { MailerError } = require("../../src/email/mailers");

function createFakeMailer() {
  const failures = [];
  const idsByKey = new Map();
  let count = 0;

  const mailer = {
    // Every email "sent", oldest first: { id, to, subject, text, replyTo, idempotencyKey }.
    sent: [],

    async send(email) {
      // Like a real request, it takes a moment (lets concurrent work interleave).
      await new Promise((resolve) => setImmediate(resolve));
      const failure = failures.shift();
      if (failure) throw failure;
      // Like Resend: repeating a request with the same key returns the first
      // answer and sends nothing.
      if (email.idempotencyKey && idsByKey.has(email.idempotencyKey)) {
        return { id: idsByKey.get(email.idempotencyKey) };
      }
      count += 1;
      const id = `fake-${count}`;
      if (email.idempotencyKey) idsByKey.set(email.idempotencyKey, id);
      mailer.sent.push({ id, ...email });
      return { id };
    },

    // The next `times` emails fail with a MailerError of this kind ("quota",
    // "unavailable", "rejected" or "config").
    failNext(kind, { times = 1, outcomeUnknown = false } = {}) {
      for (let i = 0; i < times; i++) {
        failures.push(new MailerError(kind, `Fake ${kind} failure`, { outcomeUnknown }));
      }
    },

    // The emails sent to `address`, oldest first.
    to: (address) => mailer.sent.filter((email) => email.to === address),

    reset() {
      mailer.sent.length = 0;
      failures.length = 0;
      idsByKey.clear();
    },
  };
  return mailer;
}

// The token in an emailed link such as http://localhost:3000/verify-email#token=...
function linkToken(email, path) {
  const match = new RegExp(`/${path}#token=([A-Za-z0-9_-]+)`).exec(email.text);
  if (!match) throw new Error(`No /${path} link in the email "${email.subject}"`);
  return match[1];
}

module.exports = { createFakeMailer, linkToken };

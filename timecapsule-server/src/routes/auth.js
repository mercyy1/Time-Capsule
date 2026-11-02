const express = require("express");
const { HttpError } = require("../errors");
const { parse } = require("../validation");
const { signupBody, loginBody, verifyEmailBody } = require("../schemas");
const { findUserByEmail, passwordMatches, toPublicUser } = require("../services/users");
const { generateAccessToken } = require("../services/tokens");
const { secondsUntilNextUtcDay } = require("../email/sender");

// The same answer for an unknown email and a wrong password, so a failed login
// doesn't reveal which emails have accounts.
const invalidCredentials = () =>
  new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password", {
    headers: { "WWW-Authenticate": "Bearer" },
  });

// The account routes. `accounts` runs the flows (../services/accounts.js),
// `sender` knows the email limits, and `tasks` runs work after responding.
function createAuthRouter({ accounts, sender, tasks }) {
  const router = express.Router();

  // A route that sends an account email answers 503 once today's emails are used
  // up, instead of promising an email that can't be sent. The limit is the same
  // for everyone, so this says nothing about any address.
  async function refuseWhenOutOfEmails() {
    if (await sender.canSendAccountEmail()) return;
    throw new HttpError(
      503,
      "EMAIL_LIMIT_REACHED",
      "We've sent as many emails as we can today. Please try again tomorrow.",
      { headers: { "Retry-After": String(secondsUntilNextUtcDay(sender.now())) } },
    );
  }

  router.post("/signup", async (req, res) => {
    const { email, password } = parse(signupBody, req.body);
    await refuseWhenOutOfEmails();

    // Everything else happens after responding, so the answer and the time it
    // takes are the same whether or not the address already has an account.
    tasks.run("sign up", () => accounts.signUp(email, password));
    // 202 Accepted: the request is taken, the account comes once it's confirmed.
    res.status(202).json({
      message: `We've sent an email to ${email}. Open the link in it to finish signing up.`,
    });
  });

  router.post("/verify-email", async (req, res) => {
    const { token } = parse(verifyEmailBody, req.body);

    const user = await accounts.confirmEmail(token);
    if (!user) {
      throw new HttpError(
        400,
        "INVALID_LINK",
        "This confirmation link is invalid or has expired. Log in to get a new one.",
      );
    }
    res.json({
      message: "Your email address is confirmed. You can log in now.",
      email: user.email,
    });
  });

  router.post("/login", async (req, res) => {
    const { email, password } = parse(loginBody, req.body);

    const user = await findUserByEmail(email);
    // Called even when there is no such user, so both failures take as long.
    const validPassword = await passwordMatches(user, password);
    if (!validPassword) throw invalidCredentials();

    if (!user.emailVerifiedAt) {
      // The right password proves who is asking, so the answer can say what's
      // missing, and a new link goes out (within the email limits).
      tasks.run("resend a confirmation link", () => accounts.sendConfirmation(user, user.password));
      throw new HttpError(
        403,
        "EMAIL_NOT_VERIFIED",
        `Please confirm your email address first: open the link we've emailed to ${user.email}.`,
      );
    }

    res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
  });

  return router;
}

module.exports = { createAuthRouter };

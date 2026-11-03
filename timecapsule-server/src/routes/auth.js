const express = require("express");
const { HttpError } = require("../errors");
const { parse } = require("../validation");
const {
  signupBody,
  loginBody,
  verifyEmailBody,
  forgotPasswordBody,
  resetPasswordBody,
} = require("../schemas");
const { findUserByEmail, passwordMatches, toPublicUser } = require("../services/users");
const { generateAccessToken } = require("../services/tokens");
const { secondsUntilNextUtcDay } = require("../email/sender");
const { CaptchaUnavailableError } = require("../captcha");

// The same answer for an unknown email and a wrong password, so a failed login
// doesn't reveal which emails have accounts.
const invalidCredentials = () =>
  new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password", {
    headers: { "WWW-Authenticate": "Bearer" },
  });

// The account routes. `accounts` runs the flows (../services/accounts.js),
// `sender` knows the email limits, `tasks` runs work after responding, and
// `captcha` tells people from bots (../captcha.js; null turns the check off).
function createAuthRouter({ accounts, sender, tasks, captcha = null }) {
  const router = express.Router();

  // Signup and "forgot password" email whatever address they're given, so they
  // first check that a person is asking: a bot repeating them would use up the
  // day's emails. The answer is the same whatever the address, so it reveals
  // nothing about who has an account.
  async function requireHuman(token) {
    if (!captcha) return;
    let human = false;
    if (token) {
      try {
        human = await captcha.verify(token);
      } catch (err) {
        if (!(err instanceof CaptchaUnavailableError)) throw err;
        // Logged: a refused secret key needs someone to fix the settings.
        console.error("The security check is unavailable:", err.message);
        throw new HttpError(
          503,
          "CAPTCHA_UNAVAILABLE",
          "The security check isn't working right now. Please try again in a few minutes.",
        );
      }
    }
    if (!human) {
      throw new HttpError(
        400,
        "CAPTCHA_FAILED",
        "The security check didn't go through. Please try again.",
      );
    }
  }

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
    const { email, password, captchaToken } = parse(signupBody, req.body);
    await requireHuman(captchaToken);
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

  router.post("/forgot-password", async (req, res) => {
    const { email, captchaToken } = parse(forgotPasswordBody, req.body);
    await requireHuman(captchaToken);
    await refuseWhenOutOfEmails();

    // After responding, like signup: the answer, and the time it takes, are the
    // same whether or not the address has an account.
    tasks.run("send a password reset link", () => accounts.requestPasswordReset(email));
    res.status(202).json({
      message: `If ${email} has an account, we've emailed it a link to choose a new password. The link works for 1 hour.`,
    });
  });

  router.post("/reset-password", async (req, res) => {
    const { token, password } = parse(resetPasswordBody, req.body);

    const user = await accounts.resetPassword(token, password);
    if (!user) {
      throw new HttpError(
        400,
        "INVALID_LINK",
        "This password reset link is invalid or has expired. Ask for a new one.",
      );
    }
    // The link proved who is asking, so this logs them in, with a token of the
    // new version.
    res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
  });

  return router;
}

module.exports = { createAuthRouter };

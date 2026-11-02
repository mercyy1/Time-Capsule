const express = require("express");
const { HttpError } = require("../errors");
const { parse } = require("../validation");
const { signupBody, loginBody } = require("../schemas");
const { findUserByEmail, createUser, passwordMatches, toPublicUser } = require("../services/users");
const { generateAccessToken } = require("../services/tokens");

const router = express.Router();

// The same answer for an unknown email and a wrong password, so a failed login
// doesn't reveal which emails have accounts.
const invalidCredentials = () =>
  new HttpError(401, "INVALID_CREDENTIALS", "Incorrect email or password", {
    headers: { "WWW-Authenticate": "Bearer" },
  });

router.post("/signup", async (req, res) => {
  const { email, password } = parse(signupBody, req.body);

  const existingUser = await findUserByEmail(email);
  if (existingUser) throw new HttpError(400, "EMAIL_TAKEN", "Email already exists");

  const user = await createUser(email, password);
  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = parse(loginBody, req.body);

  const user = await findUserByEmail(email);
  if (!user) throw invalidCredentials();

  const validPassword = await passwordMatches(user, password);
  if (!validPassword) throw invalidCredentials();

  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

module.exports = router;

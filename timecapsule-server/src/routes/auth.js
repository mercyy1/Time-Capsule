const express = require("express");
const { HttpError } = require("../errors");
const { findUserByEmail, createUser, passwordMatches, toPublicUser } = require("../services/users");
const { generateAccessToken } = require("../services/tokens");

const router = express.Router();

router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    throw new HttpError(400, "VALIDATION_FAILED", "Email and password required");
  if (password.length < 8)
    throw new HttpError(400, "VALIDATION_FAILED", "Password must be at least 8 characters");

  const existingUser = await findUserByEmail(email);
  if (existingUser) throw new HttpError(400, "EMAIL_TAKEN", "Email already exists");

  const user = await createUser(email, password);
  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    throw new HttpError(400, "VALIDATION_FAILED", "Email and password required");

  const user = await findUserByEmail(email);
  if (!user) throw new HttpError(400, "INVALID_CREDENTIALS", "Invalid credentials");

  const validPassword = await passwordMatches(user, password);
  if (!validPassword) throw new HttpError(400, "INVALID_CREDENTIALS", "Invalid credentials");

  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

module.exports = router;

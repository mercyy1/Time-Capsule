const express = require("express");
const { findUserByEmail, createUser, passwordMatches, toPublicUser } = require("../services/users");
const { generateAccessToken } = require("../services/tokens");

const router = express.Router();

router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });

  const existingUser = await findUserByEmail(email);
  if (existingUser) return res.status(400).json({ error: "Email already exists" });

  const user = await createUser(email, password);
  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = await findUserByEmail(email);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const validPassword = await passwordMatches(user, password);
  if (!validPassword) return res.status(400).json({ error: "Invalid credentials" });

  res.json({ token: generateAccessToken(user), user: toPublicUser(user) });
});

module.exports = router;

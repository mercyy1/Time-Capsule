const jwt = require("jsonwebtoken");
const { getEnv } = require("./src/config/env");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed token" });

  jwt.verify(token, getEnv().JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

const generateAccessToken = (user) => {
  return jwt.sign({ id: user.id, email: user.email }, getEnv().JWT_SECRET, {
    expiresIn: "1d",
  });
};

module.exports = { authenticateToken, generateAccessToken };

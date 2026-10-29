// server/index.js

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { authenticateToken, generateAccessToken } = require("./auth");
require("dotenv").config();

if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
}

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:3000" }));
app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("Time Capsule API"));

// Signup
app.post("/signup", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });
    if (password.length < 8)
        return res.status(400).json({ error: "Password must be at least 8 characters" });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
        data: { email, password: hashedPassword },
    });

    const token = generateAccessToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
});

// Login
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid credentials" });

    const token = generateAccessToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
});

// Get all capsules for a user
app.get("/capsules", authenticateToken, async (req, res) => {
    const allCapsules = await prisma.capsule.findMany({
        where: { ownerId: req.user.id },
        orderBy: { unlockDate: "asc" },
        select: {
            id: true,
            title: true,
            message: true,
            unlockDate: true,
            isPublic: true,
            slug: true,
        },
    });

    const now = new Date();

    const safeCapsules = allCapsules.map(c => ({
        id: c.id,
        title: c.title,
        unlockDate: c.unlockDate,
        isPublic: c.isPublic,
        slug: c.slug,
        message: now >= c.unlockDate ? c.message : null,
    }));

    res.json(safeCapsules);
});

// Create a capsule
app.post("/capsules", authenticateToken, async (req, res) => {
    const { title, message, unlockDate, isPublic } = req.body;
    if (!title || !message || !unlockDate)
        return res.status(400).json({ error: "Missing required fields" });

    const unlockAt = new Date(unlockDate);
    if (Number.isNaN(unlockAt.getTime()))
        return res.status(400).json({ error: "unlockDate is not a valid date" });
    if (unlockAt <= new Date())
        return res.status(400).json({ error: "unlockDate must be in the future" });

    const capsule = await prisma.capsule.create({
        data: {
            title,
            message,
            unlockDate: unlockAt,
            isPublic: Boolean(isPublic),
            ownerId: req.user.id,
        },
        select: {
            id: true,
            title: true,
            message: true,
            unlockDate: true,
            isPublic: true,
            slug: true,
        },
    });

    res.json(capsule);
});

// Get capsule by slug
app.get("/capsules/slug/:slug", authenticateToken, async (req, res) => {
    const { slug } = req.params;
    const capsule = await prisma.capsule.findUnique({ where: { slug } });

    if (!capsule) return res.status(404).json({ error: "Not found" });
    if (!capsule.isPublic && capsule.ownerId !== req.user.id)
        return res.status(403).json({ error: "Unauthorized" });

    const now = new Date();
    if (now < capsule.unlockDate)
        return res.json({ status: "locked", unlocksAt: capsule.unlockDate });

    return res.json({
        status: "unlocked",
        capsule: {
            id: capsule.id,
            title: capsule.title,
            message: capsule.message,
            unlockDate: capsule.unlockDate,
        },
    });
});

// Delete capsule
app.delete("/capsules/:id", authenticateToken, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
        return res.status(400).json({ error: "Invalid capsule id" });

    const capsule = await prisma.capsule.findUnique({ where: { id } });

    if (!capsule) return res.status(404).json({ error: "Capsule not found" });
    if (capsule.ownerId !== req.user.id)
        return res.status(403).json({ error: "Access denied" });

    await prisma.capsule.delete({ where: { id: capsule.id } });
    res.json({ message: "Capsule deleted" });
});

// Public capsule view
app.get("/capsules/public/:slug", async (req, res) => {
    const capsule = await prisma.capsule.findUnique({
        where: { slug: req.params.slug },
    });

    if (!capsule || !capsule.isPublic)
        return res.status(404).json({ error: "Capsule not found or not public" });

    const now = new Date();
    if (now < capsule.unlockDate)
        return res.json({ status: "locked", unlocksAt: capsule.unlockDate });

    // Only expose display fields: never the owner id, contact email or internal flags.
    return res.json({
        status: "unlocked",
        capsule: {
            title: capsule.title,
            message: capsule.message,
            unlockDate: capsule.unlockDate,
            createdAt: capsule.createdAt,
        },
    });
});

// Any error thrown in a route (Express 5 forwards async errors here) gets a JSON 500
// instead of an HTML stack trace.
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

const express = require("express");
const { HttpError } = require("../errors");
const { parse } = require("../validation");
const { newCapsuleBody, capsuleIdParams, isSlug } = require("../schemas");
const { authenticate } = require("../middleware/authenticate");
const capsules = require("../services/capsules");

// Mounted at /capsules.
const router = express.Router();

// A slug that isn't a UUID can't match a capsule, so it skips the database.
const findBySlug = async (slug) => (isSlug(slug) ? capsules.findCapsuleBySlug(slug) : null);

// The signed-in user's capsules.
router.get("/", authenticate, async (req, res) => {
  res.json(await capsules.listCapsulesForOwner(req.user.id));
});

router.post("/", authenticate, async (req, res) => {
  const { title, message, unlockDate, isPublic } = parse(newCapsuleBody, req.body);

  const capsule = await capsules.createCapsule({
    ownerId: req.user.id,
    title,
    message,
    unlockDate,
    isPublic,
  });
  res.json(capsule);
});

// Opens a capsule for a signed-in user: its owner, or anyone if it is public.
router.get("/slug/:slug", authenticate, async (req, res) => {
  const capsule = await findBySlug(req.params.slug);

  if (!capsule) throw new HttpError(404, "NOT_FOUND", "Not found");
  if (!capsule.isPublic && capsule.ownerId !== req.user.id)
    throw new HttpError(403, "FORBIDDEN", "Unauthorized");

  if (capsules.isLocked(capsule)) return res.json(capsules.toLockedView(capsule));
  res.json(capsules.toUnlockedView(capsule));
});

router.delete("/:id", authenticate, async (req, res) => {
  const { id } = parse(capsuleIdParams, req.params);

  const capsule = await capsules.findCapsuleById(id);

  if (!capsule) throw new HttpError(404, "NOT_FOUND", "Capsule not found");
  if (capsule.ownerId !== req.user.id) throw new HttpError(403, "FORBIDDEN", "Access denied");

  await capsules.deleteCapsule(capsule.id);
  res.json({ message: "Capsule deleted" });
});

// The public share page: no sign-in, public capsules only.
router.get("/public/:slug", async (req, res) => {
  const capsule = await findBySlug(req.params.slug);

  if (!capsule || !capsule.isPublic)
    throw new HttpError(404, "NOT_FOUND", "Capsule not found or not public");

  if (capsules.isLocked(capsule)) return res.json(capsules.toLockedView(capsule));
  res.json(capsules.toPublicView(capsule));
});

module.exports = router;

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

// One answer for "doesn't exist" and "exists but isn't yours to see", so nobody
// can find out whether someone else's private capsule exists.
const capsuleNotFound = () => new HttpError(404, "NOT_FOUND", "Capsule not found");

// A signed-in user can see their own capsules and anyone's public ones.
const canView = (capsule, user) => capsule.isPublic || capsule.ownerId === user.id;

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
  // 201 Created, with the new capsule's address in the Location header.
  res.status(201).location(`/capsules/slug/${capsule.slug}`).json(capsule);
});

// Opens a capsule for a signed-in user: its owner, or anyone if it is public.
router.get("/slug/:slug", authenticate, async (req, res) => {
  const capsule = await findBySlug(req.params.slug);

  if (!capsule || !canView(capsule, req.user)) throw capsuleNotFound();

  if (capsules.isLocked(capsule)) {
    const isOwner = capsule.ownerId === req.user.id;
    return res.json(isOwner ? capsules.toOwnerLockedView(capsule) : capsules.toLockedView(capsule));
  }
  res.json(capsules.toUnlockedView(capsule));
});

router.delete("/:id", authenticate, async (req, res) => {
  const { id } = parse(capsuleIdParams, req.params);

  const capsule = await capsules.findCapsuleById(id);

  if (!capsule || !canView(capsule, req.user)) throw capsuleNotFound();
  // Someone else's public capsule: visible to them, but not theirs to delete.
  if (capsule.ownerId !== req.user.id)
    throw new HttpError(403, "FORBIDDEN", "Only the owner can delete this capsule");

  // Also false if the owner deleted it in the meantime (e.g. from another tab).
  if (!(await capsules.deleteOwnedCapsule(id, req.user.id))) throw capsuleNotFound();
  res.json({ message: "Capsule deleted" });
});

// The public share page: no sign-in, public capsules only.
router.get("/public/:slug", async (req, res) => {
  const capsule = await findBySlug(req.params.slug);

  if (!capsule || !capsule.isPublic) throw capsuleNotFound();

  if (capsules.isLocked(capsule)) return res.json(capsules.toLockedView(capsule));
  res.json(capsules.toPublicView(capsule));
});

module.exports = router;

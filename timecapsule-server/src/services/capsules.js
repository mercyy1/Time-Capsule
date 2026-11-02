const { prisma } = require("../db");

// The lock: a capsule's message stays hidden until its unlock date. Every
// response that could contain a message must go through isLocked().
const isLocked = (capsule, now = new Date()) => now < capsule.unlockDate;

// All a locked capsule reveals: that it is locked, and when it opens.
const toLockedView = (capsule) => ({ status: "locked", unlocksAt: capsule.unlockDate });

// An unlocked capsule as shown to a signed-in user (its owner, or anyone if public).
const toUnlockedView = (capsule) => ({
  status: "unlocked",
  capsule: {
    id: capsule.id,
    title: capsule.title,
    message: capsule.message,
    unlockDate: capsule.unlockDate,
  },
});

// An unlocked capsule as shown on the public share page: display fields only,
// never the owner id, contact email or internal flags.
const toPublicView = (capsule) => ({
  status: "unlocked",
  capsule: {
    title: capsule.title,
    message: capsule.message,
    unlockDate: capsule.unlockDate,
    createdAt: capsule.createdAt,
  },
});

const OWNER_FIELDS = {
  id: true,
  title: true,
  message: true,
  unlockDate: true,
  isPublic: true,
  slug: true,
};

// The owner's capsules, soonest unlock first, with locked messages replaced by null.
async function listCapsulesForOwner(ownerId, now = new Date()) {
  const capsules = await prisma.capsule.findMany({
    where: { ownerId },
    orderBy: { unlockDate: "asc" },
    select: OWNER_FIELDS,
  });
  return capsules.map((c) => ({
    id: c.id,
    title: c.title,
    unlockDate: c.unlockDate,
    isPublic: c.isPublic,
    slug: c.slug,
    message: isLocked(c, now) ? null : c.message,
  }));
}

function createCapsule({ ownerId, title, message, unlockDate, isPublic }) {
  return prisma.capsule.create({
    data: { title, message, unlockDate, isPublic, ownerId },
    select: OWNER_FIELDS,
  });
}

const findCapsuleBySlug = (slug) => prisma.capsule.findUnique({ where: { slug } });
const findCapsuleById = (id) => prisma.capsule.findUnique({ where: { id } });
// Deletes the capsule only if `ownerId` owns it, in one query. Returns whether a
// row was deleted, so a capsule deleted twice at once can't cause an error.
async function deleteOwnedCapsule(id, ownerId) {
  const { count } = await prisma.capsule.deleteMany({ where: { id, ownerId } });
  return count > 0;
}

module.exports = {
  isLocked,
  toLockedView,
  toUnlockedView,
  toPublicView,
  listCapsulesForOwner,
  createCapsule,
  findCapsuleBySlug,
  findCapsuleById,
  deleteOwnedCapsule,
};

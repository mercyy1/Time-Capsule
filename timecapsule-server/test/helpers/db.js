const { prisma } = require("./app");
const { assertTestDatabase } = require("../setup/testDatabase");

const DAY_MS = 24 * 60 * 60 * 1000;

// A Date `days` days from now (negative for the past).
const daysFromNow = (days) => new Date(Date.now() + days * DAY_MS);

// Empties every table except Prisma's migration history.
async function resetDatabase() {
  assertTestDatabase(process.env.DATABASE_URL);
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

// Inserts a capsule straight into the database. The API only accepts future
// unlock dates, so this is how tests get capsules that are already unlocked.
function seedCapsule({
  ownerId,
  unlockDate,
  isPublic = false,
  title = "Seeded",
  message = "seeded message",
}) {
  return prisma.capsule.create({ data: { ownerId, unlockDate, isPublic, title, message } });
}

module.exports = { daysFromNow, resetDatabase, seedCapsule };

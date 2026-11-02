// Runs once before all test files: brings the test database's schema up to date
// with the committed migrations, using the same command deployments use, and
// sets its time zone (see below).
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { testDatabaseUrl, assertTestDatabase } = require("./testDatabase");

// Dates are stored in UTC, in columns without a time zone. A raw SQL query that
// compares one with a Date parameter must convert the parameter to UTC first
// (see src/jobs/unlockEmails.js); forgetting to only shows when the database
// session's time zone isn't UTC. So the test database runs on Toronto's time,
// where that mistake fails the tests instead of hiding until a database that
// isn't set to UTC turns up. (New connections pick the setting up.)
async function useTorontoTime() {
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN
        EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Toronto');
      END $$`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = async function globalSetup() {
  assertTestDatabase(testDatabaseUrl);
  const prismaCli = path.join(
    path.dirname(require.resolve("prisma/package.json")),
    "build",
    "index.js",
  );
  try {
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: path.join(__dirname, "..", ".."),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    throw new Error(
      "Could not apply migrations to the test database. Is it running? " +
        "Start it with `docker compose up -d` from the repository root.\n" +
        `${err.stdout ?? ""}${err.stderr ?? ""}`,
      { cause: err },
    );
  }
  await useTorontoTime();
};

// Runs once before all test files: brings the test database's schema up to date
// with the committed migrations, using the same command deployments use.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { testDatabaseUrl, assertTestDatabase } = require("./testDatabase");

module.exports = function globalSetup() {
  assertTestDatabase(testDatabaseUrl);
  const prismaCli = path.join(path.dirname(require.resolve("prisma/package.json")), "build", "index.js");
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
};

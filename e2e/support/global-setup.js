// Runs once before the tests: creates the end-to-end database if needed, brings
// its schema up to date with the committed migrations (the command deploys use),
// and empties it and the outbox, so every run starts from the same place.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import settings from "./settings.cjs";
import { requireFromServer, serverDir } from "./server.js";

function assertE2EDatabase(url) {
  const name = URL.canParse(url) ? new URL(url).pathname.slice(1) : "";
  if (!name.endsWith("_e2e")) {
    throw new Error(
      `Refusing to use database "${name}" for the end-to-end tests: its name must end in _e2e, ` +
        "because the tests delete all of its data.",
    );
  }
}

function migrate() {
  const prismaCli = path.join(
    path.dirname(requireFromServer.resolve("prisma/package.json")),
    "build",
    "index.js",
  );
  try {
    // Also creates the database the first time.
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: settings.DATABASE_URL },
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err) {
    throw new Error(
      "Could not prepare the end-to-end database. Is PostgreSQL running? " +
        "Start it with `docker compose up -d` from the repository root.\n" +
        `${err.stdout ?? ""}${err.stderr ?? ""}`,
      { cause: err },
    );
  }
}

async function emptyDatabase() {
  const { PrismaClient } = requireFromServer("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: settings.DATABASE_URL } } });
  try {
    const tables = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
    const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
    if (names) await prisma.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}

export default async function globalSetup() {
  assertE2EDatabase(settings.DATABASE_URL);
  migrate();
  await emptyDatabase();
  fs.rmSync(settings.OUTBOX, { force: true });
}

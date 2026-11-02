// Rules the database itself enforces (set by the migrations), whatever code
// writes to it.
const { prisma } = require("./helpers/app");
const { daysFromNow, resetDatabase, seedCapsule } = require("./helpers/db");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

test("deleting a user deletes their capsules, and only theirs", async () => {
  const ada = await signUp();
  const bob = await signUp();
  await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(1) });
  await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(-1) });
  const bobs = await seedCapsule({ ownerId: bob.user.id, unlockDate: daysFromNow(1) });

  await prisma.user.delete({ where: { id: ada.user.id } });

  const left = await prisma.capsule.findMany({ select: { id: true } });
  expect(left).toEqual([{ id: bobs.id }]);
});

test("a capsule can't be stored without an owner (ownerId was optional)", async () => {
  const insert = prisma.$executeRaw`
    INSERT INTO "Capsule" ("title", "message", "unlockDate", "slug")
    VALUES ('No owner', 'secret', now(), gen_random_uuid())`;

  const error = await insert.catch((err) => err);
  // 23502 is PostgreSQL's code for "not-null violation".
  expect(error.meta).toMatchObject({ code: "23502" });
});

test("a capsule can't point at a user who doesn't exist", async () => {
  await expect(seedCapsule({ ownerId: 999999, unlockDate: daysFromNow(1) })).rejects.toThrow(
    /Foreign key constraint/i,
  );
});

test("has the indexes the capsule list and the unlock-email job need", async () => {
  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'Capsule'`;
  const columnsOf = (name) =>
    indexes.find((index) => index.indexname === name)?.indexdef.match(/\((.*)\)$/)[1];

  expect(columnsOf("Capsule_ownerId_unlockDate_idx")).toBe('"ownerId", "unlockDate"');
  expect(columnsOf("Capsule_notified_unlockDate_idx")).toBe('notified, "unlockDate"');
});

describe("emailed links and the email log", () => {
  const link = (userId, tokenHash) =>
    prisma.authToken.create({
      data: { userId, kind: "VERIFY_EMAIL", tokenHash, expiresAt: daysFromNow(1) },
    });

  test("deleting a user deletes their links, but keeps their emails in the log", async () => {
    const ada = await signUp();
    await link(ada.user.id, "a".repeat(64));
    const logged = await prisma.emailLog.create({
      data: { kind: "VERIFY_EMAIL", address: ada.user.email, userId: ada.user.id },
    });

    await prisma.user.delete({ where: { id: ada.user.id } });

    await expect(prisma.authToken.count()).resolves.toBe(0);
    // Still counted toward the day's sending limit, no longer tied to anyone.
    await expect(prisma.emailLog.findUnique({ where: { id: logged.id } })).resolves.toMatchObject({
      userId: null,
      address: ada.user.email,
    });
  });

  test("deleting a capsule keeps the emails sent about it in the log", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(-1) });
    const logged = await prisma.emailLog.create({
      data: { kind: "CAPSULE_OPENED", address: ada.user.email, capsuleId: capsule.id },
    });

    await prisma.capsule.delete({ where: { id: capsule.id } });

    await expect(prisma.emailLog.findUnique({ where: { id: logged.id } })).resolves.toMatchObject({
      capsuleId: null,
    });
  });

  test("two links can't have the same token hash", async () => {
    const ada = await signUp();
    await link(ada.user.id, "b".repeat(64));

    await expect(link(ada.user.id, "b".repeat(64))).rejects.toMatchObject({ code: "P2002" });
  });

  test("has the indexes the email limits need", async () => {
    const indexes = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'EmailLog'`;

    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      "EmailLog_address_createdAt_idx",
      "EmailLog_capsuleId_idx",
      "EmailLog_createdAt_idx",
      "EmailLog_pkey",
      "EmailLog_userId_createdAt_idx",
    ]);
  });
});

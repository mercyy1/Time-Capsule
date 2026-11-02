const { prisma, mailer, emailSender, unlockEmails } = require("./helpers/app");
const { daysFromNow, resetDatabase, seedCapsule } = require("./helpers/db");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const APP_URL = "http://localhost:3000";
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const LIMITS = { daily: 100, account: 50, unlock: 90, perOwner: 25, perAddressPerHour: 3 };

// The time the job sees. Tests move it forward by hand.
let clock;
beforeEach(() => {
  clock = new Date();
});
const later = (ms) => {
  clock = new Date(clock.getTime() + ms);
};

// One run of the job, with the shared fake mailer unless a test passes its own.
function run({ limits = LIMITS, mailer: sendWith = mailer, ...options } = {}) {
  const sender = emailSender.createSender({ mailer: sendWith, limits, now: () => clock });
  return unlockEmails.sendUnlockEmails({ sender, appUrl: APP_URL, ...options });
}

let users = 0;
// An account, straight in the database (no signup emails to count).
const createOwner = (email = `owner${++users}@example.com`, { confirmed = true } = {}) =>
  prisma.user.create({
    data: { email, password: "not-used", emailVerifiedAt: confirmed ? new Date() : null },
  });

// A capsule that opened a day ago (unless `fields` say otherwise).
const openedCapsule = (owner, fields = {}) =>
  seedCapsule({ ownerId: owner.id, unlockDate: daysFromNow(-1), ...fields });

const capsuleById = (id) => prisma.capsule.findUnique({ where: { id } });

const summaryOf = (fields) => ({
  capsulesNotified: 0,
  capsulesGivenUp: 0,
  emailsSent: 0,
  emailsFailed: 0,
  stoppedBy: null,
  cleanedUp: { emailLogs: 0, authTokens: 0 },
  ...fields,
});

describe("when a capsule opens", () => {
  test("emails its owner a link to it, without the message, and marks it notified", async () => {
    const ada = await createOwner("ada@example.com");
    const capsule = await openedCapsule(ada, { title: "Hello future", message: "the secret" });

    const summary = await run();

    expect(summary).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
    const [email] = mailer.to("ada@example.com");
    expect(email.subject).toBe('Your time capsule "Hello future" has opened');
    expect(email.text).toContain(
      `Read it (you'll need to log in): ${APP_URL}/capsule/${capsule.slug}`,
    );
    expect(email.text).not.toContain("the secret");
    expect(email.idempotencyKey).toBe(`capsule-${capsule.id}-CAPSULE_OPENED`);
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({
      notified: true,
      notifyLockedUntil: null,
      notifyAttempts: 0,
    });
    await expect(prisma.emailLog.findMany()).resolves.toEqual([
      expect.objectContaining({
        kind: "CAPSULE_OPENED",
        status: "SENT",
        address: "ada@example.com",
        userId: ada.id,
        capsuleId: capsule.id,
      }),
    ]);
  });

  test("a capsule opens at its unlock date exactly, not a millisecond before", async () => {
    const ada = await createOwner();
    const now = await openedCapsule(ada, { unlockDate: clock });
    const soon = await openedCapsule(ada, { unlockDate: new Date(clock.getTime() + 1) });

    await run();

    await expect(capsuleById(now.id)).resolves.toMatchObject({ notified: true });
    await expect(capsuleById(soon.id)).resolves.toMatchObject({ notified: false });
    expect(mailer.sent).toHaveLength(1);
  });

  test("says how long it stayed sealed", async () => {
    const ada = await createOwner("ada@example.com");
    const unlockDate = daysFromNow(-1);
    const createdAt = new Date(unlockDate);
    createdAt.setUTCFullYear(createdAt.getUTCFullYear() - 2);
    await openedCapsule(ada, { title: "Hello future", unlockDate, createdAt });

    await run();

    expect(mailer.to("ada@example.com")[0].text).toMatch(
      /^Your time capsule "Hello future" has opened\. It stayed sealed for 2 years\.$/m,
    );
  });

  test("emails the recipient the message, with replies going to the owner", async () => {
    const ada = await createOwner("ada@example.com");
    const capsule = await openedCapsule(ada, {
      title: "Hello future",
      message: "Dear Bob,\nhappy birthday!",
      recipientEmail: "bob@example.com",
    });

    const summary = await run();

    expect(summary).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 2 }));
    const [toAda] = mailer.to("ada@example.com");
    expect(toAda.text).toContain("We've also emailed it to bob@example.com, as you asked.");
    expect(toAda.text).not.toContain("happy birthday");
    const [toBob] = mailer.to("bob@example.com");
    expect(toBob).toMatchObject({
      subject: 'A time capsule from ada@example.com: "Hello future"',
      replyTo: "ada@example.com",
      idempotencyKey: `capsule-${capsule.id}-CAPSULE_DELIVERED`,
    });
    expect(toBob.text).toContain('"Hello future"\n\nDear Bob,\nhappy birthday!\n');
    expect(toBob.text).toContain("Replying reaches them.");
    // A private capsule has no page the recipient could open.
    expect(toBob.text).not.toContain(APP_URL);
    const logs = await prisma.emailLog.findMany({ orderBy: { id: "asc" } });
    expect(logs.map((log) => [log.kind, log.address, log.userId])).toEqual([
      ["CAPSULE_OPENED", "ada@example.com", ada.id],
      // Counted toward the owner's share of the day, whoever it goes to.
      ["CAPSULE_DELIVERED", "bob@example.com", ada.id],
    ]);
  });

  test("a public capsule's email to the recipient links to its public page", async () => {
    const ada = await createOwner("ada@example.com");
    const capsule = await openedCapsule(ada, {
      isPublic: true,
      recipientEmail: "bob@example.com",
    });

    await run();

    expect(mailer.to("bob@example.com")[0].text).toContain(
      `You can also read it online: ${APP_URL}/public/${capsule.slug}`,
    );
  });

  test("a capsule its owner sends to themselves: one email, with the message", async () => {
    const ada = await createOwner("ada@example.com");
    await openedCapsule(ada, { message: "Hello me", recipientEmail: "ada@example.com" });

    const summary = await run();

    expect(summary).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
    const emails = mailer.to("ada@example.com");
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain("Here's what you wrote:\n\nHello me\n");
    expect(emails[0].text).not.toContain("We've also emailed it");
  });

  test("subjects stay on one line, with at most 80 characters of the title", async () => {
    const ada = await createOwner("ada@example.com");
    await openedCapsule(ada, {
      title: `Two\nlines ${"x".repeat(150)}`,
      recipientEmail: "bob@example.com",
    });

    await run();

    const quoted = (subject) => /"(.*)"/.exec(subject)[1];
    for (const { subject } of mailer.sent) {
      expect(subject).not.toMatch(/[\r\n]/);
      expect(quoted(subject)).toHaveLength(80);
      expect(quoted(subject)).toMatch(/^Two lines x+…$/);
    }
  });

  test("leaves capsules that haven't opened yet", async () => {
    const ada = await createOwner();
    const capsule = await seedCapsule({ ownerId: ada.id, unlockDate: daysFromNow(1) });

    const summary = await run();

    expect(summary).toEqual(summaryOf({}));
    expect(mailer.sent).toEqual([]);
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({
      notified: false,
      notifyLockedUntil: null,
    });
  });

  test("waits while the owner's address isn't confirmed", async () => {
    const ada = await createOwner("ada@example.com", { confirmed: false });
    const capsule = await openedCapsule(ada);

    expect((await run()).emailsSent).toBe(0);
    await prisma.user.update({ where: { id: ada.id }, data: { emailVerifiedAt: new Date() } });
    const summary = await run();

    expect(summary.emailsSent).toBe(1);
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({ notified: true });
  });
});

describe("running again, or twice at once", () => {
  test("a second run sends nothing more", async () => {
    const ada = await createOwner();
    await openedCapsule(ada, { recipientEmail: "bob@example.com" });
    await run();

    const summary = await run();

    expect(summary).toEqual(summaryOf({}));
    expect(mailer.sent).toHaveLength(2);
  });

  test("two runs at the same moment send each email once", async () => {
    for (let i = 0; i < 3; i++) {
      const owner = await createOwner();
      for (let j = 0; j < 2; j++) {
        await openedCapsule(owner, { recipientEmail: `friend${i}${j}@example.com` });
      }
    }

    const summaries = await Promise.all([run({ batchSize: 2 }), run({ batchSize: 2 })]);

    const total = (field) => summaries.reduce((sum, summary) => sum + summary[field], 0);
    expect(total("capsulesNotified")).toBe(6);
    expect(total("emailsSent")).toBe(12);
    expect(mailer.sent).toHaveLength(12);
    // Each email was reserved once: neither run sent one the other had claimed.
    await expect(prisma.emailLog.count()).resolves.toBe(12);
    await expect(prisma.capsule.count({ where: { notified: false } })).resolves.toBe(0);
  });

  test("a capsule another run is claiming at this very moment is skipped, not waited for", async () => {
    const ada = await createOwner();
    const claimedElsewhere = await openedCapsule(ada, { unlockDate: daysFromNow(-2) });
    const free = await openedCapsule(ada);

    // Another run's claim, caught halfway: its transaction has locked the row.
    // A run that waited for the lock would wait for this transaction, which
    // waits for the run: stuck until the transaction times out (5 seconds).
    const summary = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Capsule" WHERE id = ${claimedElsewhere.id} FOR UPDATE`;
      return run();
    });

    expect(summary).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
    await expect(capsuleById(free.id)).resolves.toMatchObject({ notified: true });
    await expect(capsuleById(claimedElsewhere.id)).resolves.toMatchObject({ notified: false });
  });

  test("a capsule another run holds is left alone until that run's lease ends", async () => {
    const ada = await createOwner();
    const capsule = await openedCapsule(ada);
    // As if a run that crashed had claimed it a minute ago (leases last 5 minutes).
    await prisma.capsule.update({
      where: { id: capsule.id },
      data: { notifyLockedUntil: new Date(clock.getTime() + 4 * MINUTE_MS) },
    });

    expect((await run()).emailsSent).toBe(0);
    later(5 * MINUTE_MS);
    const summary = await run();

    expect(summary.emailsSent).toBe(1);
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({
      notified: true,
      notifyLockedUntil: null,
    });
  });

  test("an email sent just before a crash isn't sent twice", async () => {
    const ada = await createOwner("ada@example.com");
    const capsule = await openedCapsule(ada);
    // Sends, then fails before the job can record it (like a crash would).
    const crashing = {
      async send(email) {
        await mailer.send(email);
        throw new Error("The server stopped");
      },
    };
    await expect(run({ mailer: crashing })).rejects.toThrow("The server stopped");
    // The run gave its capsules back on the way out.
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({
      notified: false,
      notifyLockedUntil: null,
    });

    const summary = await run();

    // The provider recognized the idempotency key: nothing was sent again.
    expect(summary.capsulesNotified).toBe(1);
    expect(mailer.to("ada@example.com")).toHaveLength(1);
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({ notified: true });
  });
});

describe("the daily limits", () => {
  test("the day's capsule emails used up: the run stops, and the rest go out the next day", async () => {
    const capsules = [];
    for (let i = 0; i < 3; i++) capsules.push(await openedCapsule(await createOwner()));
    const limits = { ...LIMITS, unlock: 2 };

    const summary = await run({ limits });

    expect(summary).toEqual(
      summaryOf({ capsulesNotified: 2, emailsSent: 2, stoppedBy: "daily-limit" }),
    );
    await expect(capsuleById(capsules[2].id)).resolves.toMatchObject({
      notified: false,
      notifyLockedUntil: null,
    });
    later(DAY_MS);
    expect(await run({ limits })).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
  });

  test("one owner's share used up: their capsules wait for the next day, others' go out", async () => {
    const ada = await createOwner("ada@example.com");
    const bob = await createOwner("bob@example.com");
    // Ada's open first, so they're first in line.
    for (let days = 4; days >= 2; days--) {
      await openedCapsule(ada, { unlockDate: daysFromNow(-days) });
    }
    await openedCapsule(bob, { unlockDate: daysFromNow(-1) });
    const limits = { ...LIMITS, perOwner: 2 };

    const summary = await run({ limits });

    expect(summary).toEqual(summaryOf({ capsulesNotified: 3, emailsSent: 3 }));
    expect(mailer.to("ada@example.com")).toHaveLength(2);
    expect(mailer.to("bob@example.com")).toHaveLength(1);
    await expect(
      prisma.capsule.count({ where: { notifyLockedUntil: { not: null } } }),
    ).resolves.toBe(0);
    later(DAY_MS);
    expect(await run({ limits })).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
    expect(mailer.to("ada@example.com")).toHaveLength(3);
  });

  test("a capsule stopped halfway sends the rest the next day, not the first email again", async () => {
    const ada = await createOwner("ada@example.com");
    const capsule = await openedCapsule(ada, { recipientEmail: "bob@example.com" });
    const limits = { ...LIMITS, perOwner: 1 };

    expect(await run({ limits })).toEqual(summaryOf({ emailsSent: 1 }));
    await expect(capsuleById(capsule.id)).resolves.toMatchObject({ notified: false });
    later(DAY_MS);
    const summary = await run({ limits });

    expect(summary).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1 }));
    expect(mailer.to("ada@example.com")).toHaveLength(1);
    expect(mailer.to("bob@example.com")).toHaveLength(1);
  });
});

describe("when the provider fails", () => {
  test.each([
    ["its quota is used up", "quota", "provider-quota"],
    ["it is down or busy", "unavailable", "provider-unavailable"],
    ["it refuses our settings", "config", "provider-config"],
  ])("%s: the run stops, and the next run sends everything", async (_case, kind, stoppedBy) => {
    const first = await openedCapsule(await createOwner(), { unlockDate: daysFromNow(-2) });
    await openedCapsule(await createOwner());
    mailer.failNext(kind);

    const summary = await run();

    expect(summary).toEqual(summaryOf({ emailsFailed: 1, stoppedBy }));
    await expect(capsuleById(first.id)).resolves.toMatchObject({
      notified: false,
      notifyLockedUntil: null,
      notifyAttempts: 0, // not the capsule's fault
    });
    expect(await run()).toEqual(summaryOf({ capsulesNotified: 2, emailsSent: 2 }));
  });

  test("an email it refuses: other capsules carry on, and it's tried on the next runs, then given up after 3", async () => {
    const refused = await openedCapsule(await createOwner(), { unlockDate: daysFromNow(-2) });
    await openedCapsule(await createOwner());

    mailer.failNext("rejected");
    expect(await run()).toEqual(summaryOf({ capsulesNotified: 1, emailsSent: 1, emailsFailed: 1 }));
    await expect(capsuleById(refused.id)).resolves.toMatchObject({
      notified: false,
      notifyLockedUntil: null,
      notifyAttempts: 1,
    });

    mailer.failNext("rejected");
    expect(await run()).toEqual(summaryOf({ emailsFailed: 1 }));
    mailer.failNext("rejected");
    expect(await run()).toEqual(summaryOf({ emailsFailed: 1, capsulesGivenUp: 1 }));

    await expect(capsuleById(refused.id)).resolves.toMatchObject({
      notified: true,
      notifyAttempts: 3,
    });
    expect(await run()).toEqual(summaryOf({}));
  });
});

test("once its time is up, a run starts no more capsules and leaves them for the next run", async () => {
  for (let i = 0; i < 3; i++) await openedCapsule(await createOwner());
  const slow = {
    async send(email) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return mailer.send(email);
    },
  };

  const summary = await run({ mailer: slow, timeBudgetMs: 50 });

  expect(summary).toEqual(
    summaryOf({ capsulesNotified: 1, emailsSent: 1, stoppedBy: "time-limit" }),
  );
  await expect(
    prisma.capsule.count({ where: { notified: false, notifyLockedUntil: null } }),
  ).resolves.toBe(2);
  expect(await run()).toEqual(summaryOf({ capsulesNotified: 2, emailsSent: 2 }));
});

test("deletes email logs older than 30 days and links that have expired", async () => {
  const ada = await createOwner("ada@example.com");
  const daysAgo = (days) => new Date(clock.getTime() - days * DAY_MS);
  await prisma.emailLog.createMany({
    data: [31, 29].map((days) => ({
      kind: "VERIFY_EMAIL",
      status: "SENT",
      address: "ada@example.com",
      createdAt: daysAgo(days),
    })),
  });
  await prisma.authToken.createMany({
    data: [-1, 1].map((minutes) => ({
      kind: "RESET_PASSWORD",
      userId: ada.id,
      tokenHash: `hash${minutes}`,
      expiresAt: new Date(clock.getTime() + minutes * MINUTE_MS),
    })),
  });

  const summary = await run();

  expect(summary.cleanedUp).toEqual({ emailLogs: 1, authTokens: 1 });
  await expect(prisma.emailLog.findMany()).resolves.toEqual([
    expect.objectContaining({ createdAt: daysAgo(29) }),
  ]);
  await expect(prisma.authToken.findMany()).resolves.toEqual([
    expect.objectContaining({ tokenHash: "hash1" }),
  ]);
});

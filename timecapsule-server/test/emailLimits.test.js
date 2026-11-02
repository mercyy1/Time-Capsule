const { prisma, emailSender } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { createFakeMailer } = require("./helpers/mailer");

const { createSender, emailLimits, secondsUntilNextUtcDay } = emailSender;

const mailer = createFakeMailer();

beforeEach(async () => {
  await resetDatabase();
  mailer.reset();
});
afterAll(() => prisma.$disconnect());

// A clock the test moves by hand.
function clockAt(iso) {
  let time = new Date(iso);
  return {
    now: () => time,
    set: (next) => (time = new Date(next)),
  };
}

// Small limits, so tests reach them quickly.
const LIMITS = { daily: 6, account: 4, unlock: 5, perOwner: 3, perAddressPerHour: 2 };
const NOON = "2030-06-01T12:00:00.000Z";
const senderWith = (limits, clock = clockAt(NOON)) =>
  createSender({ mailer, limits: { ...LIMITS, ...limits }, now: clock.now });

const EMAIL = { subject: "Hello", text: "Hello there" };
const accountEmail = (address) => ({ kind: "VERIFY_EMAIL", address });
const capsuleEmail = (owner, address = "friend@example.com") => ({
  kind: "CAPSULE_DELIVERED",
  address,
  userId: owner.id,
});

let users = 0;
const createUser = () => {
  users += 1;
  return prisma.user.create({ data: { email: `owner${users}@example.com`, password: "-" } });
};

// Reserves and sends one email. Returns "sent", or the limit that stopped it.
async function send(sender, email) {
  const { slot, limitedBy } = await sender.reserve(email);
  if (!slot) return limitedBy;
  await sender.deliver(slot, EMAIL);
  return "sent";
}

test("the limits for Resend's free plan (100 a day), and for the smallest allowed", () => {
  expect(emailLimits(100)).toEqual({
    daily: 100,
    account: 50,
    unlock: 90,
    perOwner: 25,
    perAddressPerHour: 3,
  });
  expect(emailLimits(10)).toEqual({
    daily: 10,
    account: 5,
    unlock: 9,
    perOwner: 2,
    perAddressPerHour: 3,
  });
});

describe("sending", () => {
  test("logs the email, then marks it SENT with the provider's id", async () => {
    const sender = senderWith();

    const { slot } = await sender.reserve({ kind: "RESET_PASSWORD", address: "ada@example.com" });
    expect(slot).toMatchObject({ status: "SENDING", address: "ada@example.com" });
    const result = await sender.deliver(
      slot,
      { ...EMAIL, replyTo: "bob@example.com" },
      { idempotencyKey: "key-1" },
    );

    expect(result).toEqual({ sent: true });
    expect(mailer.sent).toEqual([
      {
        id: "fake-1",
        to: "ada@example.com",
        subject: "Hello",
        text: "Hello there",
        replyTo: "bob@example.com",
        idempotencyKey: "key-1",
      },
    ]);
    await expect(prisma.emailLog.findUnique({ where: { id: slot.id } })).resolves.toMatchObject({
      kind: "RESET_PASSWORD",
      status: "SENT",
      providerId: "fake-1",
      error: null,
      createdAt: new Date(NOON),
    });
  });

  test("an email the provider refused is FAILED, with why, and stops counting", async () => {
    const sender = senderWith({ daily: 1 });
    mailer.failNext("rejected");

    const { slot } = await sender.reserve(accountEmail("ada@example.com"));
    const result = await sender.deliver(slot, EMAIL);

    expect(result).toMatchObject({ sent: false, error: { kind: "rejected" } });
    await expect(prisma.emailLog.findUnique({ where: { id: slot.id } })).resolves.toMatchObject({
      status: "FAILED",
      error: "Fake rejected failure",
    });
    // Its place in the day's count is free again.
    expect(await send(sender, accountEmail("bob@example.com"))).toBe("sent");
  });

  test("an email that may have gone out (a timeout) keeps its place in the count", async () => {
    const sender = senderWith({ daily: 1 });
    mailer.failNext("unavailable", { outcomeUnknown: true });

    const { slot } = await sender.reserve(accountEmail("ada@example.com"));
    const result = await sender.deliver(slot, EMAIL);

    expect(result).toMatchObject({ sent: false, error: { kind: "unavailable" } });
    await expect(prisma.emailLog.findUnique({ where: { id: slot.id } })).resolves.toMatchObject({
      status: "SENDING",
    });
    expect(await send(sender, accountEmail("bob@example.com"))).toBe("daily");
  });
});

describe("limits", () => {
  test("the daily limit counts every kind of email together", async () => {
    const owner = await createUser();
    const sender = senderWith({ daily: 3 });

    expect(await send(sender, accountEmail("a@example.com"))).toBe("sent");
    expect(await send(sender, capsuleEmail(owner))).toBe("sent");
    expect(await send(sender, accountEmail("b@example.com"))).toBe("sent");

    expect(await send(sender, capsuleEmail(owner))).toBe("daily");
    expect(await send(sender, accountEmail("c@example.com"))).toBe("daily");
  });

  test("account emails stop at their share of the day; capsule emails carry on", async () => {
    const owner = await createUser();
    const sender = senderWith({ account: 2 });

    expect(await send(sender, accountEmail("a@example.com"))).toBe("sent");
    expect(await send(sender, { kind: "ACCOUNT_EXISTS", address: "b@example.com" })).toBe("sent");

    expect(await send(sender, { kind: "RESET_PASSWORD", address: "c@example.com" })).toBe(
      "account",
    );
    expect(await send(sender, capsuleEmail(owner))).toBe("sent");
  });

  test("capsule emails stop at their share of the day; account emails carry on", async () => {
    const [ada, bob, cy] = [await createUser(), await createUser(), await createUser()];
    const sender = senderWith({ unlock: 2 });

    expect(await send(sender, capsuleEmail(ada))).toBe("sent");
    expect(await send(sender, { kind: "CAPSULE_OPENED", address: "b@x.com", userId: bob.id })).toBe(
      "sent",
    );

    expect(await send(sender, capsuleEmail(cy))).toBe("unlock");
    expect(await send(sender, accountEmail("a@example.com"))).toBe("sent");
  });

  test("one owner's capsule emails stop at their share, wherever they go; others carry on", async () => {
    const [ada, bob] = [await createUser(), await createUser()];
    const sender = senderWith({ perOwner: 2 });

    expect(await send(sender, { kind: "CAPSULE_OPENED", address: ada.email, userId: ada.id })).toBe(
      "sent",
    );
    expect(await send(sender, capsuleEmail(ada, "friend@example.com"))).toBe("sent");

    expect(await send(sender, capsuleEmail(ada, "other@example.com"))).toBe("perOwner");
    expect(await send(sender, capsuleEmail(bob))).toBe("sent");
  });

  test("account emails to one address: at most 2 (here) an hour", async () => {
    const owner = await createUser();
    const clock = clockAt(NOON);
    const sender = senderWith({}, clock);

    expect(await send(sender, accountEmail("ada@example.com"))).toBe("sent");
    expect(await send(sender, { kind: "RESET_PASSWORD", address: "ada@example.com" })).toBe("sent");
    expect(await send(sender, accountEmail("ada@example.com"))).toBe("perAddress");
    // Other addresses, and capsule emails to this one, aren't affected.
    expect(await send(sender, accountEmail("bob@example.com"))).toBe("sent");
    expect(await send(sender, capsuleEmail(owner, "ada@example.com"))).toBe("sent");

    clock.set("2030-06-01T12:59:59.000Z");
    expect(await send(sender, accountEmail("ada@example.com"))).toBe("perAddress");
    clock.set("2030-06-01T13:00:00.001Z");
    expect(await send(sender, accountEmail("ada@example.com"))).toBe("sent");
  });

  test("each UTC day starts a new count", async () => {
    const clock = clockAt("2030-06-01T23:59:00.000Z");
    const sender = senderWith({ daily: 2 }, clock);
    expect(await send(sender, accountEmail("a@example.com"))).toBe("sent");
    expect(await send(sender, accountEmail("b@example.com"))).toBe("sent");
    expect(await send(sender, accountEmail("c@example.com"))).toBe("daily");

    clock.set("2030-06-02T00:00:00.000Z");

    expect(await send(sender, accountEmail("c@example.com"))).toBe("sent");
  });

  test("reservations made at the same moment can't go over a limit", async () => {
    const sender = senderWith({ daily: 3 });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => sender.reserve(accountEmail(`user${i}@example.com`))),
    );

    expect(results.filter((result) => result.slot)).toHaveLength(3);
    expect(results.filter((result) => result.limitedBy === "daily")).toHaveLength(7);
    await expect(prisma.emailLog.count()).resolves.toBe(3);
  });

  test("an unknown kind of email is a programming error", async () => {
    await expect(senderWith().reserve({ kind: "NEWSLETTER", address: "a@b.co" })).rejects.toThrow(
      "Unknown email: NEWSLETTER",
    );
  });
});

describe("whether an account email can still be sent today", () => {
  test("yes until the account share is used up", async () => {
    const sender = senderWith({ account: 1 });
    await expect(sender.canSendAccountEmail()).resolves.toBe(true);

    await send(sender, accountEmail("a@example.com"));

    await expect(sender.canSendAccountEmail()).resolves.toBe(false);
  });

  test("no once the whole day is used up, by any kind of email", async () => {
    const owner = await createUser();
    const sender = senderWith({ daily: 1 });

    await send(sender, capsuleEmail(owner));

    await expect(sender.canSendAccountEmail()).resolves.toBe(false);
  });

  test("failed emails don't count, and neither do yesterday's", async () => {
    const clock = clockAt("2030-06-01T23:00:00.000Z");
    const sender = senderWith({ account: 1 }, clock);
    mailer.failNext("rejected");
    await send(sender, accountEmail("a@example.com"));
    await expect(sender.canSendAccountEmail()).resolves.toBe(true);
    await send(sender, accountEmail("a@example.com"));
    await expect(sender.canSendAccountEmail()).resolves.toBe(false);

    clock.set("2030-06-02T00:00:00.000Z");

    await expect(sender.canSendAccountEmail()).resolves.toBe(true);
  });
});

test("seconds until the provider's quota resets, at midnight UTC", () => {
  expect(secondsUntilNextUtcDay(new Date("2030-06-01T23:59:30.000Z"))).toBe(30);
  expect(secondsUntilNextUtcDay(new Date("2030-06-01T00:00:00.000Z"))).toBe(24 * 60 * 60);
  expect(secondsUntilNextUtcDay(new Date("2030-06-01T12:00:00.500Z"))).toBe(12 * 60 * 60);
});

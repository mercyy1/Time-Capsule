const request = require("supertest");
const { app, prisma } = require("./helpers/app");
const { daysFromNow, resetDatabase, seedCapsule } = require("./helpers/db");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every "no such capsule (that you may see)" answer, whatever the route.
const CAPSULE_NOT_FOUND = { error: "Capsule not found", code: "NOT_FOUND" };

// Creates a capsule through the API (so the unlock date must be in the future).
async function createCapsule(owner, fields = {}) {
  const res = await request(app)
    .post("/capsules")
    .set("Authorization", owner.auth)
    .send({
      title: "Hello future",
      message: "the secret",
      unlockDate: daysFromNow(30).toISOString(),
      ...fields,
    })
    .expect(201);
  return res.body;
}

test("GET / answers without authentication", async () => {
  const res = await request(app).get("/");

  expect(res.status).toBe(200);
  expect(res.text).toBe("Time Capsule API");
});

describe("POST /capsules", () => {
  test("creates a private capsule owned by the caller", async () => {
    const ada = await signUp();
    const unlockDate = daysFromNow(30).toISOString();

    const res = await request(app)
      .post("/capsules")
      .set("Authorization", ada.auth)
      .send({ title: "Hello future", message: "the secret", unlockDate });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/capsules/slug/${res.body.slug}`);
    expect(res.body).toEqual({
      id: expect.any(Number),
      title: "Hello future",
      message: "the secret",
      unlockDate,
      isPublic: false,
      slug: expect.stringMatching(UUID),
      recipientEmail: null,
    });
    const stored = await prisma.capsule.findUnique({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ ownerId: ada.user.id, notified: false, recipientEmail: null });
  });

  test("stores isPublic: true", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, { isPublic: true });

    expect(capsule.isPublic).toBe(true);
  });

  test("stores the optional recipient email, trimmed and lowercased", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, { recipientEmail: "  Bob@Example.COM " });

    expect(capsule.recipientEmail).toBe("bob@example.com");
    const stored = await prisma.capsule.findUnique({ where: { id: capsule.id } });
    expect(stored.recipientEmail).toBe("bob@example.com");
  });

  test.each([
    ["empty", ""],
    ["blank", "   "],
    ["null", null],
    ["left out", undefined],
  ])("a recipient email that is %s means nobody", async (_case, recipientEmail) => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, { recipientEmail });

    expect(capsule.recipientEmail).toBeNull();
  });

  test.each([
    ["isn't an address", "not-an-email", "Enter a valid email address for the recipient"],
    ["isn't text", 42, "Recipient email must be text"],
    [
      "is too long",
      `${"a".repeat(64)}@${"b".repeat(190)}.com`,
      "Recipient email must be at most 254 characters",
    ],
  ])(
    "400 VALIDATION_FAILED for a recipient email that %s",
    async (_case, recipientEmail, error) => {
      const ada = await signUp();

      const res = await request(app)
        .post("/capsules")
        .set("Authorization", ada.auth)
        .send({
          title: "Hello future",
          message: "the secret",
          unlockDate: daysFromNow(30).toISOString(),
          recipientEmail,
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error,
        code: "VALIDATION_FAILED",
        details: [{ field: "recipientEmail", message: error }],
      });
      await expect(prisma.capsule.count()).resolves.toBe(0);
    },
  );

  test("keeps the exact instant of a date given with a UTC offset", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, { unlockDate: "2031-03-14T10:00:00+05:30" });

    expect(capsule.unlockDate).toBe("2031-03-14T04:30:00.000Z");
    const stored = await prisma.capsule.findUnique({ where: { id: capsule.id } });
    expect(stored.unlockDate.toISOString()).toBe("2031-03-14T04:30:00.000Z");
  });

  test.each([
    ["title", "Title is required"],
    ["message", "Message is required"],
    ["unlockDate", "Unlock date is required"],
  ])("rejects a missing %s with 400", async (field, message) => {
    const ada = await signUp();
    const body = { title: "Hello", message: "secret", unlockDate: daysFromNow(30).toISOString() };
    delete body[field];

    const res = await request(app).post("/capsules").set("Authorization", ada.auth).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: message,
      code: "VALIDATION_FAILED",
      details: [{ field, message }],
    });
  });

  // Each case changes one field of an otherwise valid capsule.
  const DATE_FORMAT_ERROR =
    "Unlock date must be a date and time with a time zone, like 2030-01-01T09:00:00Z";
  test.each([
    ["an unlock date that isn't a date", { unlockDate: "next tuesday" }, DATE_FORMAT_ERROR],
    ["an unlock date without a time zone", { unlockDate: "2030-01-01T00:00" }, DATE_FORMAT_ERROR],
    ["an impossible calendar date", { unlockDate: "2031-02-30T10:00:00Z" }, DATE_FORMAT_ERROR],
    [
      "an unlock date in the past",
      { unlockDate: daysFromNow(-1).toISOString() },
      "Unlock date must be in the future",
    ],
    [
      "an unlock date more than 50 years ahead",
      { unlockDate: "9999-12-31T00:00:00Z" },
      "Unlock date must be at most 50 years from now",
    ],
    ['isPublic as the string "false"', { isPublic: "false" }, "isPublic must be true or false"],
    ["a number as title", { title: 42 }, "Title must be text"],
    ["a title of only spaces", { title: "   " }, "Title is required"],
    [
      "a title over 200 characters",
      { title: "t".repeat(201) },
      "Title must be at most 200 characters",
    ],
    [
      "a message over 10,000 characters",
      { message: "m".repeat(10_001) },
      "Message must be at most 10,000 characters",
    ],
  ])("rejects %s with 400 and stores nothing", async (_case, change, message) => {
    const ada = await signUp();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app)
      .post("/capsules")
      .set("Authorization", ada.auth)
      .send({
        title: "Hello",
        message: "secret",
        unlockDate: daysFromNow(30).toISOString(),
        ...change,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: message, code: "VALIDATION_FAILED" });
    await expect(prisma.capsule.count()).resolves.toBe(0);
    // Bad input is turned away before Prisma, which would log the whole call, message included.
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("accepts the longest title and message and a date 49 years ahead", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, {
      title: "t".repeat(200),
      message: "m".repeat(10_000),
      unlockDate: daysFromNow(49 * 365).toISOString(),
    });

    expect(capsule.title).toHaveLength(200);
    expect(capsule.message).toHaveLength(10_000);
  });

  test("accepts the largest capsule in bytes, all emoji, under the 64 kB body limit", async () => {
    const ada = await signUp();
    // 4 bytes each in UTF-8; the request body is about 41 kB.
    const fields = { title: "🎉".repeat(200), message: "😀".repeat(10_000) };

    const capsule = await createCapsule(ada, fields);

    expect(capsule).toMatchObject(fields);
  });

  test("trims the title and message, and ignores fields it doesn't know such as email", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, {
      title: "  Hello future  ",
      message: "\n  the secret \n",
      email: "someone@example.com",
    });

    expect(capsule).toMatchObject({ title: "Hello future", message: "the secret" });
    const stored = await prisma.capsule.findUnique({ where: { id: capsule.id } });
    expect(stored.recipientEmail).toBeNull();
  });

  test("requires a token", async () => {
    const res = await request(app)
      .post("/capsules")
      .send({ title: "Hello", message: "secret", unlockDate: daysFromNow(30).toISOString() });

    expect(res.status).toBe(401);
  });
});

describe("GET /capsules", () => {
  test("lists only the caller's capsules, soonest unlock first", async () => {
    const ada = await signUp();
    const bob = await signUp();
    await createCapsule(ada, { title: "later", unlockDate: daysFromNow(60).toISOString() });
    await createCapsule(ada, { title: "sooner", unlockDate: daysFromNow(10).toISOString() });
    await createCapsule(bob, { title: "bob's" });

    const res = await request(app).get("/capsules").set("Authorization", ada.auth);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.title)).toEqual(["sooner", "later"]);
  });

  test("returns message: null while a capsule is locked and the message once it unlocks", async () => {
    const ada = await signUp();
    const locked = await createCapsule(ada, {
      message: "not yet",
      recipientEmail: "bob@example.com",
    });
    const unlocked = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      message: "hello again",
    });

    const res = await request(app).get("/capsules").set("Authorization", ada.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: unlocked.id,
        title: unlocked.title,
        unlockDate: unlocked.unlockDate.toISOString(),
        isPublic: false,
        slug: unlocked.slug,
        recipientEmail: null,
        message: "hello again",
      },
      {
        id: locked.id,
        title: locked.title,
        unlockDate: locked.unlockDate,
        isPublic: false,
        slug: locked.slug,
        recipientEmail: "bob@example.com",
        message: null,
      },
    ]);
  });

  test("returns an empty list for a new user", async () => {
    const ada = await signUp();

    const res = await request(app).get("/capsules").set("Authorization", ada.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /capsules/slug/:slug", () => {
  const open = (slug, user) => {
    const req = request(app).get(`/capsules/slug/${slug}`);
    return user ? req.set("Authorization", user.auth) : req;
  };

  test("owner, locked: which capsule it is (was only the status), never the message", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada, { recipientEmail: "bob@example.com" });

    const res = await open(capsule.slug, ada);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "locked",
      unlocksAt: capsule.unlockDate,
      capsule: { id: capsule.id, title: capsule.title, unlockDate: capsule.unlockDate },
    });
  });

  test("owner, unlocked: the capsule with its message", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      message: "hello again",
      recipientEmail: "bob@example.com",
    });

    const res = await open(capsule.slug, ada);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "unlocked",
      capsule: {
        id: capsule.id,
        title: capsule.title,
        message: "hello again",
        unlockDate: capsule.unlockDate.toISOString(),
      },
    });
  });

  test.each([
    ["locked", 30],
    ["unlocked", -1],
  ])("stranger, private and %s: 404, as if it didn't exist (was 403)", async (_state, days) => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(days) });

    const res = await open(capsule.slug, bob);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("stranger, public and locked: only the status and unlock time", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await createCapsule(ada, {
      isPublic: true,
      recipientEmail: "cy@example.com",
    });

    const res = await open(capsule.slug, bob);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "locked", unlocksAt: capsule.unlockDate });
  });

  test("stranger, public and unlocked: the capsule with its message, not who it was emailed to", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      isPublic: true,
      message: "for everyone",
      recipientEmail: "cy@example.com",
    });

    const res = await open(capsule.slug, bob);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "unlocked",
      capsule: {
        id: capsule.id,
        title: capsule.title,
        message: "for everyone",
        unlockDate: capsule.unlockDate.toISOString(),
      },
    });
  });

  test("404 for a slug that doesn't exist", async () => {
    const ada = await signUp();

    const res = await open("00000000-0000-4000-8000-000000000000", ada);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("404 without a database query for a slug that isn't a UUID", async () => {
    const ada = await signUp();
    const query = jest.spyOn(prisma.capsule, "findUnique");

    const res = await open("not-a-uuid", ada);

    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });

  test("requires a token, even for a public capsule", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada, { isPublic: true });

    const res = await open(capsule.slug);

    expect(res.status).toBe(401);
  });
});

describe("GET /capsules/public/:slug", () => {
  test("anyone, locked: only the status and unlock time", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada, {
      isPublic: true,
      recipientEmail: "cy@example.com",
    });

    const res = await request(app).get(`/capsules/public/${capsule.slug}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "locked", unlocksAt: capsule.unlockDate });
  });

  test("anyone, unlocked: display fields only (no id, owner, recipient or flags)", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      isPublic: true,
      message: "for everyone",
      recipientEmail: "cy@example.com",
    });

    const res = await request(app).get(`/capsules/public/${capsule.slug}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "unlocked",
      capsule: {
        title: capsule.title,
        message: "for everyone",
        unlockDate: capsule.unlockDate.toISOString(),
        createdAt: capsule.createdAt.toISOString(),
      },
    });
  });

  test("404 for a private capsule, even when unlocked and asked for by its owner", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(-1) });

    const res = await request(app)
      .get(`/capsules/public/${capsule.slug}`)
      .set("Authorization", ada.auth);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("404 for a slug that doesn't exist", async () => {
    const res = await request(app).get("/capsules/public/00000000-0000-4000-8000-000000000000");

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("404 without a database query for a slug that isn't a UUID", async () => {
    const query = jest.spyOn(prisma.capsule, "findUnique");

    const res = await request(app).get(`/capsules/public/${"x".repeat(5000)}`);

    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
});

describe("DELETE /capsules/:id", () => {
  test("the owner can delete it", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);

    const res = await request(app).delete(`/capsules/${capsule.id}`).set("Authorization", ada.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Capsule deleted" });
    await expect(prisma.capsule.findUnique({ where: { id: capsule.id } })).resolves.toBeNull();
  });

  test("someone else's public capsule: 403 (they can see it) and the capsule stays", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await createCapsule(ada, { isPublic: true });

    const res = await request(app).delete(`/capsules/${capsule.id}`).set("Authorization", bob.auth);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Only the owner can delete this capsule",
      code: "FORBIDDEN",
    });
    await expect(prisma.capsule.findUnique({ where: { id: capsule.id } })).resolves.not.toBeNull();
  });

  test("someone else's private capsule: 404, as if it didn't exist (was 403), and it stays", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await createCapsule(ada);

    const res = await request(app).delete(`/capsules/${capsule.id}`).set("Authorization", bob.auth);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
    await expect(prisma.capsule.findUnique({ where: { id: capsule.id } })).resolves.not.toBeNull();
  });

  test("404 for an id that doesn't exist", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/999999").set("Authorization", ada.auth);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("deleting twice: the second time is a 404", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);
    const remove = () =>
      request(app).delete(`/capsules/${capsule.id}`).set("Authorization", ada.auth);

    expect((await remove()).status).toBe(200);
    const again = await remove();

    expect(again.status).toBe(404);
    expect(again.body).toEqual(CAPSULE_NOT_FOUND);
  });

  test("two deletes at the same moment: one 200 and one 404, never a 500", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);
    const remove = () =>
      request(app).delete(`/capsules/${capsule.id}`).set("Authorization", ada.auth);

    const results = await Promise.all([remove(), remove()]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 404]);
    await expect(prisma.capsule.count()).resolves.toBe(0);
  });

  test.each([
    ["isn't a number", "abc"],
    ["is too big for the database (was a 500)", "99999999999"],
    ["is zero", "0"],
    ["is negative", "-1"],
    ["has a fraction", "1.5"],
    ["uses exponent notation", "1e3"],
    ["is hexadecimal", "0x10"],
  ])("400 for an id that %s", async (_case, id) => {
    const ada = await signUp();

    const res = await request(app).delete(`/capsules/${id}`).set("Authorization", ada.auth);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invalid capsule id",
      code: "VALIDATION_FAILED",
      details: [{ field: "id", message: "Invalid capsule id" }],
    });
  });

  test("accepts the largest id the database can hold", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/2147483647").set("Authorization", ada.auth);

    expect(res.status).toBe(404);
  });

  test("requires a token", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);

    const res = await request(app).delete(`/capsules/${capsule.id}`);

    expect(res.status).toBe(401);
    await expect(prisma.capsule.count()).resolves.toBe(1);
  });
});

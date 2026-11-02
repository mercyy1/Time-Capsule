const request = require("supertest");
const { app, prisma } = require("./helpers/app");
const { daysFromNow, resetDatabase, seedCapsule } = require("./helpers/db");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    .expect(200);
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

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: expect.any(Number),
      title: "Hello future",
      message: "the secret",
      unlockDate,
      isPublic: false,
      slug: expect.stringMatching(UUID),
    });
    const stored = await prisma.capsule.findUnique({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ ownerId: ada.user.id, notified: false, email: null });
  });

  test("stores isPublic: true", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, { isPublic: true });

    expect(capsule.isPublic).toBe(true);
  });

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

  test("trims the title and message, and ignores fields it doesn't know such as email", async () => {
    const ada = await signUp();

    const capsule = await createCapsule(ada, {
      title: "  Hello future  ",
      message: "\n  the secret \n",
      email: "someone@example.com",
    });

    expect(capsule).toMatchObject({ title: "Hello future", message: "the secret" });
    const stored = await prisma.capsule.findUnique({ where: { id: capsule.id } });
    expect(stored.email).toBeNull();
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
    const locked = await createCapsule(ada, { message: "not yet" });
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
        message: "hello again",
      },
      {
        id: locked.id,
        title: locked.title,
        unlockDate: locked.unlockDate,
        isPublic: false,
        slug: locked.slug,
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

  test("owner, locked: only the status and unlock time, never the message", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);

    const res = await open(capsule.slug, ada);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "locked", unlocksAt: capsule.unlockDate });
  });

  test("owner, unlocked: the capsule with its message", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      message: "hello again",
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
  ])("stranger, private and %s: 403", async (_state, days) => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await seedCapsule({ ownerId: ada.user.id, unlockDate: daysFromNow(days) });

    const res = await open(capsule.slug, bob);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Unauthorized", code: "FORBIDDEN" });
  });

  test("stranger, public and locked: only the status and unlock time", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await createCapsule(ada, { isPublic: true });

    const res = await open(capsule.slug, bob);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "locked", unlocksAt: capsule.unlockDate });
  });

  test("stranger, public and unlocked: the capsule with its message", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      isPublic: true,
      message: "for everyone",
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
    expect(res.body).toEqual({ error: "Not found", code: "NOT_FOUND" });
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
    const capsule = await createCapsule(ada, { isPublic: true });

    const res = await request(app).get(`/capsules/public/${capsule.slug}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "locked", unlocksAt: capsule.unlockDate });
  });

  test("anyone, unlocked: display fields only (no id, owner, email or flags)", async () => {
    const ada = await signUp();
    const capsule = await seedCapsule({
      ownerId: ada.user.id,
      unlockDate: daysFromNow(-1),
      isPublic: true,
      message: "for everyone",
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
    expect(res.body).toEqual({ error: "Capsule not found or not public", code: "NOT_FOUND" });
  });

  test("404 for a slug that doesn't exist", async () => {
    const res = await request(app).get("/capsules/public/00000000-0000-4000-8000-000000000000");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Capsule not found or not public", code: "NOT_FOUND" });
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

  test("anyone else gets 403 and the capsule stays", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const capsule = await createCapsule(ada, { isPublic: true });

    const res = await request(app).delete(`/capsules/${capsule.id}`).set("Authorization", bob.auth);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Access denied", code: "FORBIDDEN" });
    await expect(prisma.capsule.findUnique({ where: { id: capsule.id } })).resolves.not.toBeNull();
  });

  test("404 for an id that doesn't exist", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/999999").set("Authorization", ada.auth);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Capsule not found", code: "NOT_FOUND" });
  });

  test("400 for an id that isn't a number", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/abc").set("Authorization", ada.auth);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid capsule id", code: "VALIDATION_FAILED" });
  });

  test("requires a token", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);

    const res = await request(app).delete(`/capsules/${capsule.id}`);

    expect(res.status).toBe(401);
    await expect(prisma.capsule.count()).resolves.toBe(1);
  });
});

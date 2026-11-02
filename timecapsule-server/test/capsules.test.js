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

  test.each(["title", "message", "unlockDate"])("rejects a missing %s with 400", async (field) => {
    const ada = await signUp();
    const body = { title: "Hello", message: "secret", unlockDate: daysFromNow(30).toISOString() };
    delete body[field];

    const res = await request(app).post("/capsules").set("Authorization", ada.auth).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing required fields" });
  });

  test("rejects an unlock date that isn't a date", async () => {
    const ada = await signUp();

    const res = await request(app)
      .post("/capsules")
      .set("Authorization", ada.auth)
      .send({ title: "Hello", message: "secret", unlockDate: "next tuesday" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "unlockDate is not a valid date" });
  });

  test("rejects an unlock date in the past", async () => {
    const ada = await signUp();

    const res = await request(app)
      .post("/capsules")
      .set("Authorization", ada.auth)
      .send({ title: "Hello", message: "secret", unlockDate: daysFromNow(-1).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "unlockDate must be in the future" });
    await expect(prisma.capsule.count()).resolves.toBe(0);
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
    expect(res.body).toEqual({ error: "Unauthorized" });
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
    expect(res.body).toEqual({ error: "Not found" });
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
    expect(res.body).toEqual({ error: "Capsule not found or not public" });
  });

  test("404 for a slug that doesn't exist", async () => {
    const res = await request(app).get("/capsules/public/00000000-0000-4000-8000-000000000000");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Capsule not found or not public" });
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
    expect(res.body).toEqual({ error: "Access denied" });
    await expect(prisma.capsule.findUnique({ where: { id: capsule.id } })).resolves.not.toBeNull();
  });

  test("404 for an id that doesn't exist", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/999999").set("Authorization", ada.auth);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Capsule not found" });
  });

  test("400 for an id that isn't a number", async () => {
    const ada = await signUp();

    const res = await request(app).delete("/capsules/abc").set("Authorization", ada.auth);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid capsule id" });
  });

  test("requires a token", async () => {
    const ada = await signUp();
    const capsule = await createCapsule(ada);

    const res = await request(app).delete(`/capsules/${capsule.id}`);

    expect(res.status).toBe(401);
    await expect(prisma.capsule.count()).resolves.toBe(1);
  });
});

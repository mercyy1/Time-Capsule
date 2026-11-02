const request = require("supertest");
const { app, buildApp, prisma, mailer } = require("./helpers/app");
const { daysFromNow, resetDatabase, seedCapsule } = require("./helpers/db");

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const SECRET = "job-secret-for-tests-at-least-32-characters";
const appWithJobs = buildApp({ jobSecret: SECRET });

const runJob = (target, authorization) => {
  const req = request(target).post("/jobs/unlock-emails");
  return authorization === undefined ? req : req.set("Authorization", authorization);
};

// A capsule that opened yesterday, whose owner's address is confirmed.
async function openedCapsule() {
  const owner = await prisma.user.create({
    data: { email: "ada@example.com", password: "not-used", emailVerifiedAt: new Date() },
  });
  return seedCapsule({ ownerId: owner.id, unlockDate: daysFromNow(-1) });
}

test("runs the unlock-email job and answers its summary", async () => {
  await openedCapsule();

  const res = await runJob(appWithJobs, `Bearer ${SECRET}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    capsulesNotified: 1,
    capsulesGivenUp: 0,
    emailsSent: 1,
    emailsFailed: 0,
    stoppedBy: null,
    cleanedUp: { emailLogs: 0, authTokens: 0 },
  });
  expect(mailer.to("ada@example.com")).toHaveLength(1);
});

test.each([
  ["no Authorization header", undefined],
  ["a wrong secret", "Bearer not-the-secret"],
  ["the secret with a character added", `Bearer ${SECRET}x`],
  ["the secret in another scheme", `Basic ${SECRET}`],
])("401 INVALID_TOKEN with %s, and nothing runs", async (_case, authorization) => {
  const capsule = await openedCapsule();

  const res = await runJob(appWithJobs, authorization);

  expect(res.status).toBe(401);
  expect(res.headers["www-authenticate"]).toBe("Bearer");
  expect(res.body).toEqual({ error: "Invalid job secret", code: "INVALID_TOKEN" });
  expect(mailer.sent).toEqual([]);
  const stored = await prisma.capsule.findUnique({ where: { id: capsule.id } });
  expect(stored.notified).toBe(false);
});

test("502 EMAIL_PROVIDER_ERROR when the provider refuses the server's settings", async () => {
  await openedCapsule();
  mailer.failNext("config");

  const res = await runJob(appWithJobs, `Bearer ${SECRET}`);

  expect(res.status).toBe(502);
  expect(res.body).toEqual({
    error: "The email provider refused the server's settings. Check RESEND_API_KEY and EMAIL_FROM.",
    code: "EMAIL_PROVIDER_ERROR",
  });
});

test("the other early stops answer 200: a later run picks the capsules up", async () => {
  await openedCapsule();
  mailer.failNext("unavailable");

  const res = await runJob(appWithJobs, `Bearer ${SECRET}`);

  expect(res.status).toBe(200);
  expect(res.body.stoppedBy).toBe("provider-unavailable");
});

test("without JOB_SECRET there is no such route (404)", async () => {
  await openedCapsule();

  const res = await runJob(app, `Bearer ${SECRET}`);

  expect(res.status).toBe(404);
  expect(res.body.code).toBe("NOT_FOUND");
  expect(mailer.sent).toEqual([]);
});

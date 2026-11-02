const request = require("supertest");
const { app, prisma } = require("./helpers/app");
const { resetDatabase } = require("./helpers/db");
const { signUp } = require("./helpers/users");

beforeEach(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

describe("one JSON error shape", () => {
  test("malformed JSON gets 400 INVALID_JSON, not 500", async () => {
    const res = await request(app)
      .post("/signup")
      .set("Content-Type", "application/json")
      .send('{"email": "ada@example.com",');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request body isn't valid JSON", code: "INVALID_JSON" });
  });

  test("a body over the size limit gets 413 PAYLOAD_TOO_LARGE, not 500", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "ada@example.com", password: "x".repeat(200 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: "The request body is too large (the limit is 100 kB)",
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  test("an unknown route gets a JSON 404 instead of an HTML page", async () => {
    const res = await request(app).get("/no-such-route");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: "Not found", code: "NOT_FOUND" });
  });

  test("an unexpected failure gets a 500 that hides the cause, and is logged", async () => {
    const ada = await signUp();
    const failure = new Error("connection to the database was lost");
    jest.spyOn(prisma.capsule, "findMany").mockRejectedValue(failure);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/capsules").set("Authorization", ada.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong", code: "INTERNAL_ERROR" });
    expect(JSON.stringify(res.body)).not.toContain("database");
    expect(log).toHaveBeenCalledWith(failure);
  });

  test("client errors aren't logged", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});

    await request(app).post("/signup").set("Content-Type", "application/json").send("{oops");
    await request(app).get("/no-such-route");

    expect(log).not.toHaveBeenCalled();
  });
});

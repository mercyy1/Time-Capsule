const request = require("supertest");
const { app, prisma } = require("./helpers/app");

afterAll(() => prisma.$disconnect());

describe("security headers", () => {
  test.each([
    ["a normal response", (agent) => agent.get("/")],
    ["an error response", (agent) => agent.get("/no-such-route")],
    ["a 401", (agent) => agent.get("/capsules")],
  ])("are on %s", async (_case, send) => {
    const res = await send(request(app));

    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "content-security-policy": expect.stringContaining("default-src 'self'"),
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "no-referrer",
    });
  });

  test("the response doesn't say it comes from Express (X-Powered-By)", async () => {
    const res = await request(app).get("/");

    expect(res.headers).not.toHaveProperty("x-powered-by");
  });
});

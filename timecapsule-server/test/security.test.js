const request = require("supertest");
const { app, buildApp, prisma } = require("./helpers/app");

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

describe("CORS", () => {
  const SITE = "https://timecapsule.example";
  const PAGES = "https://timecapsule.pages.dev";
  const twoSites = buildApp({ clientOrigins: [SITE, PAGES] });

  test.each([SITE, PAGES])("echoes an allowed origin: %s", async (origin) => {
    const res = await request(twoSites).get("/").set("Origin", origin);

    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    // Tells caches the answer depends on the Origin header.
    expect(res.headers.vary).toMatch(/\bOrigin\b/);
  });

  test("gives any other origin no CORS header, so browsers block the call", async () => {
    const res = await request(twoSites).get("/").set("Origin", "https://evil.example");

    expect(res.headers).not.toHaveProperty("access-control-allow-origin");
  });

  test("answers the browser's preflight for an allowed origin", async () => {
    const res = await request(twoSites)
      .options("/capsules")
      .set("Origin", SITE)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(SITE);
    expect(res.headers["access-control-allow-methods"]).toMatch(/\bPOST\b/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/i);
  });

  test("refuses the preflight of any other origin", async () => {
    const res = await request(twoSites)
      .options("/capsules")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers).not.toHaveProperty("access-control-allow-origin");
  });

  test("allows CLIENT_ORIGIN when no list is given", async () => {
    const res = await request(app).get("/").set("Origin", "http://localhost:3000");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });
});

const express = require("express");
const request = require("supertest");
const { app, buildApp, prisma, status, errorHandling } = require("./helpers/app");

afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const DATABASE_DOWN = {
  error: "The database isn't answering.",
  code: "DATABASE_UNAVAILABLE",
};

describe("GET /", () => {
  test("answers without asking the database (it's what keeps the server awake)", async () => {
    const checkDatabase = jest.fn();

    const res = await request(buildApp({ checkDatabase })).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toBe("Time Capsule API");
    expect(checkDatabase).not.toHaveBeenCalled();
  });
});

describe("GET /health", () => {
  test("200 when the database answers, never cached", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  test("503 DATABASE_UNAVAILABLE when the database fails, with the reason in the log", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const checkDatabase = () => Promise.reject(new Error("connection refused"));

    const res = await request(buildApp({ checkDatabase })).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual(DATABASE_DOWN);
    expect(logged).toHaveBeenCalledWith(
      "Health check: the database didn't answer:",
      "connection refused",
    );
  });

  test("503 when the check itself throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const checkDatabase = () => {
      throw new Error("not connected");
    };

    const res = await request(buildApp({ checkDatabase })).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual(DATABASE_DOWN);
  });

  test("503 when the database doesn't answer in time", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const quick = express();
    quick.use(
      status.createStatusRouter({
        checkDatabase: () => new Promise(() => {}),
        databaseTimeoutMs: 50,
      }),
    );
    quick.use(errorHandling.errorHandler);

    const res = await request(quick).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual(DATABASE_DOWN);
    expect(logged).toHaveBeenCalledWith(
      "Health check: the database didn't answer:",
      "no answer after 50 ms",
    );
  });
});

describe("GET /ip", () => {
  test("with no proxy (TRUST_PROXY=0), the address that connected", async () => {
    const res = await request(buildApp({ trustProxy: 0 })).get("/ip");

    expect(res.status).toBe(200);
    // Supertest connects over the loopback interface, IPv4 or IPv6.
    expect(res.body.ip).toMatch(/^(::ffff:127\.0\.0\.1|127\.0\.0\.1|::1)$/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  test("behind one proxy (TRUST_PROXY=1), the address the proxy saw, whatever the caller forged", async () => {
    // The proxy appends the address it saw (last); anything before it came from the caller.
    const res = await request(buildApp({ trustProxy: 1 }))
      .get("/ip")
      .set("X-Forwarded-For", "198.51.100.7, 203.0.113.1");

    expect(res.body).toEqual({ ip: "203.0.113.1" });
  });
});

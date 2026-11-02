const { parseEnv, EnvError } = require("../src/config/env");

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/timecapsule",
  JWT_SECRET: "a".repeat(32),
};

// The error parseEnv throws for `source` (fails the test if it doesn't throw).
function errorFor(source) {
  try {
    parseEnv(source);
  } catch (err) {
    return err;
  }
  throw new Error("expected parseEnv to throw");
}

test("applies defaults for the optional variables", () => {
  expect(parseEnv(valid)).toEqual({
    ...valid,
    NODE_ENV: "development",
    PORT: 5000,
    CLIENT_ORIGIN: ["http://localhost:3000"],
    TRUST_PROXY: 0,
    APP_URL: "http://localhost:3000",
    EMAIL_DAILY_LIMIT: 100,
  });
});

test("reads every variable and turns PORT into a number", () => {
  const env = parseEnv({
    ...valid,
    NODE_ENV: "production",
    PORT: "8080",
    CLIENT_ORIGIN: "https://timecapsule.example",
    TRUST_PROXY: "1",
    APP_URL: "https://timecapsule.example",
    EMAIL_FROM: "TimeCapsule <capsules@timecapsule.example>",
    RESEND_API_KEY: "re_123456789",
    JOB_SECRET: "j".repeat(32),
    EMAIL_DAILY_LIMIT: "3000",
  });

  expect(env).toMatchObject({
    NODE_ENV: "production",
    PORT: 8080,
    CLIENT_ORIGIN: ["https://timecapsule.example"],
    TRUST_PROXY: 1,
    APP_URL: "https://timecapsule.example",
    EMAIL_FROM: "TimeCapsule <capsules@timecapsule.example>",
    RESEND_API_KEY: "re_123456789",
    JOB_SECRET: "j".repeat(32),
    EMAIL_DAILY_LIMIT: 3000,
  });
});

test("reads several client origins separated by commas, spaces allowed", () => {
  const env = parseEnv({
    ...valid,
    CLIENT_ORIGIN: "https://timecapsule.example, https://timecapsule.pages.dev",
  });

  expect(env.CLIENT_ORIGIN).toEqual([
    "https://timecapsule.example",
    "https://timecapsule.pages.dev",
  ]);
  expect(Object.isFrozen(env.CLIENT_ORIGIN)).toBe(true);
});

test("ignores variables it doesn't know", () => {
  expect(parseEnv({ ...valid, PATH: "/usr/bin" })).not.toHaveProperty("PATH");
});

test("returns settings that can't be changed afterwards", () => {
  expect(Object.isFrozen(parseEnv(valid))).toBe(true);
});

test("lists every missing required variable at once", () => {
  const err = errorFor({});

  expect(err).toBeInstanceOf(EnvError);
  expect(err.message).toMatch(/DATABASE_URL is required/);
  expect(err.message).toMatch(/JWT_SECRET is required/);
});

test("treats an empty value as not set", () => {
  const err = errorFor({ DATABASE_URL: "", JWT_SECRET: "" });
  expect(err.message).toMatch(/DATABASE_URL is required/);
  expect(err.message).toMatch(/JWT_SECRET is required/);

  expect(parseEnv({ ...valid, PORT: "", CLIENT_ORIGIN: "" })).toMatchObject({
    PORT: 5000,
    CLIENT_ORIGIN: ["http://localhost:3000"],
  });
});

test("rejects a JWT_SECRET shorter than 32 characters and says how to make one", () => {
  const err = errorFor({ ...valid, JWT_SECRET: "a".repeat(31) });

  expect(err.message).toMatch(/JWT_SECRET must be at least 32 characters/);
  expect(err.message).toMatch(/randomBytes/);
});

test.each(["mysql://user@localhost/db", "localhost:5432/db", "psql 'postgresql://user@host/db'"])(
  "rejects a DATABASE_URL that isn't a PostgreSQL connection string: %s",
  (url) => {
    expect(errorFor({ ...valid, DATABASE_URL: url }).message).toMatch(
      /DATABASE_URL must be a PostgreSQL/,
    );
  },
);

test("accepts the postgres:// form too", () => {
  expect(parseEnv({ ...valid, DATABASE_URL: "postgres://user@host/db" }).DATABASE_URL).toBe(
    "postgres://user@host/db",
  );
});

test.each(["0", "65536", "abc", "5000.5"])("rejects PORT=%s", (port) => {
  expect(errorFor({ ...valid, PORT: port }).message).toMatch(
    /PORT must be a whole number from 1 to 65535/,
  );
});

test.each([
  "https://timecapsule.example/",
  "https://timecapsule.example/app",
  "timecapsule.example",
  "https://timecapsule.example, https://timecapsule.pages.dev/",
  "https://timecapsule.example,",
])("rejects a CLIENT_ORIGIN that isn't a bare origin (or a list of them): %s", (origin) => {
  expect(errorFor({ ...valid, CLIENT_ORIGIN: origin }).message).toMatch(
    /CLIENT_ORIGIN must be an origin/,
  );
});

test.each(["-1", "6", "1.5", "true", "abc"])("rejects TRUST_PROXY=%s", (value) => {
  expect(errorFor({ ...valid, TRUST_PROXY: value }).message).toMatch(
    /TRUST_PROXY must be a whole number from 0 to 5/,
  );
});

test("rejects an unknown NODE_ENV", () => {
  expect(errorFor({ ...valid, NODE_ENV: "staging" }).message).toMatch(
    /NODE_ENV must be development, test or production/,
  );
});

test("requires the client, email and job settings in production, listed with the other problems", () => {
  const err = errorFor({ DATABASE_URL: valid.DATABASE_URL, NODE_ENV: "production" });

  for (const name of ["CLIENT_ORIGIN", "APP_URL", "EMAIL_FROM", "RESEND_API_KEY", "JOB_SECRET"]) {
    expect(err.message).toMatch(new RegExp(`${name} is required when NODE_ENV is production`));
  }
  expect(err.message).toMatch(/JWT_SECRET is required/);
});

test("in production, a malformed setting is reported once, as malformed", () => {
  const err = errorFor({
    ...valid,
    NODE_ENV: "production",
    CLIENT_ORIGIN: "https://timecapsule.example",
    APP_URL: "https://timecapsule.example",
    EMAIL_FROM: "capsules@timecapsule.example",
    RESEND_API_KEY: "re_123",
    JOB_SECRET: "too-short",
  });

  expect(err.message).toMatch(/JOB_SECRET must be at least 32 characters/);
  expect(err.message).not.toMatch(/JOB_SECRET is required/);
});

describe("email settings", () => {
  test.each(["capsules@timecapsule.example", "TimeCapsule <capsules@timecapsule.example>"])(
    "accepts EMAIL_FROM=%s",
    (from) => {
      expect(parseEnv({ ...valid, EMAIL_FROM: from }).EMAIL_FROM).toBe(from);
    },
  );

  test.each([
    "capsules",
    "TimeCapsule capsules@timecapsule.example",
    "TimeCapsule <capsules@timecapsule.example",
    "<capsules@timecapsule.example>",
    "capsules@timecapsule.example, other@timecapsule.example",
    "Time\r\nBcc: x@y.z <capsules@timecapsule.example>",
  ])("rejects EMAIL_FROM=%j", (from) => {
    expect(errorFor({ ...valid, EMAIL_FROM: from }).message).toMatch(
      /EMAIL_FROM must be an address like capsules@example.com/,
    );
  });

  test("requires EMAIL_FROM once RESEND_API_KEY is set, even outside production", () => {
    expect(errorFor({ ...valid, RESEND_API_KEY: "re_123" }).message).toMatch(
      /EMAIL_FROM is required when RESEND_API_KEY is set/,
    );
  });

  test("rejects a RESEND_API_KEY that isn't one", () => {
    expect(errorFor({ ...valid, RESEND_API_KEY: "sk_live_123" }).message).toMatch(
      /RESEND_API_KEY must be a Resend API key \(they start with re_\)/,
    );
  });

  test.each([
    "https://timecapsule.example/",
    "https://timecapsule.example/app",
    "timecapsule.example",
  ])("rejects an APP_URL that isn't a bare origin: %s", (url) => {
    expect(errorFor({ ...valid, APP_URL: url }).message).toMatch(
      /APP_URL must be the web client's address/,
    );
  });

  test.each(["9", "1000001", "1.5", "lots"])("rejects EMAIL_DAILY_LIMIT=%s", (limit) => {
    expect(errorFor({ ...valid, EMAIL_DAILY_LIMIT: limit }).message).toMatch(
      /EMAIL_DAILY_LIMIT must be a whole number from 10 to 1000000/,
    );
  });

  test("rejects a JOB_SECRET shorter than 32 characters and says how to make one", () => {
    const err = errorFor({ ...valid, JOB_SECRET: "j".repeat(31) });

    expect(err.message).toMatch(/JOB_SECRET must be at least 32 characters/);
    expect(err.message).toMatch(/randomBytes/);
  });
});

test("never includes the values in the error message", () => {
  const err = errorFor({
    DATABASE_URL: "mysql://admin:hunter2-db-password@db.internal/app",
    JWT_SECRET: "short-but-secret",
    CLIENT_ORIGIN: "https://secret-host.example/path",
    RESEND_API_KEY: "not-a-key-hunter3",
    JOB_SECRET: "job-hunter4",
  });

  expect(err.message).not.toMatch(/hunter|short-but-secret|secret-host/);
});

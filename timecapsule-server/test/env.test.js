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
  });
});

test("reads every variable and turns PORT into a number", () => {
  const env = parseEnv({
    ...valid,
    NODE_ENV: "production",
    PORT: "8080",
    CLIENT_ORIGIN: "https://timecapsule.example",
    TRUST_PROXY: "1",
  });

  expect(env).toMatchObject({
    NODE_ENV: "production",
    PORT: 8080,
    CLIENT_ORIGIN: ["https://timecapsule.example"],
    TRUST_PROXY: 1,
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

test("requires CLIENT_ORIGIN in production, reported with the other problems", () => {
  const err = errorFor({ DATABASE_URL: valid.DATABASE_URL, NODE_ENV: "production" });

  expect(err.message).toMatch(/CLIENT_ORIGIN is required when NODE_ENV is production/);
  expect(err.message).toMatch(/JWT_SECRET is required/);
});

test("never includes the values in the error message", () => {
  const err = errorFor({
    DATABASE_URL: "mysql://admin:hunter2-db-password@db.internal/app",
    JWT_SECRET: "short-but-secret",
    CLIENT_ORIGIN: "https://secret-host.example/path",
  });

  expect(err.message).not.toMatch(/hunter2|short-but-secret|secret-host/);
});

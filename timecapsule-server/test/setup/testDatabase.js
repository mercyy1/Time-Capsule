// Which database the tests use, and a check that it really is a test database:
// the tests delete all of its data before every test.
const DEFAULT_TEST_DATABASE_URL =
  "postgresql://timecapsule:timecapsule@localhost:5432/timecapsule_test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

function assertTestDatabase(url) {
  const name = URL.canParse(url) ? new URL(url).pathname.slice(1) : "";
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to use database "${name}" for tests: its name must end in _test, ` +
        "because the tests delete all of its data.",
    );
  }
}

module.exports = { testDatabaseUrl, assertTestDatabase };

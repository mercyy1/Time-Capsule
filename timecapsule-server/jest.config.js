/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  // Applies the migrations to the test database once, before any test runs.
  globalSetup: "<rootDir>/test/setup/globalSetup.js",
  // Gives every test file the same known settings (see the file for why).
  setupFiles: ["<rootDir>/test/setup/env.js"],
  // After each test, waits for the work it started in the background (see the file).
  setupFilesAfterEnv: ["<rootDir>/test/setup/settle.js"],
  // All test files share one database, so they must run one at a time.
  maxWorkers: 1,
};

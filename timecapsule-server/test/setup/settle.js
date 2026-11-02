// Runs in every test file: after each test, waits for the work its requests
// started after responding (sending emails, mostly), so none of it spills into
// the next test, and fails the test if any of that work failed.
const { settle } = require("../helpers/app");

afterEach(settle);

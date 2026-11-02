import js from "@eslint/js";
import playwright from "eslint-plugin-playwright";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig([
  globalIgnores([".client/", ".outbox/", "playwright-report/", "test-results/", "blob-report/"]),
  {
    files: ["**/*.{js,cjs}"],
    extends: [js.configs.recommended],
    // Node, plus the browser for the code tests run inside pages (page.evaluate).
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    // Catches the commonest end-to-end bug, a missing await, among others.
    files: ["tests/**"],
    extends: [playwright.configs["flat/recommended"]],
    rules: {
      // Helpers named expect… hold a test's assertions.
      "playwright/expect-expect": ["warn", { assertFunctionPatterns: ["^expect"] }],
    },
  },
]);

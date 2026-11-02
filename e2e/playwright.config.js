// End-to-end tests: the built web client and the API, run together against their
// own database, driven in Google Chrome. `npm test` starts everything itself.
import { defineConfig, devices } from "@playwright/test";
import settings from "./support/settings.cjs";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: settings.CLIENT_URL,
    // The installed Google Chrome rather than a browser Playwright downloads (on a
    // CI machine without Chrome: `npx playwright install chrome`).
    channel: "chrome",
    // Dates and times are shown in the browser's language and time zone; tests
    // that are about time zones choose their own.
    locale: "en-US",
    timezoneId: "America/Toronto",
    trace: "retain-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    // Tests tagged @phone also run on a phone-sized touch screen.
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" }, grep: /@phone/ },
  ],

  webServer: [
    {
      name: "API",
      command: "node support/api-server.cjs",
      url: `${settings.API_URL}/`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // The production build, as deployed, pointed at the test API.
      name: "Client",
      cwd: "../timecapsule-client",
      command:
        `npx vite build --outDir "${settings.CLIENT_BUILD}" --emptyOutDir && ` +
        `npx vite preview --outDir "${settings.CLIENT_BUILD}" --port ${settings.CLIENT_PORT} --strictPort`,
      url: settings.CLIENT_URL,
      env: {
        ...process.env,
        VITE_API_URL: settings.API_URL,
        VITE_TURNSTILE_SITE_KEY: settings.TURNSTILE_SITE_KEY,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

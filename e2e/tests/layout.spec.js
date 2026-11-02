import { createCapsule, expect, logIn, test } from "../support/fixtures.js";
import settings from "../support/settings.cjs";

const DAY = 24 * 60 * 60 * 1000;

// The headers Cloudflare Pages sends (the build's _headers file), which vite
// preview sends too: so every test runs under the deployed policy, and the
// fixtures' check for Content-Security-Policy violations means something.
test("pages come with the site's security headers", async ({ page }) => {
  const res = await page.goto("/login");
  const headers = res.headers();

  const policy = headers["content-security-policy"];
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(policy).toContain("frame-src https://challenges.cloudflare.com");
  expect(policy).toContain(`connect-src 'self' ${settings.API_URL}`);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

// Long words (a title without spaces, a long address) must wrap rather than make
// the page wider than the screen.
const LONG_TITLE = "Letter".repeat(16);
const LONG_EMAIL = `${"someone".repeat(8)}@example.com`;

async function expectToFit(page, path, heading) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
}

test(
  "every page fits the screen without scrolling sideways",
  { tag: "@phone" },
  async ({ page, request, account, db }) => {
    const session = await logIn(page, account);
    const sealed = await createCapsule(request, session, {
      title: LONG_TITLE,
      unlockDate: new Date(Date.now() + 74 * DAY).toISOString(),
      isPublic: true,
      recipientEmail: LONG_EMAIL,
    });
    const opened = await db.seedCapsule({
      ownerEmail: account.email,
      title: LONG_TITLE,
      message: `${"word".repeat(40)} and a few more words.`,
      unlockDate: new Date(Date.now() - DAY),
      isPublic: true,
      recipientEmail: LONG_EMAIL,
    });

    await expectToFit(page, "/", "Your capsules");
    await expectToFit(page, "/create", "Write a capsule");
    await expectToFit(page, `/capsule/${sealed.slug}`, LONG_TITLE);
    await expectToFit(page, `/capsule/${opened.slug}`, LONG_TITLE);
    await expectToFit(page, `/public/${sealed.slug}`, "A sealed capsule");

    await page.evaluate(() => localStorage.clear());
    await expectToFit(page, "/login", "Log in");
    await expectToFit(page, "/signup", "Create an account");
    await expectToFit(page, "/forgot-password", "Reset your password");
  },
);

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

// The header's links and buttons: how many lines their words take, and where
// each one's middle is (they share one row when their middles line up).
const headerItems = (page) =>
  page.locator("header a:visible, header button:visible").evaluateAll((elements) =>
    elements.map((element) => {
      // Each piece of text has one rectangle per line it's on (none if hidden).
      let lines = 0;
      const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(text);
        const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
        lines = Math.max(lines, new Set(tops).size);
      }
      const box = element.getBoundingClientRect();
      return { text: element.innerText, lines, middle: box.top + box.height / 2 };
    }),
  );

async function expectHeaderOnOneLine(page) {
  const items = await headerItems(page);
  for (const item of items) expect(item.lines, `"${item.text}" breaks across lines`).toBe(1);
  const middles = items.map((item) => item.middle);
  expect(Math.max(...middles) - Math.min(...middles), "all on one row").toBeLessThanOrEqual(3);
}

test("on a small phone, the header stays on one line", async ({ page, account }) => {
  await page.setViewportSize({ width: 360, height: 640 });

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await expectHeaderOnOneLine(page);

  await logIn(page, account);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your capsules" })).toBeVisible();
  await expectHeaderOnOneLine(page);
});

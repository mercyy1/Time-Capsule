import { createCapsule, expect, logIn, test } from "../support/fixtures.js";
import settings from "../support/settings.cjs";

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY);

test("sealed capsules come soonest first, opened ones newest first, and search finds them", async ({
  page,
  request,
  account,
  db,
}) => {
  const session = await logIn(page, account);
  await createCapsule(request, session, { title: "Next summer", unlockDate: inDays(200) });
  await createCapsule(request, session, { title: "Next week", unlockDate: inDays(7) });
  await db.seedCapsule({
    ownerEmail: account.email,
    title: "Last spring",
    unlockDate: inDays(-200),
  });
  await db.seedCapsule({ ownerEmail: account.email, title: "Last week", unlockDate: inDays(-7) });

  await page.goto("/");
  const sealed = page.getByRole("region", { name: "Sealed" }).getByRole("heading", { level: 3 });
  const opened = page.getByRole("region", { name: "Opened" }).getByRole("heading", { level: 3 });
  await expect(sealed).toHaveText(["Next week", "Next summer"]);
  await expect(opened).toHaveText(["Last week", "Last spring"]);

  const search = page.getByLabel("Find a capsule by its title");
  await search.fill("WEEK");
  await expect(sealed).toHaveText(["Next week"]);
  await expect(opened).toHaveText(["Last week"]);
  await search.fill("birthday");
  await expect(page.getByText("No capsule titles match “birthday”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear the search" }).click();
  await expect(search).toHaveValue("");
  await expect(sealed).toHaveCount(2);
});

test("each capsule is one stop for the keyboard, and Enter opens it", async ({
  page,
  request,
  account,
}) => {
  const session = await logIn(page, account);
  const capsule = await createCapsule(request, session, {
    title: "Next week",
    unlockDate: inDays(7),
    isPublic: true,
  });

  await page.goto("/");
  await page.getByLabel("Find a capsule by its title").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Next week" })).toBeFocused();
  // The card's own button comes next.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy link" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/capsule/${capsule.slug}`);
});

test("a dashboard that can't reach the API says so, and can try again", async ({
  page,
  account,
}) => {
  await logIn(page, account);
  const capsules = `${settings.API_URL}/capsules`;
  await page.route(capsules, (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn't load your capsules. Can't reach TimeCapsule. Check your connection and try again.",
  );

  await page.unroute(capsules);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Nothing sealed yet" })).toBeVisible();
});

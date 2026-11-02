import {
  createAccount,
  createCapsule,
  expect,
  logIn,
  newAddress,
  test,
} from "../support/fixtures.js";
import { requireFromServer } from "../support/server.js";
import settings from "../support/settings.cjs";

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

// The datetime-local value ("2027-01-15T09:30") for a time of day `days` from now,
// in the browser's time zone.
const localDateTime = (page, days, hour, minute) =>
  page.evaluate(
    ([days, hour, minute]) => {
      const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      date.setHours(hour, minute, 0, 0);
      const pad = (n) => String(n).padStart(2, "0");
      return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`
      );
    },
    [days, hour, minute],
  );

test("write a capsule and find it sealed", { tag: "@phone" }, async ({ page, account }) => {
  await logIn(page, account);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nothing sealed yet" })).toBeVisible();
  await page.getByRole("link", { name: "Write your first capsule" }).click();

  await page.getByLabel("Title").fill("For the class of 2030");
  await page.getByLabel("Message").fill("Remember the walk along the river.");
  await page.getByLabel("Don't open before").fill(await localDateTime(page, 3, 9, 30));
  await expect(page.getByText(/^It opens .+ at 9:30 AM E[SD]T, in [23] days/)).toBeVisible();
  await page.getByLabel("Email it to someone when it opens").fill("friend@example.com");
  await page.getByLabel("Share it with a link").check();
  await page.getByRole("button", { name: "Seal capsule" }).click();

  // Its own page: sealed, so the message isn't there.
  await expect(page.getByText("Your capsule is sealed.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "For the class of 2030" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/^Opens in [23] days/);
  await expect(page.getByText("Remember the walk")).toHaveCount(0);
  await expect(
    page.getByText("friend@example.com also gets it by email when it opens."),
  ).toBeVisible();
  await expect(page.getByLabel("Share it with a link")).toHaveValue(/\/public\/[0-9a-f-]{36}$/);

  // And on the dashboard.
  await page.getByRole("link", { name: "Back to your capsules" }).click();
  const card = page.getByRole("region", { name: "Sealed" }).getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("For the class of 2030");
  await expect(card).toContainText(/Don't open before .+ 9:30 AM/);
  await expect(card).toContainText("Also emailed to friend@example.com");
});

test("the form says what's missing before sending anything", async ({ page, account }) => {
  await logIn(page, account);
  await page.goto("/create");
  await page.getByRole("button", { name: "Seal capsule" }).click();
  await expect(page.getByLabel("Title")).toHaveAccessibleDescription("Give it a title");
  await expect(page.getByLabel("Message")).toHaveAccessibleDescription("Write a message");
  await expect(page.getByLabel("Don't open before")).toHaveAccessibleDescription(
    /^Choose when it opens/,
  );

  await page.getByLabel("Don't open before").fill(await localDateTime(page, -1, 9, 0));
  await page.getByRole("button", { name: "Seal capsule" }).click();
  await expect(page.getByLabel("Don't open before")).toHaveAccessibleDescription(
    /^Choose a time in the future/,
  );
});

test(
  "the owner can copy a shared capsule's link, and delete it after confirming",
  { tag: "@phone" },
  async ({ page, context, request, account }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const session = await logIn(page, account);
    const capsule = await createCapsule(request, session, {
      title: "For the class of 2030",
      unlockDate: inDays(3),
      isPublic: true,
    });
    const link = `${settings.CLIENT_URL}/public/${capsule.slug}`;
    await page.goto(`/capsule/${capsule.slug}`);

    await expect(page.getByLabel("Share it with a link")).toHaveValue(link);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    // Deleting asks first. The focus starts on "Keep it", and Esc keeps it too.
    const deleteButton = page.getByRole("button", { name: "Delete capsule" });
    await deleteButton.click();
    const dialog = page.getByRole("dialog", { name: "Delete this capsule?" });
    await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    await dialog.getByRole("button", { name: "Delete capsule" }).click();

    await expect(page.getByText("Deleted “For the class of 2030”.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing sealed yet" })).toBeVisible();
  },
);

test("an opened capsule reads as a letter", async ({ page, account, db }) => {
  await db.seedCapsule({
    ownerEmail: account.email,
    title: "Graduation day",
    message: "You made it.\n\nCall Grandma.",
    unlockDate: new Date(Date.now() - DAY),
    createdAt: new Date(Date.now() - 400 * DAY),
  });
  await logIn(page, account);
  await page.goto("/");

  const opened = page.getByRole("region", { name: "Opened" });
  await expect(opened.getByRole("listitem")).toContainText("You made it. Call Grandma.");
  await opened.getByRole("link", { name: "Graduation day" }).click();
  const letter = page.getByRole("article", { name: "Graduation day" });
  // The message keeps its paragraphs.
  await expect(letter.getByText("You made it. Call Grandma.")).toHaveCSS("white-space", "pre-line");
  await expect(letter).toContainText(/^Written /);
  await expect(page.getByText("It isn't shared: only you can open it.")).toBeVisible();
});

test("someone else sees when a shared capsule opens, but not its title, and can't delete it", async ({
  page,
  request,
  account,
}, testInfo) => {
  const owner = await logIn(page, account);
  const shared = await createCapsule(request, owner, {
    title: "Plans for the summer",
    unlockDate: inDays(10),
    isPublic: true,
  });
  const notShared = await createCapsule(request, owner, {
    title: "Just for me",
    unlockDate: inDays(10),
  });

  // Another signed-in user.
  await logIn(page, await createAccount(request, newAddress(testInfo, "stranger")));
  await page.goto(`/capsule/${shared.slug}`);
  await expect(page.getByRole("heading", { name: "A sealed capsule" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/^Opens in (9|10) days/);
  await expect(page.getByText("Plans for the summer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete capsule" })).toHaveCount(0);
  await page.goto(`/capsule/${notShared.slug}`);
  await expect(page.getByRole("heading", { name: "We can't find this capsule" })).toBeVisible();

  // Anyone with the link, signed in or not.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/public/${shared.slug}`);
  await expect(page.getByRole("heading", { name: "A sealed capsule" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Write your own" }).click();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.goto(`/public/${notShared.slug}`);
  await expect(page.getByRole("heading", { name: "We can't find this capsule" })).toBeVisible();
});

test("a capsule opens on its page when the countdown ends", async ({ page, request, account }) => {
  const session = await logIn(page, account);
  const capsule = await createCapsule(request, session, {
    title: "Any second now",
    message: "Hello from a few seconds ago.",
    unlockDate: new Date(Date.now() + 8000).toISOString(),
  });
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes(`/capsules/slug/${capsule.slug}`)) requests += 1;
  });

  await page.goto(`/capsule/${capsule.slug}`);
  await expect(page.getByRole("timer")).toHaveText(/^Opens in \d seconds?$/);
  await expect(page.getByRole("article", { name: "Any second now" })).toContainText(
    "Hello from a few seconds ago.",
    { timeout: 20_000 },
  );
  // Asked for once on arrival and once when the countdown ended: no polling.
  expect(requests).toBe(2);
});

test("an expired session sends you to log in, then back where you were", async ({
  page,
  request,
  account,
}) => {
  const session = await logIn(page, account);
  const capsule = await createCapsule(request, session, {
    title: "Still here",
    unlockDate: inDays(5),
  });
  // A login token that ran out a minute ago.
  const jwt = requireFromServer("jsonwebtoken");
  const expired = jwt.sign(
    {
      id: session.user.id,
      email: session.user.email,
      ver: 0,
      exp: Math.floor(Date.now() / 1000) - 60,
    },
    settings.JWT_SECRET,
    { algorithm: "HS256" },
  );
  await page.evaluate((token) => localStorage.setItem("token", token), expired);

  await page.goto(`/capsule/${capsule.slug}`);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Your session has expired. Please log in again. After that, you'll go back to the page you were on.",
  );
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Still here" })).toBeVisible();
  await expect(page).toHaveURL(`/capsule/${capsule.slug}`);
});

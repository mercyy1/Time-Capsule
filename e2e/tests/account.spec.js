import { expect, logIn, newAddress, test } from "../support/fixtures.js";
import { linkIn, waitForEmail } from "../support/mail.js";
import settings from "../support/settings.cjs";

test(
  "sign up, confirm the address from the email, log in",
  { tag: "@phone" },
  async ({ page }, testInfo) => {
    const email = newAddress(testInfo);

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(settings.PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    // The form is replaced, so the focus moves to the new heading.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();

    await page.goto(linkIn(await waitForEmail(email), "verify-email"));
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    // The link's secret is gone from the address bar once the page has read it.
    expect(new URL(page.url()).hash).toBe("");
    await page.getByRole("main").getByRole("link", { name: "Log in" }).click();

    await expect(page.getByLabel("Email")).toHaveValue(email);
    await page.getByLabel("Password").fill(settings.PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Your capsules" })).toBeVisible();
  },
);

test("the forms say what's wrong next to the field", async ({ page, account }) => {
  // Checked in the browser before anything is sent.
  await page.goto("/signup");
  await page.getByLabel("Email").fill("not an address");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Enter a valid email address");
  await expect(page.getByLabel("Password")).toHaveAccessibleDescription(
    "Use at least 8 characters At least 8 characters.",
  );

  // Answered by the API.
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
});

test("logging in before confirming the address sends a new link", async ({
  page,
  request,
}, testInfo) => {
  const email = newAddress(testInfo);
  await request.post(`${settings.API_URL}/signup`, {
    data: { email, password: settings.PASSWORD },
  });
  await waitForEmail(email);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(settings.PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status")).toContainText("Please confirm your email address first");
  await waitForEmail(email, 2);
});

test("a new password logs you in here and out everywhere else", async ({
  browser,
  page,
  account,
}) => {
  // Another device, logged in before the password changes.
  const elsewhere = await (await browser.newContext()).newPage();
  await logIn(elsewhere, account);
  await elsewhere.goto("/");
  await expect(elsewhere.getByRole("heading", { name: "Your capsules" })).toBeVisible();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // The first email confirmed the address; the second is the reset link.
  await page.goto(linkIn(await waitForEmail(account.email, 2), "reset-password"));
  await page.getByLabel("New password").fill("a brand new password");
  await page.getByLabel("Type it again").fill("a brand new password");
  await page.getByRole("button", { name: "Save and log in" }).click();
  await expect(page.getByRole("heading", { name: "Your capsules" })).toBeVisible();
  await expect(page.getByText("Your new password is saved.")).toBeVisible();

  // The other device's next request is refused, and it's sent to log in again.
  await elsewhere.reload();
  await expect(elsewhere.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(elsewhere.getByRole("status")).toContainText(
    "You've been logged out because your password was changed.",
  );
  await elsewhere.context().close();
});

test("a reset link that doesn't work says what to do", async ({ page }) => {
  await page.goto("/reset-password#token=not-a-real-link");
  await page.getByLabel("New password").fill("a brand new password");
  await page.getByLabel("Type it again").fill("a different password");
  await page.getByRole("button", { name: "Save and log in" }).click();
  await expect(page.getByLabel("Type it again")).toHaveAccessibleDescription(
    "The two passwords don't match",
  );

  await page.getByLabel("Type it again").fill("a brand new password");
  await page.getByRole("button", { name: "Save and log in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This password reset link is invalid or has expired. Ask for a new one.",
  );

  // A link cut short before the secret.
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link is incomplete" })).toBeVisible();
});

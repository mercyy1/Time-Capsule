import { expect, newAddress, test } from "../support/fixtures.js";
import { linkIn, waitForEmail } from "../support/mail.js";

test("sign up, confirm the address from the email, log in", async ({ page }, testInfo) => {
  const email = newAddress(testInfo);

  await page.goto("/signup");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (at least 8 characters)").fill("correct horse battery");
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(linkIn(await waitForEmail(email), "verify-email"));
  await expect(page.getByText("Your email address is confirmed")).toBeVisible();
  await page.getByRole("link", { name: "Log in" }).click();

  await expect(page.getByPlaceholder("Email")).toHaveValue(email);
  await page.getByPlaceholder("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.getByRole("heading", { name: "Your Time Capsules" })).toBeVisible();
  await expect(page.getByText("No capsules found.")).toBeVisible();
});

// The opening time is picked in the browser's time zone and stored as an instant:
// the same capsule opens at the same moment everywhere. These run the form in
// other zones and on the nights clocks change.
import { expect, logIn, test } from "../support/fixtures.js";

const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
// At least two days ahead, so the time picked that day is in the future in
// every time zone.
const ahead = (date) => date.getTime() - 2 * DAY > Date.now();

// The next nth Sunday of a month (1-12), as a UTC midnight: daylight saving
// time starts and ends on such Sundays.
function nextSunday(month, nth) {
  for (let year = new Date().getUTCFullYear(); ; year += 1) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const day = 1 + ((7 - first.getUTCDay()) % 7) + (nth - 1) * 7;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (ahead(date)) return date;
  }
}

// The next `month`/`day`, as a UTC midnight.
function nextDate(month, day) {
  for (let year = new Date().getUTCFullYear(); ; year += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (ahead(date)) return date;
  }
}

const dayBefore = (date) => new Date(date.getTime() - DAY);

// Fills in the form with `value` as the opening time, checks what it says about
// it, seals it, and returns the unlockDate sent to the API.
async function seal(page, value, says) {
  await page.goto("/create");
  await page.getByLabel("Title").fill(`Opens at ${value}`);
  await page.getByLabel("Message").fill("Hello from the past.");
  await page.getByLabel("Don't open before").fill(value);
  for (const text of says) await expect(page.getByText(text)).toBeVisible();

  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/capsules"),
  );
  await page.getByRole("button", { name: "Seal capsule" }).click();
  const { unlockDate } = (await sent).postDataJSON();
  await expect(page.getByText("Your capsule is sealed.")).toBeVisible();
  return unlockDate;
}

test.describe("in India (UTC+5:30, no daylight saving)", () => {
  test.use({ timezoneId: "Asia/Kolkata" });

  test("10:00 there is 04:30 UTC", async ({ page, account }) => {
    await logIn(page, account);
    const day = ymd(nextDate(3, 14));
    const sent = await seal(page, `${day}T10:00`, [/Your time zone: .*\(Kolkata\)\./]);
    expect(sent).toBe(`${day}T04:30:00.000Z`);
    await expect(page.locator("time")).toHaveText(/ at 10:00 AM GMT\+5:30$/);
  });
});

test.describe("in Toronto", () => {
  test.use({ timezoneId: "America/Toronto" });

  test("a time the clocks skip opens an hour later, and the form says so", async ({
    page,
    account,
  }) => {
    await logIn(page, account);
    // Clocks go from 2:00 to 3:00 AM on the second Sunday of March.
    const day = ymd(nextSunday(3, 2));
    const sent = await seal(page, `${day}T02:30`, [
      "The clocks go forward that night, so 2:30 AM doesn't happen. It opens at 3:30 AM EDT instead.",
    ]);
    expect(sent).toBe(`${day}T07:30:00.000Z`);
    await expect(page.locator("time")).toHaveText(/ at 3:30 AM EDT$/);
  });

  test("a time that happens twice opens the first time, and the form says so", async ({
    page,
    account,
  }) => {
    await logIn(page, account);
    // Clocks go from 2:00 back to 1:00 AM on the first Sunday of November.
    const day = ymd(nextSunday(11, 1));
    const sent = await seal(page, `${day}T01:30`, [
      "The clocks go back that night, so 1:30 AM happens twice. It opens the first time, at 1:30 AM EDT.",
    ]);
    expect(sent).toBe(`${day}T05:30:00.000Z`);
    await expect(page.locator("time")).toHaveText(/ at 1:30 AM EDT$/);
  });
});

test.describe("in Sydney (southern hemisphere)", () => {
  test.use({ timezoneId: "Australia/Sydney" });

  test("a time the clocks skip opens an hour later", async ({ page, account }) => {
    await logIn(page, account);
    // Clocks go from 2:00 to 3:00 AM on the first Sunday of October; 3:30 AM
    // there (UTC+11) is 4:30 PM the day before in UTC.
    const sunday = nextSunday(10, 1);
    const sent = await seal(page, `${ymd(sunday)}T02:30`, [
      /^The clocks go forward that night, so 2:30 AM doesn't happen\./,
    ]);
    expect(sent).toBe(`${ymd(dayBefore(sunday))}T16:30:00.000Z`);
    await expect(page.locator("time")).toHaveText(/ at 3:30 AM GMT\+11$/);
  });
});

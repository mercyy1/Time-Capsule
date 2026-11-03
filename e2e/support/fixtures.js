// What the tests share: `test` with an account and database helpers, and
// functions that sign up and log in through the API (faster than the forms, which
// tests/account.spec.js covers).
import { test as base, expect } from "@playwright/test";
import settings from "./settings.cjs";
import { linkIn, tokenIn, waitForEmail } from "./mail.js";
import { requireFromServer } from "./server.js";
import { useFakeTurnstile } from "./turnstile.js";

export { expect };

let made = 0;

// A new email address, unique across the run's tests and workers.
export function newAddress(testInfo, name = "user") {
  made += 1;
  return `${name}-${testInfo.workerIndex}-${Date.now()}-${made}@example.com`;
}

// Signs up through the API the way a person does: signs up, then opens the link
// in the confirmation email. Returns { email, password }.
export async function createAccount(request, email, password = settings.PASSWORD) {
  const signUp = await request.post(`${settings.API_URL}/signup`, {
    data: { email, password, captchaToken: settings.TURNSTILE_TOKEN },
  });
  expect(signUp.status()).toBe(202);
  const token = tokenIn(linkIn(await waitForEmail(email), "verify-email"));
  const confirm = await request.post(`${settings.API_URL}/verify-email`, { data: { token } });
  expect(confirm.status()).toBe(200);
  return { email, password };
}

// Logs the page in as `account` the way the login form does: the API's token and
// user go in the client's localStorage. Returns them.
export async function logIn(page, account) {
  const res = await page.request.post(`${settings.API_URL}/login`, {
    data: { email: account.email, password: account.password },
  });
  expect(res.status()).toBe(200);
  const { token, user } = await res.json();
  // localStorage belongs to the client's origin, so be on one of its pages.
  await page.goto("/login");
  await page.evaluate(
    ([token, user]) => {
      localStorage.setItem("token", token);
      localStorage.setItem("user", user);
    },
    [token, JSON.stringify(user)],
  );
  return { token, user };
}

// Creates a capsule through the API as `session` (from logIn). Returns the API's answer.
export async function createCapsule(request, session, capsule) {
  const res = await request.post(`${settings.API_URL}/capsules`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { message: "A message for later.", isPublic: false, ...capsule },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

export const test = base.extend({
  // Every test's pages: Cloudflare's security check replaced by the fake
  // (turnstile.js), and the test fails if a page broke the site's
  // Content-Security-Policy (vite preview sends the deployed one).
  context: async ({ context }, use) => {
    await useFakeTurnstile(context);
    const violations = [];
    context.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Content Security Policy")) {
        violations.push(message.text());
      }
    });
    await use(context);
    expect(violations, "Content-Security-Policy violations").toEqual([]);
  },

  // A confirmed account, new for each test.
  account: async ({ request }, use, testInfo) => {
    await use(await createAccount(request, newAddress(testInfo)));
  },

  // The end-to-end database, for what the API can't do: capsules whose unlock
  // date has passed (the API only accepts future ones).
  db: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern
    async ({}, use) => {
      const { PrismaClient } = requireFromServer("@prisma/client");
      const prisma = new PrismaClient({ datasources: { db: { url: settings.DATABASE_URL } } });
      await use({
        prisma,
        async seedCapsule({ ownerEmail, ...capsule }) {
          const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
          return prisma.capsule.create({
            data: { message: "A message for later.", ...capsule, ownerId: owner.id },
          });
        },
      });
      await prisma.$disconnect();
    },
    { scope: "worker" },
  ],
});

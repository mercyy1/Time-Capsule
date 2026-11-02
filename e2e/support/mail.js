// The emails the test API "sent" (see api-server.cjs), and the links in them.
import fs from "node:fs";
import { expect } from "@playwright/test";
import settings from "./settings.cjs";

function readOutbox() {
  let text;
  try {
    text = fs.readFileSync(settings.OUTBOX, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const emails = [];
  for (const line of text.split("\n")) {
    // A line the API is still writing is read again on the next try.
    try {
      if (line) emails.push(JSON.parse(line));
    } catch {
      break;
    }
  }
  return emails;
}

// The emails sent to `address` so far, oldest first.
export const emailsTo = (address) => readOutbox().filter((email) => email.to === address);

// Waits for the `number`th email to `address` (the API sends emails just after it
// answers) and returns it.
export async function waitForEmail(address, number = 1) {
  await expect
    .poll(() => emailsTo(address).length, { message: `email #${number} to ${address}` })
    .toBeGreaterThanOrEqual(number);
  return emailsTo(address)[number - 1];
}

// The link to one of the client's pages (such as "verify-email") in an email.
export function linkIn(email, page) {
  const link = email.text
    .split(/\s+/)
    .find((word) => word.startsWith(`${settings.CLIENT_URL}/${page}`));
  if (!link) throw new Error(`No /${page} link in the email "${email.subject}"`);
  return link;
}

// The secret in an emailed link (/verify-email#token=...).
export const tokenIn = (link) => new URLSearchParams(new URL(link).hash.slice(1)).get("token");

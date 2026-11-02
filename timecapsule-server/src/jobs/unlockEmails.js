// The unlock-email job: when a capsule opens, it emails the owner, and the
// recipient the owner chose, if any. A scheduler runs it every 30 minutes by
// calling POST /jobs/unlock-emails (routes/jobs.js); `npm run job:unlock-emails`
// runs it once by hand (jobs/cli.js).
//
// Runs can overlap, crash halfway or stop at a limit, and each email still goes
// out once:
//   - A run claims a few capsules at a time by setting their notifyLockedUntil,
//     a lease: other runs leave them alone until it ends. The claim uses
//     FOR UPDATE SKIP LOCKED, so two runs claiming at the same moment get
//     different capsules. A run that crashes leaves its leases to run out, and a
//     later run picks those capsules up.
//   - An email recorded as sent (EmailLog) isn't sent again, and every email
//     goes to the provider with an idempotency key made from the capsule and the
//     kind of email: if a run sent one and crashed before recording it, the
//     provider recognizes the next run's attempt (for 24 hours) and doesn't send
//     it twice.
//   - A capsule is marked notified once all its emails are sent, or once the
//     provider has refused one of them 3 times (a run tries a capsule once).
// Emails count toward the sender's limits (../email/sender.js). When the day's
// emails are used up, or the provider is failing, the run stops and the
// capsules wait for a later run. When one owner's daily share is used up, that
// owner's capsules wait for the next day, and other owners' carry on.
const { Prisma } = require("@prisma/client");
const { prisma } = require("../db");
const templates = require("../email/templates");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const DEFAULTS = Object.freeze({
  // Capsules claimed at a time.
  batchSize: 10,
  // The scheduler waits 30 seconds for an answer. After 15 the run starts
  // nothing new, which leaves time for an email in progress (8 seconds at most,
  // see mailers.js) and the answer.
  timeBudgetMs: 15_000,
  // Far longer than a run takes, so a lease only runs out when its run is gone.
  leaseMs: 5 * MINUTE_MS,
  // Refusals before giving up on a capsule's emails.
  maxAttempts: 3,
  // EmailLog rows older than this are deleted (the limits only need a day).
  keepEmailLogsMs: 30 * DAY_MS,
});

// Dates are stored in UTC, as timestamps without a time zone, while Prisma sends
// a Date in a raw query as a timestamp with one: comparing the two would go
// through the database session's time zone. Converting the Date to UTC first
// makes the comparison right whatever that setting is.
const utc = (date) => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;

// Claims up to `limit` capsules that have opened and still need their emails,
// oldest unlock date first, until `leaseUntil`. Leaves out the capsules of
// owners in `skipOwners`, the capsules in `skipCapsules`, those another run
// holds, and those whose owner hasn't confirmed their address (they wait until
// it is). Returns each capsule with its owner's address (ownerEmail).
async function claimCapsules({ now, leaseUntil, limit, skipOwners, skipCapsules }) {
  const capsules = await prisma.$queryRaw`
    WITH due AS (
      SELECT c.id
      FROM "Capsule" c
      JOIN "User" u ON u.id = c."ownerId"
      WHERE NOT c.notified
        AND c."unlockDate" <= ${utc(now)}
        AND (c."notifyLockedUntil" IS NULL OR c."notifyLockedUntil" <= ${utc(now)})
        AND u."emailVerifiedAt" IS NOT NULL
        AND NOT (c."ownerId" = ANY(${skipOwners}))
        AND NOT (c.id = ANY(${skipCapsules}))
      ORDER BY c."unlockDate", c.id
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE "Capsule" c
    SET "notifyLockedUntil" = ${utc(leaseUntil)}
    FROM due, "User" u
    WHERE c.id = due.id AND u.id = c."ownerId"
    RETURNING c.id, c.title, c.message, c.slug, c."isPublic", c."recipientEmail",
      c."createdAt", c."unlockDate", c."ownerId", c."notifyAttempts", u.email AS "ownerEmail"`;
  // UPDATE ... RETURNING doesn't keep the order.
  return capsules.sort((a, b) => a.unlockDate - b.unlockDate || a.id - b.id);
}

// The emails a capsule sends when it opens, in order: one to its owner, and one
// to the recipient they chose. A recipient who is the owner gets one email, the
// owner's, with the message in it.
function emailsFor(capsule, appUrl) {
  const toOwner = capsule.recipientEmail?.toLowerCase() === capsule.ownerEmail.toLowerCase();
  const recipient = toOwner ? null : capsule.recipientEmail;
  const emails = [
    {
      kind: "CAPSULE_OPENED",
      to: capsule.ownerEmail,
      content: templates.capsuleOpened({
        capsule,
        appUrl,
        recipientEmail: recipient,
        includeMessage: toOwner,
      }),
    },
  ];
  if (recipient) {
    emails.push({
      kind: "CAPSULE_DELIVERED",
      to: recipient,
      content: templates.capsuleDelivered({ capsule, ownerEmail: capsule.ownerEmail, appUrl }),
    });
  }
  return emails;
}

// Deletes what's no longer needed: old EmailLog rows, and emailed links that
// have expired.
async function cleanUp(now, keepEmailLogsMs) {
  const [emailLogs, authTokens] = await Promise.all([
    prisma.emailLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - keepEmailLogsMs) } },
    }),
    prisma.authToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { emailLogs: emailLogs.count, authTokens: authTokens.count };
}

// One run. `sender` sends within the email limits and gives the time (its
// now()); `appUrl` is the web client's address, for links. Returns a summary:
//   capsulesNotified  capsules whose emails are all sent
//   capsulesGivenUp   capsules given up on after 3 refusals
//   emailsSent, emailsFailed
//   stoppedBy         null when every capsule due was handled, or why the run
//                     stopped early: "time-limit", "daily-limit" (the day's
//                     emails are used up), "provider-quota" (the provider's
//                     quota is), "provider-unavailable" (it failed or couldn't be
//                     reached) or "provider-config" (it refused our API key or
//                     sender: a person must fix the settings)
//   cleanedUp         { emailLogs, authTokens }: rows deleted
async function sendUnlockEmails({ sender, appUrl, ...options }) {
  const { batchSize, timeBudgetMs, leaseMs, maxAttempts, keepEmailLogsMs } = {
    ...DEFAULTS,
    ...options,
  };
  const startedAt = performance.now();
  const outOfTime = () => performance.now() - startedAt >= timeBudgetMs;
  const summary = {
    capsulesNotified: 0,
    capsulesGivenUp: 0,
    emailsSent: 0,
    emailsFailed: 0,
    stoppedBy: null,
  };
  // Owners whose share of today's emails is used up, and capsules this run has
  // tried: the run claims neither again.
  const skipOwners = new Set();
  const tried = new Set();

  // Sends the capsule's emails that haven't gone out yet. Returns what stopped
  // it, if anything: { limitedBy } (see sender.reserve) or { error } (a
  // MailerError).
  async function sendEmails(capsule) {
    const sent = await prisma.emailLog.findMany({
      where: { capsuleId: capsule.id, status: "SENT" },
      select: { kind: true },
    });
    const done = new Set(sent.map((email) => email.kind));
    for (const email of emailsFor(capsule, appUrl)) {
      if (done.has(email.kind)) continue;
      const { slot, limitedBy } = await sender.reserve({
        kind: email.kind,
        address: email.to,
        userId: capsule.ownerId,
        capsuleId: capsule.id,
      });
      if (!slot) return { limitedBy };
      const result = await sender.deliver(slot, email.content, {
        idempotencyKey: `capsule-${capsule.id}-${email.kind}`,
      });
      if (!result.sent) {
        summary.emailsFailed += 1;
        return { error: result.error };
      }
      summary.emailsSent += 1;
    }
    return {};
  }

  while (!summary.stoppedBy) {
    if (outOfTime()) {
      summary.stoppedBy = "time-limit";
      break;
    }
    const now = sender.now();
    const claimed = await claimCapsules({
      now,
      leaseUntil: new Date(now.getTime() + leaseMs),
      limit: batchSize,
      skipOwners: [...skipOwners],
      skipCapsules: [...tried],
    });
    if (claimed.length === 0) break;

    // The claimed capsules this run still holds. Whatever is left when the batch
    // ends (the run stopped, or failed) goes back for a later run.
    const held = new Set(claimed.map((capsule) => capsule.id));
    const finish = async (capsule, data = {}) => {
      held.delete(capsule.id);
      await prisma.capsule.updateMany({
        where: { id: capsule.id },
        data: { ...data, notifyLockedUntil: null },
      });
    };

    try {
      for (const capsule of claimed) {
        if (outOfTime()) {
          summary.stoppedBy = "time-limit";
          break;
        }
        if (skipOwners.has(capsule.ownerId)) continue;
        tried.add(capsule.id);

        const { limitedBy, error } = await sendEmails(capsule);
        if (!limitedBy && !error) {
          await finish(capsule, { notified: true });
          summary.capsulesNotified += 1;
        } else if (limitedBy === "perOwner") {
          skipOwners.add(capsule.ownerId);
        } else if (limitedBy) {
          summary.stoppedBy = "daily-limit";
          break;
        } else if (error.kind === "rejected") {
          // This email was refused (its address, say): other capsules carry on.
          const giveUp = capsule.notifyAttempts + 1 >= maxAttempts;
          await finish(capsule, { notifyAttempts: { increment: 1 }, notified: giveUp });
          if (giveUp) summary.capsulesGivenUp += 1;
        } else {
          // The provider's quota, an outage or our settings: every email would
          // fail the same way, so the run stops.
          summary.stoppedBy = `provider-${error.kind}`;
          break;
        }
      }
    } finally {
      if (held.size > 0) {
        await prisma.capsule.updateMany({
          where: { id: { in: [...held] } },
          data: { notifyLockedUntil: null },
        });
      }
    }
  }

  summary.cleanedUp = await cleanUp(sender.now(), keepEmailLogsMs);
  return summary;
}

module.exports = { sendUnlockEmails, DEFAULTS };

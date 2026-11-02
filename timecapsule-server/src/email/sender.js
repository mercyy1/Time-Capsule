// Sends emails within the day's limits, and logs every one in EmailLog.
//
// The email provider's free plan allows 100 emails a day, counted in UTC, and
// once they're gone nothing goes out until midnight UTC: no confirmation links,
// no capsules that opened. So the server rations them, by counting the emails
// it logged (limits come from emailLimits() below):
//   daily              everything, per UTC day (EMAIL_DAILY_LIMIT)
//   account            confirmation links, "you already have an account" notices
//                      and password resets: half of the day at most, so a flood
//                      of signups can't use up what opened capsules need
//   unlock             emails about opened capsules: 90% of the day at most, so
//                      people can still sign up on a day many capsules open
//   perOwner           one owner's capsule emails per day: a quarter of the day
//   perAddressPerHour  account emails to one address: 3 an hour, so nobody can
//                      flood someone's inbox by asking for links
//
// Sending takes two steps. reserve() writes the email's EmailLog row, if every
// limit allows it, before anything is sent: the row is what holds its place in
// the count. deliver() hands the email to the mailer and records what happened.
// An email the provider refused stops counting; one whose outcome is unknown (a
// timeout) keeps counting, since it may have gone out.
const { prisma } = require("../db");
const { MailerError } = require("./mailers");

const ACCOUNT_KINDS = ["VERIFY_EMAIL", "ACCOUNT_EXISTS", "RESET_PASSWORD"];
const UNLOCK_KINDS = ["CAPSULE_OPENED", "CAPSULE_DELIVERED"];
const COUNTED = { not: "FAILED" };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// An advisory lock is a lock PostgreSQL keeps by number for whoever asks; this
// one lasts until the end of the transaction. Any number works as long as
// nothing else uses it.
const RESERVATION_LOCK = 7_041_967;

// The limits for a provider that allows `daily` emails a day (at least 10).
function emailLimits(daily) {
  return Object.freeze({
    daily,
    account: Math.floor(daily / 2),
    unlock: daily - Math.ceil(daily / 10),
    perOwner: Math.floor(daily / 4),
    perAddressPerHour: 3,
  });
}

const startOfUtcDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

// Seconds until the provider's quota resets (midnight UTC), for Retry-After.
const secondsUntilNextUtcDay = (date) =>
  Math.ceil((startOfUtcDay(date).getTime() + DAY_MS - date.getTime()) / 1000);

// `now` returns the current time; tests pass their own clock.
function createSender({ mailer, limits, now = () => new Date() }) {
  // Reserves a place for one email, or says which limit stops it:
  //   { slot }       its EmailLog row, to pass to deliver()
  //   { limitedBy }  "daily", "account", "unlock", "perAddress" or "perOwner"
  // For capsule emails, userId is the capsule's owner, whoever the email goes to.
  async function reserve({ kind, address, userId = null, capsuleId = null }) {
    const isAccountEmail = ACCOUNT_KINDS.includes(kind);
    if (!isAccountEmail && !UNLOCK_KINDS.includes(kind)) throw new Error(`Unknown email: ${kind}`);

    return prisma.$transaction(async (tx) => {
      // One reservation at a time: two at the same moment could otherwise both
      // count one place left, and both take it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESERVATION_LOCK})`;

      const time = now();
      const today = { status: COUNTED, createdAt: { gte: startOfUtcDay(time) } };
      const countToday = (where) => tx.emailLog.count({ where: { ...today, ...where } });

      if ((await countToday({})) >= limits.daily) return { limitedBy: "daily" };
      if (isAccountEmail) {
        const account = await countToday({ kind: { in: ACCOUNT_KINDS } });
        if (account >= limits.account) return { limitedBy: "account" };
        const toAddressLastHour = await tx.emailLog.count({
          where: {
            status: COUNTED,
            kind: { in: ACCOUNT_KINDS },
            address,
            createdAt: { gt: new Date(time.getTime() - HOUR_MS) },
          },
        });
        if (toAddressLastHour >= limits.perAddressPerHour) return { limitedBy: "perAddress" };
      } else {
        const unlock = await countToday({ kind: { in: UNLOCK_KINDS } });
        if (unlock >= limits.unlock) return { limitedBy: "unlock" };
        const owners = await countToday({ kind: { in: UNLOCK_KINDS }, userId });
        if (owners >= limits.perOwner) return { limitedBy: "perOwner" };
      }

      // createdAt from the same clock as the counts (not the database's).
      const slot = await tx.emailLog.create({
        data: { kind, address, userId, capsuleId, createdAt: time },
      });
      return { slot };
    });
  }

  // Sends a reserved email ({ subject, text, replyTo }) and records the result.
  // Returns { sent: true }, or { sent: false, error } with the MailerError (see
  // mailers.js for what each kind of failure means). Same idempotencyKey, same
  // email: the provider sends it once (see mailers.js).
  async function deliver(slot, email, { idempotencyKey } = {}) {
    try {
      const { id } = await mailer.send({
        to: slot.address,
        subject: email.subject,
        text: email.text,
        replyTo: email.replyTo,
        idempotencyKey,
      });
      await prisma.emailLog.update({
        where: { id: slot.id },
        data: { status: "SENT", providerId: id },
      });
      return { sent: true };
    } catch (err) {
      if (!(err instanceof MailerError)) throw err;
      await prisma.emailLog.update({
        where: { id: slot.id },
        data: {
          // Unknown: it may have gone out, so it keeps its place in the count.
          status: err.outcomeUnknown ? "SENDING" : "FAILED",
          error: err.message.slice(0, 500),
        },
      });
      return { sent: false, error: err };
    }
  }

  // Whether today's limits still allow an account email (the per-address limit
  // aside). Routes that send one check this first, to answer "try tomorrow"
  // instead of promising an email that can't be sent.
  async function canSendAccountEmail() {
    const today = { status: COUNTED, createdAt: { gte: startOfUtcDay(now()) } };
    const [all, account] = await Promise.all([
      prisma.emailLog.count({ where: today }),
      prisma.emailLog.count({ where: { ...today, kind: { in: ACCOUNT_KINDS } } }),
    ]);
    return all < limits.daily && account < limits.account;
  }

  return { limits, now, reserve, deliver, canSendAccountEmail };
}

module.exports = { createSender, emailLimits, startOfUtcDay, secondsUntilNextUtcDay };

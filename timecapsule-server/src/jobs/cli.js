// Runs the unlock-email job once and prints its summary:
//   npm run job:unlock-emails
// For running it by hand, locally for example (where emails are printed instead
// of sent). In production the scheduler calls POST /jobs/unlock-emails instead.
require("dotenv").config();

const { getEnv, EnvError } = require("../config/env");

async function main() {
  const env = getEnv();
  // Loaded once the settings are known to be valid.
  const { prisma } = require("../db");
  const { createMailer } = require("../email/mailers");
  const { createSender, emailLimits } = require("../email/sender");
  const { sendUnlockEmails } = require("./unlockEmails");

  const sender = createSender({
    mailer: createMailer(env),
    limits: emailLimits(env.EMAIL_DAILY_LIMIT),
  });
  try {
    const summary = await sendUnlockEmails({ sender, appUrl: env.APP_URL });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.stoppedBy === "provider-config") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof EnvError ? err.message : err);
  process.exitCode = 1;
});

const { createHash, timingSafeEqual } = require("node:crypto");
const express = require("express");
const { HttpError } = require("../errors");

const digest = (value) => createHash("sha256").update(value).digest();

// What the scheduler calls, mounted at /jobs when JOB_SECRET is set. It proves
// it may with "Authorization: Bearer <JOB_SECRET>". `runUnlockEmails` runs the
// unlock-email job (../jobs/unlockEmails.js) and returns its summary.
function createJobsRouter({ jobSecret, runUnlockEmails }) {
  const router = express.Router();
  const expected = digest(jobSecret);

  // Compares SHA-256 digests (always 32 bytes) with timingSafeEqual, which takes
  // the same time however much of a guess is right, so response times can't be
  // used to find the secret a character at a time.
  const authorized = (req) => {
    const match = /^Bearer (\S+)$/i.exec(req.get("Authorization") ?? "");
    return match !== null && timingSafeEqual(digest(match[1]), expected);
  };

  router.post("/unlock-emails", async (req, res) => {
    if (!authorized(req)) {
      throw new HttpError(401, "INVALID_TOKEN", "Invalid job secret", {
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }

    const summary = await runUnlockEmails();
    // Only a person can fix this (the API key or the sender address), so the
    // scheduler should see the run fail and say so. Every other early stop is
    // picked up by a later run.
    if (summary.stoppedBy === "provider-config") {
      throw new HttpError(
        502,
        "EMAIL_PROVIDER_ERROR",
        "The email provider refused the server's settings. Check RESEND_API_KEY and EMAIL_FROM.",
      );
    }
    res.json(summary);
  });

  return router;
}

module.exports = { createJobsRouter };

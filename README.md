# ⏳ TimeCapsule

**Write a message now, and it stays locked until the date you choose.** Send it to your future self, schedule a birthday surprise, or keep a journal entry you can't reread for a year.

## What it does

- **Create a capsule:** a title, a message, and a future unlock date
- **Locking enforced on the server:** until the unlock date, the API returns a capsule's title and date (to its owner) but never its message, so the lock can't be bypassed from the browser
- **Private or shareable:** private capsules are visible only to their owner; public ones get a random share link (`slug`) that anyone can open once the capsule unlocks
- **Emailed when it opens:** the owner gets an email with a link to the capsule, and a recipient the owner named gets the message itself
- **Accounts:** sign up with an email address you confirm through an emailed link, log in with a password hashed by bcrypt, stay signed in with a JWT (a signed token the client sends with each request), and reset a forgotten password by email

## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL + Prisma ORM |
| Auth | bcrypt password hashing + JWT bearer tokens |
| Email | [Resend](https://resend.com)'s HTTP API; printed in the server's log when no API key is set |
| Scheduler | [cron-job.org](https://cron-job.org) calls the unlock-email job every 30 minutes |
| Frontend | React 19 + Vite + Tailwind CSS (`timecapsule-client/`) |

## API

| Method | Route | Auth | What it does | Success |
| --- | --- | --- | --- | --- |
| `POST` | `/signup` | — | Sign up (`email`, `password`): emails a link to confirm the address; returns `{ message }` | 202 |
| `POST` | `/verify-email` | — | Confirm an address with the link's `token`; returns `{ message, email }` | 200 |
| `POST` | `/login` | — | Log in, once the address is confirmed; returns `{ token, user }` | 200 |
| `POST` | `/forgot-password` | — | Email a link to choose a new password (`email`); returns `{ message }` | 202 |
| `POST` | `/reset-password` | — | Set a new password with the link's `token` (`token`, `password`); returns `{ token, user }` | 200 |
| `GET` | `/capsules` | ✔ | Your capsules, soonest unlock first; `message` is `null` until each one unlocks | 200 |
| `POST` | `/capsules` | ✔ | Create a capsule (`title`, `message`, `unlockDate`, `isPublic`, optional `recipientEmail`) | 201 |
| `GET` | `/capsules/slug/:slug` | ✔ | Open a capsule you own, or anyone's public one | 200 |
| `DELETE` | `/capsules/:id` | ✔ | Delete a capsule you own | 200 |
| `GET` | `/capsules/public/:slug` | — | Open a public capsule by its share link | 200 |
| `POST` | `/jobs/unlock-emails` | job secret | Run the unlock-email job (see below); only exists when `JOB_SECRET` is set | 200 |

For authenticated routes, send `Authorization: Bearer <token>`. A token lasts one day, and stops working early when
the account's password is reset. The job route takes `Authorization: Bearer <JOB_SECRET>` instead.

**Accounts and emailed links.** Signing up and "forgot password" answer the same way whether or not the address has
an account (so neither reveals who has one); the emails tell the difference. A confirmation link works for 24 hours, a
password reset link once, for 1 hour, and the links carry their secret after `#` (`/verify-email#token=...`), which
browsers never send to servers. Only a hash of each secret is stored. Logging in with the right password before
confirming answers 403 and emails a new link. Resetting the password logs out every session and also confirms the
address.

**Emails when a capsule opens.** `POST /jobs/unlock-emails` (called every 30 minutes by the scheduler, or
`npm run job:unlock-emails` by hand) emails each capsule whose date has passed: its owner gets a link to read it, and
the `recipientEmail`, if any, gets the title and message, with replies going to the owner. It sends each email once,
even if runs overlap or crash, and answers a summary:
`{ capsulesNotified, capsulesGivenUp, emailsSent, emailsFailed, stoppedBy, cleanedUp }`. `stoppedBy` is `null`, or why
the run stopped early: `time-limit`, `daily-limit`, `provider-quota`, `provider-unavailable` or `provider-config` (the
last answers 502 instead, since only a person can fix it); the next run carries on.

**Email limits.** The email provider's free plan sends 100 emails a day (`EMAIL_DAILY_LIMIT`), so the server rations
them: account emails (links, notices) take at most half of a day, capsule emails at most 90%, one owner's capsule
emails at most a quarter, and one address gets at most 3 account emails an hour. When the day's account emails are
used up, signups and password reset requests answer 503 until midnight UTC; capsule emails wait for the next run.

**Locked capsules.** Until its unlock date, a capsule answers `{ "status": "locked", "unlocksAt": "..." }`, and its
owner also gets `capsule: { id, title, unlockDate }`. The message is never sent before the unlock date, not even to
the owner. After it: `{ "status": "unlocked", "capsule": { ... } }`.

**Input rules.** Email: a valid address of at most 254 characters (case and surrounding spaces don't matter).
Password: at least 8 characters and at most 72 bytes. Title: up to 200 characters; message: up to 10,000.
`unlockDate`: ISO 8601 with a time zone (like `2030-01-01T09:00:00Z`), in the future, at most 50 years ahead.
`isPublic`: `true` or `false`. `recipientEmail`: an email address like the account's, or empty/`null` for nobody;
only the owner ever sees it. Request bodies: at most 64 kB.

**Errors** all have one shape: `error` is a sentence for people, `code` is for programs, and `details` (validation
errors only) lists every problem.

```json
{
  "error": "Unlock date must be in the future",
  "code": "VALIDATION_FAILED",
  "details": [{ "field": "unlockDate", "message": "Unlock date must be in the future" }]
}
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `INVALID_JSON`, `BAD_REQUEST` | Missing or invalid fields; a body that isn't valid JSON |
| 400 | `INVALID_LINK` | A confirmation or password reset link that is unknown, expired or already used |
| 401 | `AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `INVALID_CREDENTIALS` | No (or a malformed) `Authorization` header; a bad or expired token, or one made before the password was reset; a wrong email or password; a wrong job secret |
| 403 | `EMAIL_NOT_VERIFIED` | Logging in before confirming the address (a new link is emailed) |
| 403 | `FORBIDDEN` | Deleting someone else's public capsule |
| 404 | `NOT_FOUND` | No such route, or no capsule you may see: someone else's private capsule looks exactly like a missing one |
| 413 | `PAYLOAD_TOO_LARGE` | A request body over 64 kB |
| 429 | `RATE_LIMITED` | Too many requests; the `Retry-After` header says how many seconds to wait |
| 500 | `INTERNAL_ERROR` | A bug or an outage; the cause goes to the server log, never into the response |
| 502 | `EMAIL_PROVIDER_ERROR` | The unlock-email job: the email provider refused the server's API key or sender address |
| 503 | `EMAIL_LIMIT_REACHED` | Signing up or resetting a password once the day's account emails are used up; `Retry-After` says when they reset |

**Rate limits**, per IP address: 1,000 requests per 5 minutes in total, 30 account requests (signing up, confirming an
address, logging in, resetting a password) per 15 minutes, and 10 failed logins per 15 minutes. Every response carries
`RateLimit` and `RateLimit-Policy` headers.

## Running it locally

**You'll need:** Node.js 24 LTS and Docker (for the PostgreSQL database).

```bash
git clone https://github.com/mercyy1/Time-Capsule.git
cd Time-Capsule
docker compose up -d          # PostgreSQL on 127.0.0.1:5432 (dev and test databases)

cd timecapsule-server
npm ci                        # also generates the Prisma client
cp .env.example .env          # then set JWT_SECRET (the file says how to generate one)
npm run db:deploy             # creates the tables
npm run dev                   # API on http://localhost:5000

# in a second terminal, from the repository root
cd timecapsule-client
npm ci
cp .env.example .env          # VITE_API_URL=http://localhost:5000
npm run dev                   # app on http://localhost:3000
```

Locally, emails aren't sent: the server prints each one, links included, in its terminal (set `RESEND_API_KEY` and
`EMAIL_FROM` to send real ones). To send the emails of capsules that have opened, run `npm run job:unlock-emails` in
`timecapsule-server`.

## Configuration

The server reads these environment variables (locally from `timecapsule-server/.env`; `.env.example` explains each
one). It checks them at startup and exits with a list of anything missing or invalid.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | At least 32 random characters; signs login tokens |
| `CLIENT_ORIGIN` | in production | The web client's origin, or several separated by commas, allowed by CORS (default `http://localhost:3000`) |
| `APP_URL` | in production | The web client's address, for the links in emails (default `http://localhost:3000`) |
| `EMAIL_FROM` | in production | Who emails come from, like `TimeCapsule <capsules@example.com>`; its domain must be verified in Resend |
| `RESEND_API_KEY` | in production | Sends emails through Resend; without it, emails are printed in the server's log |
| `JOB_SECRET` | in production | At least 32 random characters; the scheduler sends it to run the unlock-email job (without it, the route doesn't exist) |
| `EMAIL_DAILY_LIMIT` | no (default 100) | How many emails the provider allows per day (UTC); the server's limits are shares of it |
| `TRUST_PROXY` | no (default 0) | How many proxies in front of the server add the caller's address to `X-Forwarded-For`; rate limits need the real address |
| `PORT` | no (default 5000) | Port the API listens on |
| `NODE_ENV` | no (default `development`) | `development`, `test` or `production` |
| `TEST_DATABASE_URL` | no | The database `npm test` uses; its name must end in `_test` |

The client needs `VITE_API_URL`, the API's address, in `timecapsule-client/.env`.

## Tests and code style

```bash
cd timecapsule-server
npm test                      # integration tests against the timecapsule_test database
npm run lint                  # ESLint (also in timecapsule-client)
npm run format                # Prettier (also in timecapsule-client)
```

The tests empty the test database before each test and refuse to run against a database whose name doesn't end in `_test`.
They set that database's time zone to Toronto's, so SQL that mixes up UTC and local time fails them. Emails go to a fake
mailer that records them; no test reaches a real email provider.

## Data model

- **User:** email (unique), a bcrypt-hashed password, when the address was confirmed (`emailVerifiedAt`), and a
  `tokenVersion` that login tokens must match (resetting the password raises it)
- **Capsule:** title, message, `unlockDate`, `isPublic`, a unique random `slug`, an optional `recipientEmail`, and its
  owner (deleting a user deletes their capsules); `notified`, `notifyLockedUntil` and `notifyAttempts` track its
  unlock emails
- **AuthToken:** an emailed link's secret (only its SHA-256 hash), its kind (confirm an address or reset a password),
  when it expires and when it was used
- **EmailLog:** every email sent or tried (kind, address, status), which is what the email limits count; kept 30 days

## Why I built this

I wanted something emotional but still technical: a mix of UX, access control, and time-based logic in one small app.

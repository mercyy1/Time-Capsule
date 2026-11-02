# ⏳ TimeCapsule

**Write a message now, and it stays locked until the date you choose.** Send it to your future self, schedule a birthday surprise, or keep a journal entry you can't reread for a year.

## What it does

- **Create a capsule:** a title, a message, and a future unlock date
- **Locking enforced on the server:** until the unlock date, the API returns a capsule's title and date (to its owner) but never its message, so the lock can't be bypassed from the browser
- **Private or shareable:** private capsules are visible only to their owner; public ones get a random share link (`slug`) that anyone can open once the capsule unlocks
- **Accounts:** sign up and log in with a password hashed by bcrypt, and stay signed in with a JWT (a signed token the client sends with each request)

## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Node.js + Express 5 |
| Database | PostgreSQL + Prisma ORM |
| Auth | bcrypt password hashing + JWT bearer tokens |
| Frontend | React 19 + Vite + Tailwind CSS (`timecapsule-client/`) |

## API

| Method | Route | Auth | What it does | Success |
| --- | --- | --- | --- | --- |
| `POST` | `/signup` | — | Create an account (`email`, `password`); returns `{ token, user }` | 201 |
| `POST` | `/login` | — | Log in; returns `{ token, user }` | 200 |
| `GET` | `/capsules` | ✔ | Your capsules, soonest unlock first; `message` is `null` until each one unlocks | 200 |
| `POST` | `/capsules` | ✔ | Create a capsule (`title`, `message`, `unlockDate`, `isPublic`) | 201 |
| `GET` | `/capsules/slug/:slug` | ✔ | Open a capsule you own, or anyone's public one | 200 |
| `DELETE` | `/capsules/:id` | ✔ | Delete a capsule you own | 200 |
| `GET` | `/capsules/public/:slug` | — | Open a public capsule by its share link | 200 |

For authenticated routes, send `Authorization: Bearer <token>`; a token lasts one day.

**Locked capsules.** Until its unlock date, a capsule answers `{ "status": "locked", "unlocksAt": "..." }`, and its
owner also gets `capsule: { id, title, unlockDate }`. The message is never sent before the unlock date, not even to
the owner. After it: `{ "status": "unlocked", "capsule": { ... } }`.

**Input rules.** Email: a valid address of at most 254 characters (case and surrounding spaces don't matter).
Password: at least 8 characters and at most 72 bytes. Title: up to 200 characters; message: up to 10,000.
`unlockDate`: ISO 8601 with a time zone (like `2030-01-01T09:00:00Z`), in the future, at most 50 years ahead.
`isPublic`: `true` or `false`. Request bodies: at most 64 kB.

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
| 401 | `AUTH_REQUIRED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` | No (or a malformed) `Authorization` header; a bad or expired token; a wrong email or password |
| 403 | `FORBIDDEN` | Deleting someone else's public capsule |
| 404 | `NOT_FOUND` | No such route, or no capsule you may see: someone else's private capsule looks exactly like a missing one |
| 409 | `EMAIL_TAKEN` | Signing up with an email that already has an account |
| 413 | `PAYLOAD_TOO_LARGE` | A request body over 64 kB |
| 429 | `RATE_LIMITED` | Too many requests; the `Retry-After` header says how many seconds to wait |
| 500 | `INTERNAL_ERROR` | A bug or an outage; the cause goes to the server log, never into the response |

**Rate limits**, per IP address: 1,000 requests per 5 minutes in total, 30 signups and logins per 15 minutes, and 10
failed logins per 15 minutes. Every response carries `RateLimit` and `RateLimit-Policy` headers.

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

## Configuration

The server reads these environment variables (locally from `timecapsule-server/.env`; `.env.example` explains each
one). It checks them at startup and exits with a list of anything missing or invalid.

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | At least 32 random characters; signs login tokens |
| `CLIENT_ORIGIN` | in production | The web client's origin, or several separated by commas, allowed by CORS (default `http://localhost:3000`) |
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

## Data model

- **User:** email (unique) and a bcrypt-hashed password
- **Capsule:** title, message, `unlockDate`, `isPublic`, a unique random `slug`, and its owner (deleting a user deletes their capsules). The schema also has `email` and `notified` fields, reserved for unlock-reminder emails that aren't built yet.

## Why I built this

I wanted something emotional but still technical: a mix of UX, access control, and time-based logic in one small app.

# ⏳ TimeCapsule

**Write a message now, and it stays locked until the date you choose.** Send it to your future self, schedule a birthday surprise, or keep a journal entry you can't reread for a year.

## What it does

- **Create a capsule:** a title, a message, and a future unlock date
- **Locking enforced on the server:** until the unlock date, the API returns the capsule's title and date but never its message, so the lock can't be bypassed from the browser
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

| Method | Route | Auth | What it does |
| --- | --- | --- | --- |
| `POST` | `/signup` | — | Create an account; returns a JWT |
| `POST` | `/login` | — | Log in; returns a JWT |
| `GET` | `/capsules` | ✔ | Your capsules; `message` is `null` until each one unlocks |
| `POST` | `/capsules` | ✔ | Create a capsule (`title`, `message`, `unlockDate`, `isPublic`) |
| `GET` | `/capsules/slug/:slug` | ✔ | Open one capsule if you own it or it's public |
| `DELETE` | `/capsules/:id` | ✔ | Delete a capsule you own |
| `GET` | `/capsules/public/:slug` | — | Open a public capsule by share link |

For authenticated routes, send `Authorization: Bearer <token>`. A capsule that hasn't unlocked yet responds with `{ "status": "locked", "unlocksAt": "..." }`.

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

The server checks its environment variables at startup and exits with a list of anything missing or invalid.

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
- **Capsule:** title, message, `unlockDate`, `isPublic`, a unique random `slug`, and an optional owner. The schema also has `email` and `notified` fields, reserved for unlock-reminder emails that aren't built yet.

## Why I built this

I wanted something emotional but still technical: a mix of UX, access control, and time-based logic in one small app.

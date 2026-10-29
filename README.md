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
| Frontend | React + Tailwind (`timecapsule-client`, see note below) |

> **Note:** `timecapsule-client` is currently recorded as an empty git pointer rather than real files, so the frontend code isn't in this repo yet. Everything below covers the API in `timecapsule-server/`.

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

## Running the server

**You'll need:** Node.js 18+ and PostgreSQL.

```bash
git clone https://github.com/mercyy1/Time-Capsule.git
cd Time-Capsule/timecapsule-server
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npx prisma migrate dev        # creates the tables and generates the Prisma client
npm run dev                   # http://localhost:5000
```

## Data model

- **User:** email (unique) and a bcrypt-hashed password
- **Capsule:** title, message, `unlockDate`, `isPublic`, a unique random `slug`, and an optional owner. The schema also has `email` and `notified` fields, reserved for unlock-reminder emails that aren't built yet.

## Why I built this

I wanted something emotional but still technical: a mix of UX, access control, and time-based logic in one small app.

# TimeCapsule — Production Plan

> Written 2026-11-01 at the end of Phase 0 (recon). Line numbers refer to commit `3b97d71` (current `main`).
> Prices and free-tier limits were read from the providers' own pages on that date (sources in Appendix B) —
> re-check them before relying on them.
>
> **Progress:** Phase 1 done on 2026-11-01 (branch `phase-1-foundations`; notes under Phase 1). Phase 2 done on
> 2026-11-01 (branch `phase-2-security`; notes under Phase 2).

## 1. Summary

TimeCapsule lets a signed-in user write a message that stays locked until a date they choose. Today it is a
working student MVP: an Express 5 + Prisma 6 + PostgreSQL API (`timecapsule-server/`) and a React 19 + Tailwind 3
client built with Create React App (`timecapsule-client/`). PR #1 (merged 2026-10-29) already fixed a data leak on
the public endpoint and added some input checks.

**How recon was done.** Every file in both apps was read. Both apps were run locally against a throwaway
Postgres 17 container (never the Railway database in `.env`). Every API route was called with valid and invalid
input. The client was driven in headless Chrome through signup, create, dashboard, locked and unlocked views,
delete, public links, an expired session, keyboard navigation, a 375 px phone screen and three time zones.

**Headline.** The core idea is implemented correctly — the lock is enforced on the server and times are stored in
UTC — but the app isn't ready for real users: the frontend exists only on one laptop, there are no migrations or
tests, inputs aren't validated (one bug turns private capsules public), and passwords can be guessed without limit.

## 2. Audit

**Critical** = can lose the product or block deploying it · **High** = exploitable or exposes data · **Medium** =
wrong behaviour users will hit, or a weakness that grows with use · **Low** = polish and hygiene.
*Verified* = reproduced while running the app; *Code* = found by reading.

### Critical
- **C1 — The frontend exists only on this laptop.** The parent repo stores `timecapsule-client` as a *gitlink* (a
  pointer to a commit in another repository: mode 160000 → `5579803`) with no `.gitmodules` saying where that
  repository lives. The nested repo's only commit is CRA's "Initialize project using Create React App"; every real
  file (`src/pages/*`, `src/components/*`, `src/context/AuthContext.jsx`, `src/api.jsx`, Tailwind config) is
  uncommitted. A disk failure loses the frontend, and a fresh clone can't build it. *Verified.* → Phase 1
- **C2 — No migrations committed.** `timecapsule-server/prisma/` contains only `schema.prisma`. A *migration* is a
  versioned SQL file that creates or changes tables; without one, production can't run `prisma migrate deploy`
  and nobody can tell how an existing database was built. *Verified.* → Phase 1

### High
- **H1 — Weak, unchecked JWT secret.** A *JWT* (JSON Web Token) is the signed login token; anyone who knows the
  signing secret can mint a token for any user and read their private capsules. `index.js:11-14` only checks the
  secret exists, `.env.example:5` suggests `change-me`, and the local secret is 10 characters — short enough to
  brute-force offline from a single token. *Code.* → Phase 1 (startup check: ≥ 32 random characters), Phase 5
  (fresh production secret)
- **H2 — No rate limiting on `/signup` and `/login`** (`index.js:27`, `index.js:47`). *Rate limiting* caps how many
  requests one client may make per time window. Without it, passwords can be guessed without limit, and because
  every attempt runs bcrypt (deliberately slow: ~85 ms per login on this laptop, slower on a small free instance),
  a modest flood of requests makes the API unresponsive. *Code.* → Phase 2
- **H3 — Known-vulnerable dependencies.** Server: 8 advisories (1 critical in `proxy-addr`, high in
  `path-to-regexp`, both via Express 5.1), all fixable within current major versions. Client: 72 advisories
  (5 critical), mostly inside `react-scripts` 5.0.1 — Create React App, deprecated by the React team on 2025-02-14 —
  plus direct `axios` 1.10 and `react-router-dom` 7.6 advisories. *Verified (`npm audit`).* → Phase 1, Phase 2
- **H4 — Request bodies aren't validated for type, length or range.** *Verified:*
  - `isPublic: Boolean(isPublic)` (`index.js:108`) turns the string `"false"` into `true`: the capsule is created
    **public**.
  - A number as password, an object as email, or a number as title → 500 (bcrypt or Prisma throws).
  - No maximum length (a 90 kB message is accepted) and no upper bound on `unlockDate` (year 9999 is accepted).
  - A date with no time zone (`"2030-01-01T00:00"`) is read in the *server's* time zone: stored as `05:00Z` on a
    Toronto machine, it would be `00:00Z` on a UTC server.
  - `DELETE /capsules/99999999999` → 500 (overflows the 32-bit id column).
  → Phase 2
- **H5 — No tests.** The server has no test script; the client's `src/App.test.js` is CRA boilerplate that looks
  for "learn react" and would fail. *Verified.* → Phase 1

### Medium
- **M1 — Emails aren't normalized.** `Alice@Example.com` and `alice@example.com` became two accounts, and logging in
  as `ALICE@example.com` fails (`index.js:34-39`; the unique index is case-sensitive, `schema.prisma:12`).
  *Verified.* → Phase 2
- **M2 — Account enumeration** (finding out which emails are registered). Signup answers "Email already exists"
  (`index.js:35`), and login skips bcrypt for unknown emails (`index.js:53`), so it answers in **4 ms** for an
  unknown email versus **86 ms** for a real one. *Verified.* → Phase 2 (timing), Phase 3 (signup flow)
- **M3 — Wrong status codes.** Bad credentials → 400 (`index.js:53,56`; should be 401). Missing, invalid or expired
  token → 403 (`auth.js:12`; should be 401, meaning "log in again"). Malformed JSON → 500 and a 200 kB body → 500,
  because the error handler (`index.js:191-194`) ignores the 400/413 status Express attaches. Six simultaneous
  signups with one email → one 200 and five 500s (Prisma's unique-constraint error `P2002` is unhandled).
  *Verified.* → Phase 2
- **M4 — An expired session looks like lost data.** After the 1-day token expiry (`auth.js:20`) the client still
  thinks you're logged in (`ProtectedRoute.jsx:5-6` only checks the saved user object), shows
  `alert("Failed to load capsules")` (`Dashboard.jsx:22-23`), then "No capsules found." — the only way out is
  clicking Logout. *Verified.* → Phase 4 (plus correct 401s in Phase 2)
- **M5 — Token stored in `localStorage`** (`AuthContext.jsx:14-15`, read in `api.jsx:10`). Any script injected into
  the page (*XSS*, cross-site scripting) can read it, and logging out doesn't invalidate it. The alternative
  (httpOnly cookies) is a tradeoff to decide in Phase 2.
- **M6 — The locked capsule page is broken.** For a locked capsule the API returns only `{status, unlocksAt}`, but
  `pages/ViewCapsule.jsx:85-87` renders `title` and `unlockDate`: blank title and **"Unlocks at: Invalid Date"**.
  Its Delete button calls `DELETE /capsules/undefined` (`ViewCapsule.jsx:68`) → 400 → "Failed to delete capsule."
  *Verified (screenshot).* → Phase 4 (and the API returns the title to owners in Phase 2)
- **M7 — Public capsules can't be deleted, and Delete shows for non-owners.** The dashboard opens public capsules in
  a new tab at `/public/:slug` (`Dashboard.jsx:76-80`), which shows only "🔒 Capsule Locked" and no Delete; the
  owner view shows Delete to everyone (`ViewCapsule.jsx:96-102`). *Verified.* → Phase 4
- **M8 — The email field is silently dropped.** The create form collects "Email (optional)"
  (`CreateCapsule.jsx:33`, `:96-104`) but the API ignores it (`index.js:93`) and the column stays NULL.
  `email`/`notified` (`schema.prisma:23,27`) are unused and no notification is ever sent. *Verified.* → Phase 3
- **M9 — Deleting a user orphans their capsules; missing indexes.** `ownerId Int?` without `onDelete`
  (`schema.prisma:25-26`) became `ON DELETE SET NULL`, so capsules outlive their owner and public ones stay
  reachable. There's no index on `ownerId` (every dashboard load scans the table) or on `(notified, unlockDate)`
  (needed by the Phase 3 job). *Verified (`\d "Capsule"`).* → Phase 2
- **M10 — Secret messages can end up in logs.** When Prisma rejects a query it logs the whole call — including
  `message:` — and the error handler prints it (`index.js:192`). A malformed create request therefore writes a
  still-locked message into the server log (in production: the host's log viewer). *Verified.* → Phase 2 (validate
  before the database), Phase 6 (log redaction)
- **M11 — Hard-coded API URL** `http://localhost:5000` (`api.jsx:3`; the dead `components/Create.jsx:15` too).
  *Code.* → Phase 1
- **M12 — No security headers or proxy awareness.** Responses carry `X-Powered-By: Express` and none of
  `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
  (*verified*). `trust proxy` isn't set, so behind Render's proxy every visitor would share one IP address as far as
  rate limiting is concerned. → Phase 2
- **M13 — No graceful shutdown or real health check.** No SIGTERM handling (a deploy cuts in-flight requests and
  leaves database connections open); `GET /` (`index.js:24`) returns text without checking the database. *Code.*
  → Phase 5
- **M14 — Keyboard users can't open a capsule.** Cards are clickable `div`s (`Dashboard.jsx:72-82`); Tab goes
  Logout → search → New Capsule → share links and never reaches a card. *Verified.* → Phase 4

### Low
- **L1** The countdown shows hours only — "1791h 57m 11s" for a capsule 75 days away — and the page polls the API
  every 10 s forever (`ViewCapsule.jsx:31`, `:50-56`). *Verified.* → Phase 4
- **L2** `/capsule/:slug` isn't a protected route (`App.jsx:34`): logged-out visitors see "Capsule not found or
  error occurred." *Verified.* → Phase 4
- **L3** Someone else's private capsule returns 403 instead of 404 (`index.js:130-131`), confirming it exists (low
  risk: slugs are random UUIDs). *Verified.* → Phase 2
- **L4** The auth middleware accepts any scheme — `Basic <token>` works (`auth.js:8`) — and `jwt.verify` doesn't
  pin the algorithm (`auth.js:11`). *Verified.* → Phase 2
- **L5** Daylight-saving edges: picking 02:30 on 2027-03-14 in Toronto (a time that doesn't exist that night)
  silently became 03:30, and times are shown without a zone, so 01:30 on the fall-back night is ambiguous.
  *Verified.* → Phase 4
- **L6** Dead code and leftovers: `components/Create.jsx`, `components/ViewCapsule.jsx` (calls a non-existent
  `/capsules/:slug`) and `components/CapsuleCard.jsx` (links by id) aren't routed; CRA boilerplate (`App.css`,
  `logo.svg`, `App.test.js`, `reportWebVitals.js`, page title "React App"); DaisyUI class `input-bordered` without
  DaisyUI; an unused `@tailwindcss/postcss` v4 next to Tailwind 3.4; a stale, gitignored
  `timecapsule-server/generated/` (old Prisma output); an unused variable at `ViewCapsule.jsx:81`. → Phases 1/4
- **L7** No lint or format config; mixed indentation (4 spaces in `index.js`, 2 in `auth.js`). → Phase 1
- **L8** Accessibility basics: Login/Signup inputs are labelled only by placeholders (`Login.jsx:29-42`); blocking
  `alert()`/`confirm()` dialogs. → Phase 4

### Already good — keep it
- **The lock is enforced on the server**: while locked, the message never leaves the API (`index.js:77-86`,
  `:133-135`, `:173-175`); the dashboard receives `message: null`. *Verified.*
- Passwords hashed with bcrypt; share links are random UUIDs; the public endpoint returns only display fields.
  *Verified.*
- Express 5 forwards errors from async routes to the error handler, so a bad request never crashes the process, and
  error responses don't leak stack traces. *Verified.*
- **Time handling is right on the normal path**: the browser converts the picked local time to UTC
  (`CreateCapsule.jsx:31`) and the server compares instants. Picking 10:00 in Kolkata stored `04:30Z` and displayed
  10:00 there. *Verified.*
- The dashboard has no horizontal scrolling at 375 px. *Verified.*

> In development every request appears twice — React's `StrictMode` runs effects twice. Expected, not a bug.

## 3. Decisions

| | Decision | Choice | Why |
|---|---|---|---|
| a | Bring the client in | **Add it fresh.** First commit = the files exactly as they are; changes come in later commits. The nested `.git` moves to a backup folder outside the repo (not deleted). | Its history is one auto-generated commit, so `git subtree` would preserve nothing of value. |
| b | Hosting | **API: Render free · Database: Neon free · Frontend: Cloudflare Pages free — $0/month** | The only combination where nothing expires or costs money; a clear $7/month upgrade if the sleeping API hurts. |
| c | Email | **Resend** (free plan) | Highest free volume with a plain HTTP API (Render's free tier blocks email ports) and an official Node SDK. |
| d | Language | **Stay on JavaScript** | The real risks here (validation, auth, scheduling) are handled by zod and tests; TypeScript can come later, once CI protects a conversion. |
| e | Upgrades | **Latest within current majors now** (Prisma 6.19.x, Express 5.3.x, …), **Create React App → Vite in Phase 1**, **Node 24 LTS**; Tailwind 4 with the Phase 4 redesign; **Prisma 7 later** | CRA is deprecated and causes most client vulnerabilities; Prisma 7 needs an ES-module rewrite of the server; Node 22 leaves support in April 2027. |
| f | Scope | **Password reset, email verification at signup and Playwright end-to-end tests are all in** | People return to a capsule months or years later and forget passwords; we'll be emailing addresses people type in. |
| — | Railway database | **Start fresh; never connect to it** | Nothing to keep. You can delete the Railway project yourself whenever you like. |

**Decided later, when we get there:** where the login token lives (localStorage or httpOnly cookie) — Phase 2;
what `Capsule.email` means and how the email job is scheduled — Phase 3; which domain to use — account steps.

### Free-tier catches we're accepting (checked 2026-11-01)
- **Render free web service:** sleeps after **15 minutes** without traffic and takes **about a minute** to wake.
  750 instance-hours/month per workspace (enough for one always-on service). The free workspace includes **5 GB of
  bandwidth** and 500 build minutes a month (extra bandwidth is $0.15/GB, or services are suspended if no card is on
  file). Outbound ports **25/465/587 are blocked**, so email must go through an HTTP API. The filesystem is wiped on
  every restart. Always-on paid instance: **$7/month**.
- **Render's own free Postgres is not used:** it's **deleted 30 days after creation** (plus a 14-day grace period)
  and has no backups.
- **Neon free:** 1 GB storage per project and **100 compute-hours/month per project**; the database suspends after
  **5 minutes idle** and wakes in a few hundred milliseconds. It's never paused or deleted for inactivity. The
  restore window is only **6 hours** (one manual snapshot, no scheduled backups), so Phase 6 adds our own backups.
  Because of the compute-hour cap, the email job should run every 15–60 minutes, not every minute.
- **Cloudflare Pages free:** 500 builds/month, one build at a time, 20,000 files, 25 MiB per file, and no bandwidth
  cap listed for static files. Commercial use is allowed (Vercel's Hobby plan is "non-commercial personal use only").
- **Resend free:** 3,000 emails/month, **100 per day**, 3 domains, 30-day logs. Until you **verify a domain you own**
  (by adding DNS records), it only delivers to your own account address. Paid: $20/month for 50,000.
- **Two different sites:** `*.pages.dev` (frontend) and `*.onrender.com` (API) are different sites to the browser.
  That's fine for today's token-in-a-header auth, but httpOnly cookies would need both on one custom domain (e.g.
  `app.` and `api.` subdomains).

Considered, not chosen: **Heroku via the GitHub Student Developer Pack** ($13/month credit for 24 months covers a $7
always-on dyno + $5 Postgres; needs Student Pack approval, ~$12/month afterwards); **Railway Hobby** ($5/month,
everything in one place); **Fly.io** (no free tier for new organizations, card required); **Supabase** (free projects
pause after a week idle, 2-project limit); **Koyeb** (one free 512 MB instance that scales to zero after an hour).
Email: **Brevo** (300/day free with Brevo branding — figures from third-party sources), **Postmark** (100/month free).

## 4. Phases

Every phase gets its own branch (`phase-N-name`), small focused commits and a PR at the end — then work **stops for
review**. Only the repository owner merges PRs.

### Phase 1 — Repo + foundations (`phase-1-foundations`)
Goal: everything in one repo, reproducible locally, protected by tests — with **no change in API behaviour**.
1. Import the client: move the nested `timecapsule-client/.git` to a backup folder outside the repo, run
   `git rm --cached timecapsule-client` (removes only the gitlink), and commit the files exactly as they are. (C1)
2. Replace Create React App with Vite in a separate commit: same UI, `npm run dev` / `npm run build`, API URL from
   `VITE_API_URL` (M11), CRA boilerplate removed (L6 — file deletions confirmed with you first). Tailwind stays on 3.
3. Initial Prisma migration of the **current** schema, committed with `migration_lock.toml`. (C2)
4. `docker-compose.yml` at the repo root: Postgres (a version supported by both Neon and Prisma 6) with a dev
   database and a separate test database.
5. `.env.example` for both apps, and startup validation of environment variables (zod) that lists every missing or
   invalid one and exits — including `JWT_SECRET` ≥ 32 characters (H1). Your local `.env` will need a new secret;
   I'll ask before touching it.
6. Make the app importable without starting a server, then write **characterization tests** — tests that pin down
   today's behaviour so the refactor can't change it — with Jest + Supertest against the real test database:
   signup, login, create, list (message is `null` while locked), open by slug (locked vs unlocked × private vs
   public × owner vs stranger), public view, delete (owner vs non-owner). Unlocked capsules are inserted directly
   through Prisma, since the API rejects past dates. (H5)
7. Split `index.js` into `src/app.js`, `src/server.js`, `src/db.js`, `src/config/`, `src/routes/`,
   `src/middleware/`, `src/services/`; the tests stay unchanged and pass before and after.
8. ESLint (flat config) + Prettier for both apps; the one-time reformat in its own commit. (L7)
9. Dependency bumps within current majors; `npm audit` re-run. (H3)

**Done when:** a fresh clone + `docker compose up -d` + `npm ci` + `npm test` passes; the client builds with Vite;
no route behaves differently.

**Status: done.** What changed from the plan while doing it:
- Tests use **Jest** instead of Vitest. The server is CommonJS, which Jest runs as-is; Vitest is built around ES
  modules (its `vi.mock` doesn't apply to `require()`).
- A fresh `npm ci` showed that Prisma's own postinstall never generates the client: its package entry points at a
  file that isn't published (6.10.1 and 6.19.3). The server now runs `prisma generate` in its own `postinstall`.
  npm 11 also warns about dependency install scripts until they're listed in `allowScripts`; Prisma and bcrypt
  are approved, `@parcel/watcher` (only builds from source on request) is denied.
- Extra client fixes ESLint asked for, none visible to users: `api.jsx` → `api.js`; `AuthContext.jsx` split into
  `AuthContext.js` (context + `useAuth`) and `AuthProvider.jsx` (better hot reload); the dashboard fetch moved into
  its effect; an unused variable removed.
- `npm audit` after the bumps:
  - Server production dependencies: one advisory left (`deepmerge-ts` inside Prisma 6's CLI config loader). Only
    Prisma 7 fixes it, and Prisma 7 stays deferred; the loader only reads our own config file.
  - Server dev tools (ESLint, Jest, nodemon): moderate advisories in `glob`/`minimatch` with no fixed release yet.
  - Client: 6 moderate, all inside ESLint.

### Phase 2 — Security hardening (`phase-2-security`)
1. zod schemas on every route: emails trimmed, lowercased and format-checked (≤ 254 chars); passwords 8–72 bytes
   (bcrypt ignores anything past 72 bytes); maximum lengths for title and message; `unlockDate` must be ISO 8601
   **with a time zone**, in the future and at most ~50 years ahead; `isPublic` a real boolean; slug a UUID; id a
   positive 32-bit integer. (H4, M1, M10)
2. Migration: owner required with `ON DELETE CASCADE`; indexes on `ownerId` and `(notified, unlockDate)`. (M9)
3. Rate limiting (`express-rate-limit`): strict on `/signup` and `/login`, a general limit everywhere, and
   `trust proxy` set correctly for Render. (H2, M12)
4. `helmet` security headers, CORS origin(s) from env, 16 kB request-body limit. (M12)
5. Status codes and one error shape — `{ "error": "<message>", "code": "<CODE>", "details": [...] }`, where `error`
   stays a string so the current client keeps working: 401 for bad credentials and bad or expired tokens, 404 (not
   403) for other people's private capsules, 400/413 for bad bodies, 409 for duplicates. (M3, L3)
6. Login runs a dummy bcrypt comparison for unknown emails (M2); auth requires the `Bearer` scheme and pins the
   HS256 algorithm (L4).
7. Auth review — token lifetime, localStorage vs httpOnly cookies: tradeoffs explained, **you decide** before
   anything changes. (M5)
8. A test for every fix; `npm audit` triage.

**Status: done.** Decisions and what changed from the plan while doing it:
- **Tokens stay in `localStorage`** (your decision on M5), with the one-day lifetime. What protects them is the
  client never running other people's scripts: React escapes everything it renders, the client loads no third-party
  scripts, and Phase 5 adds a Content-Security-Policy to the client site. Logging out still can't revoke a token
  before it expires; Phase 3's `tokenVersion` lets a password reset do that.
- **Status codes**, beyond the plan: `201 Created` for signup and capsule creation (the client accepts any 2xx).
  Deleting someone else's *public* capsule stays `403`: they can already see it, so there's nothing to hide; their
  *private* ones are `404`, exactly like a missing capsule.
- **Body limit 64 kB, not 16 kB**: a 10,000-character message can take 40 kB in UTF-8 (emoji are 4 bytes each), so
  16 kB would refuse valid capsules.
- **Index `(ownerId, unlockDate)` instead of `(ownerId)`**: the capsule list filters by owner and sorts by unlock
  date, and one index serves both (it also covers lookups by owner alone).
- **Rate limits** (per IP address; IPv6 per /56 block): 1,000 requests per 5 minutes overall, 30 signups and logins
  per 15 minutes, 10 failed logins per 15 minutes. People sharing one network (a campus, an office) share a count,
  hence the generous numbers.
- **`TRUST_PROXY`** (default 0) says how many proxies sit in front of the API. Render's value is checked on the
  deployed app in Phase 5: too low and every visitor shares one count, too high and anyone can dodge the limits
  with a forged `X-Forwarded-For`.
- **Two race conditions** found by sending requests at the same moment: simultaneous signups with one email
  crashed with 500 (now the database's unique index decides: one 201, the rest 409), and so did deleting a capsule
  twice at once (now 404).
- **The local database is reached at `127.0.0.1`**, not `localhost`: on Windows each new connection to
  `localhost` waited ~2 seconds (IPv6 first), which slowed the tests and hid those races.
- **M6, API part:** the owner of a locked capsule now also gets its id, title and unlock date; the client starts
  using them in Phase 4.
- **Left for later, on purpose:** per-IP limits don't stop a slow attack spread over many addresses, and limits
  per account let anyone lock a victim out, so account-level protection waits for Phase 3's emails. Signup still
  answers 409 for a registered email until Phase 3's verification flow (M2).
- `npm audit`:
  - Server production dependencies: the same single advisory as in Phase 1 (`deepmerge-ts`, rated high, inside
    Prisma 6's CLI config loader). Only Prisma 7 fixes it; the loader reads only our own config, never request
    data. The new dependencies (helmet 8.3, express-rate-limit 8.7.2) have none.
  - Server dev tools: moderate `glob`/`minimatch` advisories in Jest, ESLint and nodemon, no fixed release yet.
  - Client: none in production dependencies; 6 moderate, all inside ESLint.

### Phase 3 — Unlock notifications + account emails (`phase-3-notifications`)
1. **You decide** what `Capsule.email` means (an extra recipient, or remove it) and how the job is scheduled:
   a Render cron job (paid, $1/month minimum), a GitHub Actions schedule (free, but runs can be delayed or dropped
   under load, and schedules are disabled after 60 days without repository activity), an external pinger such as
   cron-job.org, or an in-process timer (doesn't run while Render's free instance sleeps).
2. Exactly one email per unlocked capsule, even if the job runs twice or crashes mid-run: rows are claimed
   atomically (`FOR UPDATE SKIP LOCKED`, so two runs never grab the same capsule), sent with an idempotency key so a
   retry can't double-send (to confirm in Resend's docs), then marked `notified`. The job stops at Resend's 100/day
   cap and carries on at the next run.
3. Email verification at signup and password reset: random tokens stored only as hashes, single-use, short-lived; a
   reset invalidates existing JWTs (`tokenVersion`); signup stops revealing whether an email is registered (M2).
4. Tests with the email sender replaced by a fake that's passed in (no monkey-patching of modules).
5. Rate limits that match the email quota: every signup and reset request sends an email, and Resend allows 100 a
   day, so cap them per address *and* per day, or a bot can use up the quota and block unlock emails. Revisit
   account-level login protection (for example, emailing the owner after repeated failures).

### Phase 4 — Frontend (`phase-4-frontend`)
1. Every screen handles loading, empty, error and expired-session states; a 401 logs you out with a message instead
   of an `alert`. (M4, L8)
2. Locked capsules show the title and a live countdown with days; unlocked ones show the message; public capsules
   get a copy-share-link button; owners can delete any of their capsules and nobody else sees Delete;
   `/capsule/:slug` is protected. (M6, M7, L1, L2)
3. Time zones end to end: the form shows which time zone it's using and warns about daylight-saving gaps (L5);
   Playwright runs the flow in several time zones.
4. Responsive and keyboard accessible: real links and buttons for cards, labelled inputs, visible focus (M14, L8).
   Tailwind 4 upgrade alongside the redesign, using the `frontend-design` skill (now available).
5. Verify-email and reset-password screens for Phase 3's flows.
6. Playwright end-to-end test of the main flow, including a capsule seeded with a past unlock date to check the
   unlocked view.

### Phase 5 — Deploy + CI (`phase-5-deploy`)
1. GitHub Actions on every PR: lint, server tests with a Postgres service container, client build, Playwright.
2. Render config (`render.yaml`) for the API with migrations run on deploy (checking whether Render's pre-deploy
   step is available on the free plan; otherwise in the build step); Neon's pooled connection URL for the app and
   direct URL for migrations; Cloudflare Pages build with a single-page-app fallback; Node 24 everywhere.
3. `/health` that also checks the database; graceful shutdown on SIGTERM. (M13)
   Set `TRUST_PROXY` for Render and check it on the live app (the address the API sees must be the caller's), and
   give the client site a Content-Security-Policy (Cloudflare Pages `_headers`).
4. README rewritten for production: what it does, live link, Mermaid architecture diagram, local setup, deploy
   steps, environment variables.
5. Account set-up one step at a time, waiting for you at each: domain (the Student Pack includes a free one for a
   year), Cloudflare, Neon, Render, Resend (domain verification records); a new production `JWT_SECRET`.

### Phase 6 — Keeping it running (`phase-6-operations`)
1. Error tracking (Sentry — the Student Pack includes a plan) for API and client, with message text scrubbed. (M10)
2. Structured JSON logs (pino) with request ids; passwords, tokens and capsule messages redacted.
3. Backups beyond Neon's 6-hour window: scheduled, encrypted `pg_dump` to private storage (never a public-repo
   artifact), and a tested restore.
4. Uptime check and `docs/RUNBOOK.md`: what to check when something breaks.

### Not scheduled (your call later)
Account deletion and data export, a privacy page, Prisma 7, TypeScript.

## Appendix A — Recon evidence (2026-11-01)

API, against a throwaway local Postgres 17:

| Request | Result | Finding |
|---|---|---|
| signup: valid · duplicate · `Alice@Example.com` | 200 · 400 "Email already exists" · 200 (second account) | M1, M2 |
| signup: number password · object email · malformed JSON · 200 kB body | 500 · 500 · 500 · 500 | H4, M3 |
| 6 simultaneous signups, same email | 200 + 5 × 500 (`P2002`) | M3 |
| login: wrong password · unknown email | 400 · 400 — 86 ms vs 4 ms | M2, M3 |
| `GET /capsules`: no token · garbage · expired · `Basic <token>` | 401 · 403 · 403 · 200 | M3, L4 |
| create with `isPublic: "false"` | 200, `isPublic: true` | H4 |
| create: 90 kB message · year 9999 · `"2030-01-01T00:00"` | 200 · 200 · 200, stored `05:00Z` | H4 |
| create with `email` | 200, column NULL | M8 |
| list | `message: null` for locked, text for unlocked | ✓ |
| slug: owner locked · owner unlocked · stranger private · stranger public · missing · no token | `{status, unlocksAt}` · full · 403 · locked/unlocked view · 404 · 401 | M6, L3 |
| public: locked · unlocked · private · missing | locked · display fields only · 404 · 404 | ✓ |
| delete: stranger · `undefined` · `abc` · `99999999999` · owner · again | 403 · 400 · 400 · 500 · 200 · 404 | H4 |
| response headers | `X-Powered-By: Express`, no security headers | M12 |

Client, headless Chrome 156: dashboard renders correctly; locked view "Invalid Date" + failed delete (M6); the public
card opens a locked page with no Delete (M7); expired token → alert + "No capsules found." (M4); keyboard never
reaches a card (M14); logged-out `/capsule/:slug` → "not found" (L2); 375 px has no horizontal scroll; time zones:
Kolkata 10:00 → `04:30Z` ✓, Toronto 02:30 on the spring-forward night → 03:30 (L5), Toronto 01:30 on the fall-back
night → `05:30Z` (first occurrence).

## Appendix B — Sources (checked 2026-11-01)
- Render: free tier https://render.com/docs/free · pricing https://render.com/pricing · cron jobs https://render.com/docs/cronjobs
- Neon: pricing https://neon.com/pricing · Postgres versions https://neon.com/docs/postgresql/postgres-version-policy
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Vercel fair use (Hobby is non-commercial): https://vercel.com/docs/limits/fair-use-guidelines
- Railway https://railway.com/pricing · Fly.io https://docs.fly.io/about/pricing · Supabase https://supabase.com/pricing ·
  Koyeb https://www.koyeb.com/docs/reference/instances · Heroku https://www.heroku.com/pricing/
- Resend: pricing https://resend.com/pricing · test-sender limit https://resend.com/docs/knowledge-base/403-error-resend-dev-domain ·
  Postmark https://postmarkapp.com/pricing
- GitHub Student Developer Pack: https://education.github.com/pack
- GitHub Actions `schedule` limits: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Prisma 7 upgrade guide: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- Create React App sunset: https://react.dev/blog/2025/02/14/sunsetting-create-react-app
- Node.js releases: https://nodejs.org/en/about/previous-releases

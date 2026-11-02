# timecapsule-client

The TimeCapsule web app: React 19, React Router 7, react-hook-form and Tailwind CSS 4, built with
[Vite](https://vite.dev). See the root `README.md` for the whole project.

## Run it locally

```bash
cp .env.example .env   # VITE_API_URL: where the API runs
npm ci
npm run dev            # http://localhost:3000
```

The API (`../timecapsule-server`) must be running at `VITE_API_URL`.

## Scripts

| Command                | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `npm run dev`          | Dev server with hot reload on port 3000              |
| `npm run build`        | Production build into `dist/` (needs `VITE_API_URL`) |
| `npm run preview`      | Serve the production build locally on port 3000      |
| `npm run lint`         | ESLint                                               |
| `npm run format`       | Prettier: rewrites the files                         |
| `npm run format:check` | Prettier: only checks them                           |

## Where things are

- `src/pages/`: one component per route (the routes are in `src/App.jsx`).
- `src/components/`: what the pages share: the page frame (`Layout`), form fields (`Field`), notices, the sealed
  envelope (`SealedCapsule`, `Stamp`, `Countdown`) and the letter (`OpenedLetter`).
- `src/api.js`: the API client. A 401 from an ended session logs out and says why (`src/context/AuthProvider.jsx`).
- `src/time.js`: dates in the reader's time zone, the countdown's arithmetic, and reading the date field (including
  the times the clocks skip or repeat).
- `src/index.css`: the design: colors, fonts and type scale (Tailwind's `@theme`), and the envelope, letter and stamp.
  The fonts (Archivo and Newsreader) come from npm packages and are served with the site.

## Tests

There are no unit tests: `../e2e` runs the production build against the API in Chrome (see the root `README.md`).

## Browsers

Safari 16.4, Chrome and Edge 111, Firefox 128 or newer: what Tailwind CSS 4 needs.

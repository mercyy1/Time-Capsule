# timecapsule-client

React frontend for TimeCapsule, built with [Vite](https://vite.dev). See the root `README.md` for the whole project.

## Run it locally

```bash
cp .env.example .env   # VITE_API_URL: where the API runs
npm install
npm run dev            # http://localhost:3000
```

The API (`../timecapsule-server`) must be running at `VITE_API_URL`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 3000 |
| `npm run build` | Production build into `dist/` (needs `VITE_API_URL`) |
| `npm run preview` | Serve the production build locally on port 3000 |

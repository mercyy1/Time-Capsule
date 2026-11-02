import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Where Cloudflare's security check (Turnstile) comes from: its script, and the
// frame the widget draws in.
const TURNSTILE = "https://challenges.cloudflare.com";

// Cloudflare's test site keys (the widget always passes, fails or asks): fine
// locally, useless against bots.
const TURNSTILE_TEST_SITE_KEYS = [
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
];

// The headers the site is served with. The Content-Security-Policy tells the
// browser where the pages may load anything from: the site itself, the API, and
// Cloudflare's security check. Anything else, such as a script someone managed
// to slip into a page, is blocked.
function securityHeaders(apiOrigin) {
  const policy = {
    "default-src": ["'self'"],
    "script-src": ["'self'", TURNSTILE],
    "frame-src": [TURNSTILE],
    "connect-src": ["'self'", apiOrigin],
    "style-src": ["'self'"],
    "img-src": ["'self'"],
    "font-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    // No other site may show these pages in a frame (clickjacking).
    "frame-ancestors": ["'none'"],
  };
  return {
    "Content-Security-Policy": Object.entries(policy)
      .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
      .join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    // Browsers only use https for the site from now on (ignored over http).
    "Strict-Transport-Security": "max-age=31536000",
  };
}

// Cloudflare Pages' _headers file: the headers for every path, and a long cache
// for /assets/, whose file names change whenever their content does.
// https://developers.cloudflare.com/pages/configuration/headers/
const headersFile = (headers) =>
  [
    "# Written by vite.config.js when the site is built.",
    "/*",
    ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");

const pagesHeaders = (headers) => ({
  name: "pages-headers",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "_headers", source: headersFile(headers) });
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // Fail loudly rather than build a site that silently talks to the wrong API.
  if (!env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set. Copy timecapsule-client/.env.example to .env (or set the variable) and try again.",
    );
  }
  if (!URL.canParse(env.VITE_API_URL)) {
    throw new Error(`VITE_API_URL is not a valid URL: "${env.VITE_API_URL}"`);
  }
  const apiOrigin = new URL(env.VITE_API_URL).origin;

  // Cloudflare Pages sets CF_PAGES=1 when it builds the site: the real thing.
  if (process.env.CF_PAGES) {
    if (!apiOrigin.startsWith("https://")) {
      throw new Error("VITE_API_URL must start with https:// for the deployed site.");
    }
    if (!env.VITE_TURNSTILE_SITE_KEY) {
      throw new Error(
        "VITE_TURNSTILE_SITE_KEY is not set: the site key of the Turnstile widget (Cloudflare dashboard, Turnstile).",
      );
    }
    if (TURNSTILE_TEST_SITE_KEYS.includes(env.VITE_TURNSTILE_SITE_KEY)) {
      throw new Error(
        "VITE_TURNSTILE_SITE_KEY is one of Cloudflare's test keys: use the widget's own site key.",
      );
    }
  }

  const headers = securityHeaders(apiOrigin);
  return {
    plugins: [react(), tailwindcss(), pagesHeaders(headers)],
    // Port 3000 is the API's default allowed origin (CLIENT_ORIGIN). The dev
    // server sends no Content-Security-Policy (its live reload runs inline
    // scripts); `npm run preview` serves the build with the deployed headers.
    server: { port: 3000, strictPort: true },
    preview: { port: 3000, strictPort: true, headers },
  };
});

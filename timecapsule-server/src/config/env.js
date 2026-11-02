// The server's settings, read from environment variables and checked once at
// startup. A missing or malformed value stops the server with a list of what to
// fix, instead of surfacing later as a confusing error on the first request.
// Messages never include the values themselves, because some are secrets.
const { z } = require("zod");

const SECRET_HINT =
  "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"";
const PORT_ERROR = "must be a whole number from 1 to 65535";
const TRUST_PROXY_ERROR =
  "must be a whole number from 0 to 5: how many proxies in front of the server add " +
  "the caller's address to X-Forwarded-For (0 when there are none)";
const ORIGIN_ERROR =
  "must be an origin like https://example.com (no path, no trailing slash), " +
  "or several separated by commas";
const DEFAULT_CLIENT_ORIGIN = "http://localhost:3000";

// Browsers send the page's origin (scheme, host and port, e.g. https://example.com)
// and CORS compares it character for character, so a path or trailing slash
// would block every request from the real site.
const isOrigin = (value) => URL.canParse(value) && new URL(value).origin === value;

const shape = {
  NODE_ENV: z
    .enum(["development", "test", "production"], {
      error: "must be development, test or production",
    })
    .default("development"),
  PORT: z.coerce
    .number({ error: PORT_ERROR })
    .int({ error: PORT_ERROR })
    .min(1, { error: PORT_ERROR })
    .max(65535, { error: PORT_ERROR })
    .default(5000),
  DATABASE_URL: z
    .string({ error: "is required (a postgresql:// connection string)" })
    .regex(/^postgres(ql)?:\/\/\S+$/, {
      error: "must be a PostgreSQL connection string starting with postgresql://",
    }),
  JWT_SECRET: z
    .string({ error: `is required. ${SECRET_HINT}` })
    .min(32, { error: `must be at least 32 characters. ${SECRET_HINT}` }),
  // The web client's origin, or several separated by commas (for example the
  // site's own domain and its pages.dev address). Read as a list.
  CLIENT_ORIGIN: z
    .string()
    .transform((value) => value.split(",").map((origin) => origin.trim()))
    .refine((origins) => origins.every(isOrigin), { error: ORIGIN_ERROR })
    .transform((origins) => Object.freeze(origins))
    .optional(),
  // How many proxies (a hosting provider's load balancer, for example) sit in front
  // of the server. Each adds the address it got the request from to the
  // X-Forwarded-For header, and the caller's real address is the one the farthest
  // trusted proxy added. Rate limits count per address, so this must be exact:
  // too low and every visitor shares the proxy's address; too high and callers can
  // pick their own by sending a forged X-Forwarded-For.
  TRUST_PROXY: z.coerce
    .number({ error: TRUST_PROXY_ERROR })
    .int({ error: TRUST_PROXY_ERROR })
    .min(0, { error: TRUST_PROXY_ERROR })
    .max(5, { error: TRUST_PROXY_ERROR })
    .default(0),
};

const schema = z
  .object(shape)
  .refine((env) => env.NODE_ENV !== "production" || env.CLIENT_ORIGIN !== undefined, {
    error: "is required when NODE_ENV is production",
    path: ["CLIENT_ORIGIN"],
    when: () => true, // report it together with any other problems
  })
  .transform((env) => ({
    ...env,
    CLIENT_ORIGIN: env.CLIENT_ORIGIN ?? Object.freeze([DEFAULT_CLIENT_ORIGIN]),
  }));

class EnvError extends Error {
  constructor(issues) {
    const lines = issues.map((issue) => `  - ${issue.path.join(".")} ${issue.message}`);
    super(
      [
        "The server's environment variables are missing or invalid:",
        ...lines,
        "Set them in timecapsule-server/.env (see .env.example) or in your host's settings.",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

// Checks a set of variables (normally process.env) and returns the settings.
// `VAR=` with nothing after it counts as not set, so defaults still apply.
function parseEnv(source) {
  const input = {};
  for (const key of Object.keys(shape)) {
    if (source[key] !== undefined && source[key] !== "") input[key] = source[key];
  }
  const result = schema.safeParse(input);
  if (!result.success) throw new EnvError(result.error.issues);
  return Object.freeze(result.data);
}

let cached;

// The settings for this process, checked the first time they're needed.
function getEnv() {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

module.exports = { getEnv, parseEnv, EnvError };

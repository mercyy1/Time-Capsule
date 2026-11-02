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
const APP_URL_ERROR =
  "must be the web client's address, like https://example.com (no path, no trailing slash)";
const EMAIL_FROM_ERROR =
  'must be an address like capsules@example.com, or a name and an address like "TimeCapsule <capsules@example.com>"';
const RESEND_KEY_ERROR = "must be a Resend API key (they start with re_)";
const DAILY_LIMIT_ERROR = "must be a whole number from 10 to 1000000";
const DEFAULT_CLIENT_ORIGIN = "http://localhost:3000";

// What production can't run without. Locally the server works without them:
// links in emails point at the local client, emails are printed in the server's
// log instead of sent (no RESEND_API_KEY), and the unlock-email job runs from
// the command line (no JOB_SECRET, so its HTTP endpoint is off).
const REQUIRED_IN_PRODUCTION = [
  "CLIENT_ORIGIN",
  "APP_URL",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "JOB_SECRET",
];

// Browsers send the page's origin (scheme, host and port, e.g. https://example.com)
// and CORS compares it character for character, so a path or trailing slash
// would block every request from the real site.
const isOrigin = (value) => URL.canParse(value) && new URL(value).origin === value;

// "capsules@example.com" or "TimeCapsule <capsules@example.com>".
const ADDRESS = String.raw`[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+`;
const SENDER = new RegExp(`^(?:${ADDRESS}|[^<>\\r\\n]+ <${ADDRESS}>)$`);

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
  // Where the web client lives, for the links in emails (confirm your address,
  // reset your password, open your capsule).
  APP_URL: z.string().refine(isOrigin, { error: APP_URL_ERROR }).optional(),
  // Who emails come from. Its domain must be verified in Resend.
  EMAIL_FROM: z.string().regex(SENDER, { error: EMAIL_FROM_ERROR }).optional(),
  // Sends emails through Resend. Without it, emails are printed in the server's log.
  RESEND_API_KEY: z
    .string()
    .regex(/^re_\S+$/, { error: RESEND_KEY_ERROR })
    .optional(),
  // The password the scheduler sends to run the unlock-email job over HTTP.
  JOB_SECRET: z
    .string()
    .min(32, { error: `must be at least 32 characters. ${SECRET_HINT}` })
    .optional(),
  // How many emails the email provider lets us send per day (UTC). Resend's free
  // plan: 100. The server's own limits are shares of it.
  EMAIL_DAILY_LIMIT: z.coerce
    .number({ error: DAILY_LIMIT_ERROR })
    .int({ error: DAILY_LIMIT_ERROR })
    .min(10, { error: DAILY_LIMIT_ERROR })
    .max(1_000_000, { error: DAILY_LIMIT_ERROR })
    .default(100),
};

// Every check below runs even when others failed (`when`), so one start-up
// lists all the problems at once.
const always = () => true;

let schema = z.object(shape);
for (const name of REQUIRED_IN_PRODUCTION) {
  schema = schema.refine((env) => env.NODE_ENV !== "production" || env[name] !== undefined, {
    error: "is required when NODE_ENV is production",
    path: [name],
    when: always,
  });
}
schema = schema
  .refine((env) => env.RESEND_API_KEY === undefined || env.EMAIL_FROM !== undefined, {
    error: "is required when RESEND_API_KEY is set (it's who the emails come from)",
    path: ["EMAIL_FROM"],
    when: always,
  })
  .transform((env) => ({
    ...env,
    CLIENT_ORIGIN: env.CLIENT_ORIGIN ?? Object.freeze([DEFAULT_CLIENT_ORIGIN]),
    APP_URL: env.APP_URL ?? DEFAULT_CLIENT_ORIGIN,
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

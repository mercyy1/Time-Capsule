// The check that a person, not a bot, is signing up or asking for a password
// reset: Cloudflare Turnstile. Both send an email to whatever address they're
// given, so a bot repeating them could use up the day's emails.
//
// Turnstile's script draws a widget that usually decides on its own, without
// asking the visitor anything, and hands the page a token. The form sends the
// token with its request, and the API asks Cloudflare whether it's genuine (the
// API's src/captcha.js). Without VITE_TURNSTILE_SITE_KEY the check is off, as it
// is on the API without TURNSTILE_SECRET_KEY.
// https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || null;

// Cloudflare requires this exact address (no copies or proxies), so the site's
// Content-Security-Policy allows scripts and frames from challenges.cloudflare.com.
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
const LOAD_TIMEOUT_MS = 20_000;

let loading = null;

// Loads Turnstile's script the first time a page needs it, and resolves with its
// API (window.turnstile). Rejects if it can't load: offline, or blocked.
export function loadTurnstile() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        clearTimeout(timer);
        script.remove();
        loading = null; // the next page that needs it tries again
        reject(new Error("Turnstile's script didn't load"));
      };
      const timer = setTimeout(fail, LOAD_TIMEOUT_MS);
      window.onTurnstileLoad = () => {
        clearTimeout(timer);
        resolve(window.turnstile);
      };
      script.src = SCRIPT_URL;
      script.async = true;
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return loading;
}

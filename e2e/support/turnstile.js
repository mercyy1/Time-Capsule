// A stand-in for Cloudflare Turnstile's script (the client's src/securityCheck.js
// loads it on the signup and "forgot password" pages), so the tests neither
// depend on Cloudflare nor wait for it. Like the real script with Cloudflare's
// test keys, it gives each widget the dummy token straight away, and that's the
// only token the test API accepts (api-server.cjs). A test can have it hand out
// other tokens first, which the API refuses:
//   await page.addInitScript(() => { window.turnstileTokens = ["refused"]; });
import settings from "./settings.cjs";

// The script's address, whatever comes after it (?render=explicit&onload=…).
export const TURNSTILE_SCRIPT = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/;

// Runs in the page, in place of Cloudflare's script: the same window.turnstile.
function fakeTurnstile(dummyToken) {
  const widgets = new Map();
  let made = 0;

  // Like the real widget, a moment later: the next token for widget `id`.
  const give = (id) => {
    const token = window.turnstileTokens?.shift() ?? dummyToken;
    setTimeout(() => {
      const widget = widgets.get(id);
      if (!widget) return;
      widget.token = token;
      widget.params.callback?.(token);
    }, 10);
  };

  window.turnstile = {
    render(container, params) {
      made += 1;
      const id = `fake-widget-${made}`;
      widgets.set(id, { params, token: undefined });
      give(id);
      return id;
    },
    reset(id) {
      const widget = widgets.get(id);
      if (!widget) return;
      widget.token = undefined;
      give(id);
    },
    remove(id) {
      widgets.delete(id);
    },
    getResponse: (id) => widgets.get(id)?.token,
    isExpired: () => false,
    execute() {},
    ready: (callback) => callback(),
  };

  // The page names the function to call once the script has loaded (?onload=…).
  const onload = new URL(document.currentScript.src).searchParams.get("onload");
  if (onload) window[onload]();
}

// Serves the fake in place of Cloudflare's script for every page of `context`.
export async function useFakeTurnstile(context) {
  await context.route(TURNSTILE_SCRIPT, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `(${fakeTurnstile})(${JSON.stringify(settings.TURNSTILE_TOKEN)});`,
    }),
  );
}

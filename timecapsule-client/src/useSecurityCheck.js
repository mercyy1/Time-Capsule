import { useState } from "react";
import { SITE_KEY, loadTurnstile } from "./securityCheck";

const PROBLEMS = {
  load:
    "The security check couldn't load. Check your connection, or allow challenges.cloudflare.com " +
    "if something on your device blocks it, then reload the page.",
  failed: "The security check didn't work. Wait a moment and try again, or reload the page.",
  // Turnstile's 110… errors: the site's settings, nothing the visitor can fix.
  broken: "The security check isn't working right now. Please try again in a few minutes.",
  unsupported: "Your browser can't run the security check. Please try another browser.",
  slow: "The security check is taking too long. Reload the page and try again.",
};
// How long a form waits for a token it asked for: the check may need the
// visitor to tick its box first.
const TOKEN_TIMEOUT_MS = 60_000;
// Turnstile's widget needs 300 pixels across, unless it's the compact one.
const FLEXIBLE_MIN_WIDTH = 300;

// One widget's state: the token it last got, and the submits waiting for one.
function createCheck(action) {
  let widget = null; // { turnstile, id } while it's on the page
  let token = null;
  let problem = null; // why there's no token to give right now
  const waiting = new Set();

  function received(newToken) {
    token = newToken;
    problem = null;
    for (const waiter of waiting) waiter.resolve(newToken);
    waiting.clear();
  }

  function failed(message) {
    token = null;
    problem = message;
    for (const waiter of waiting) waiter.reject(new Error(message));
    waiting.clear();
  }

  return {
    // Draws the widget in `node` (a ref callback), and removes it when the
    // node goes away (the cleanup function React 19 calls).
    mount(node) {
      if (!SITE_KEY) return undefined;
      let removed = false;
      loadTurnstile().then(
        (turnstile) => {
          if (removed) return;
          const id = turnstile.render(node, {
            sitekey: SITE_KEY,
            action,
            // Shown only when Cloudflare needs the visitor to tick a box.
            appearance: "interaction-only",
            size: node.clientWidth < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible",
            theme: "light",
            language: "en",
            callback: received,
            // Cloudflare retries on its own, and this is called on each failure.
            "error-callback": (code) => {
              console.warn(`Security check error ${code}`);
              failed(String(code).startsWith("110") ? PROBLEMS.broken : PROBLEMS.failed);
              return true; // handled: Turnstile needn't log it again
            },
            // A token lasts 5 minutes; Turnstile then fetches a new one by itself.
            "expired-callback": () => {
              token = null;
            },
            // The visitor didn't tick the box in time; Turnstile starts over.
            "timeout-callback": () => {
              token = null;
            },
            "unsupported-callback": () => failed(PROBLEMS.unsupported),
          });
          widget = { turnstile, id };
        },
        () => {
          if (!removed) failed(PROBLEMS.load);
        },
      );
      return () => {
        removed = true;
        widget?.turnstile.remove(widget.id);
        widget = null;
        token = null;
      };
    },

    // The token to send with the form (undefined when the check is off): the
    // one already given, or the next one. Rejects with a message for the visitor.
    token() {
      if (!SITE_KEY) return Promise.resolve(undefined);
      if (token) return Promise.resolve(token);
      if (problem) return Promise.reject(new Error(problem));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(waiter);
          reject(new Error(PROBLEMS.slow));
        }, TOKEN_TIMEOUT_MS);
        const waiter = {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };
        waiting.add(waiter);
      });
    },

    // A token works once: after a request that sent it, start a new check so
    // the next try has one.
    reset() {
      token = null;
      if (!widget) return;
      problem = null;
      widget.turnstile.reset(widget.id);
    },
  };
}

// The security check on a form. Render <SecurityCheck check={check} /> where
// the widget may appear; before sending, `await check.token()`; after a request
// that failed, `check.reset()`. `action` names the form in Cloudflare's
// statistics (letters, digits, - and _).
export default function useSecurityCheck(action) {
  const [check] = useState(() => createCheck(action));
  return check;
}

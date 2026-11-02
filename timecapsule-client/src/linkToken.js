// Emailed links carry their secret after the "#" (/verify-email#token=...).
// Browsers never send that part of an address to a server, so the secret stays
// out of server and proxy logs.
export const readLinkToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token");

// Takes the secret out of the address bar and the browser's history once the
// page has read it.
export function forgetLinkToken() {
  if (!window.location.hash) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", pathname + search);
}

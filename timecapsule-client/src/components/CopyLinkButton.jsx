import { useEffect, useRef, useState } from "react";

const LABELS = { idle: "Copy link", copied: "Copied", failed: "Couldn't copy" };
const ANNOUNCED = { idle: "", copied: "Link copied", failed: "Couldn't copy the link" };

// Copies `url` to the clipboard. The button says "Copied" for a moment, and
// screen readers hear it too. With `keepWidth`, the button keeps the width of
// its longest label, so the controls around it don't move.
export default function CopyLinkButton({ url, keepWidth = true, className = "" }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // No clipboard access (an insecure page, or the browser said no).
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button type="button" onClick={copy} className={className}>
        {keepWidth ? (
          // All three labels share one grid cell; the hidden ones hold the width.
          <span className="grid">
            {Object.entries(LABELS).map(([name, label]) => (
              <span
                key={name}
                className={`col-start-1 row-start-1 ${name === state ? "" : "invisible"}`}
              >
                {label}
              </span>
            ))}
          </span>
        ) : (
          LABELS[state]
        )}
      </button>
      <span role="status" className="sr-only">
        {ANNOUNCED[state]}
      </span>
    </>
  );
}

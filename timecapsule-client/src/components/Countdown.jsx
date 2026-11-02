import { useEffect, useRef } from "react";
import { describeTimeLeft, timeLeft } from "../time";

// "Opens in 74 days, 3 hours, 12 minutes, and 5 seconds", for the `now` it's
// given (ticking once a second). A timer: screen readers don't read every tick,
// only when asked. Calls onDone once, when it reaches zero.
export default function Countdown({ until, now, onDone, late = false, className = "" }) {
  const left = timeLeft(until, now);
  const done = left.total === 0;
  const called = useRef(false);

  useEffect(() => {
    if (!done || called.current) return;
    called.current = true;
    onDone?.();
  }, [done, onDone]);

  let text = `Opens in ${describeTimeLeft(left)}`;
  if (done && late) text = "It's time, but it hasn't opened yet. Reload the page in a minute.";
  else if (done) text = "Opening…";
  return (
    <p role="timer" className={className}>
      {text}
    </p>
  );
}

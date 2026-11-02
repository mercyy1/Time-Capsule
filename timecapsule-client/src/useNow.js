import { useEffect, useState } from "react";

// The current time (in ms), updated every `interval` ms. Updates land just after
// each whole second (or minute), so a countdown changes with the clock instead of
// drifting between ticks.
export default function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = setTimeout(tick, interval - (Date.now() % interval) + 5);
    };
    const tick = () => {
      setNow(Date.now());
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, [interval]);

  return now;
}

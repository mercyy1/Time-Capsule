import { useCallback, useEffect, useRef, useState } from "react";
import api from "./api";
import { errorMessage } from "./apiErrors";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// When a sealed capsule's countdown reaches zero, the API is asked again after
// these waits (ms) until it opens the capsule: it goes by its own clock, which
// can be a little behind this device's.
const OPEN_RETRIES = [0, 2000, 4000, 8000, 15000];

// Loads what a capsule page shows from the API (`path`). Returns
//   phase   "loading", "ready", "missing" (no such capsule) or "failed"
//   view    the API's answer, once ready
//   error   what to say, if failed
//   late    true if the countdown ended but the API still says it's locked
//   retry() load again after a failure
//   open()  the countdown reached zero: load until the API opens it
export default function useCapsuleView(path) {
  const [state, setState] = useState({ phase: "loading" });
  const [late, setLate] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Resolves to the API's answer, or null if there isn't one.
  const load = useCallback(
    () =>
      api.get(path).then(
        ({ data }) => {
          if (mounted.current) setState({ phase: "ready", view: data });
          return data;
        },
        (err) => {
          if (mounted.current) {
            setState(
              err.response?.status === 404
                ? { phase: "missing" }
                : { phase: "failed", error: errorMessage(err) },
            );
          }
          return null;
        },
      ),
    [path],
  );

  useEffect(() => {
    load();
  }, [load]);

  const retry = () => {
    setState({ phase: "loading" });
    load();
  };

  const open = useCallback(async () => {
    for (const delay of OPEN_RETRIES) {
      await wait(delay);
      if (!mounted.current) return;
      const view = await load();
      if (view?.status !== "locked") return;
    }
    if (mounted.current) setLate(true);
  }, [load]);

  return { ...state, late, retry, open };
}

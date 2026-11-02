import { useEffect } from "react";

// Names the browser tab after the page, so tabs, history and screen readers say
// where you are.
export default function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} – TimeCapsule` : "TimeCapsule";
  }, [title]);
}

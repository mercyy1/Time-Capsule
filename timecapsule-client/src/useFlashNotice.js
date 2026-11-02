import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// A message from the page before ("Your capsule is sealed."), passed with
// navigate(to, { state: { notice } }). It shows once: it's taken out of the
// browser's history entry, so reloading or coming Back doesn't show it again.
export default function useFlashNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => location.state?.notice ?? null);
  const passed = Boolean(location.state?.notice);
  const { pathname, search } = location;

  useEffect(() => {
    if (passed) navigate(pathname + search, { replace: true, state: null });
  }, [passed, navigate, pathname, search]);

  return notice;
}

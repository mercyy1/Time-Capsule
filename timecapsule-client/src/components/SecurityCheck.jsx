import { useCallback } from "react";

// Where the security check's widget appears, when Cloudflare needs the visitor
// to tick a box. `check` comes from useSecurityCheck.
export default function SecurityCheck({ check }) {
  const container = useCallback((node) => check.mount(node), [check]);
  return <div ref={container} />;
}

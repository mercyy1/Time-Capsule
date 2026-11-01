import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Fail loudly rather than build a site that silently talks to the wrong API.
  const { VITE_API_URL } = loadEnv(mode, process.cwd(), "VITE_");
  if (!VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set. Copy timecapsule-client/.env.example to .env (or set the variable) and try again.",
    );
  }
  if (!URL.canParse(VITE_API_URL)) {
    throw new Error(`VITE_API_URL is not a valid URL: "${VITE_API_URL}"`);
  }

  return {
    plugins: [react()],
    // Port 3000 is the API's default allowed origin (CLIENT_ORIGIN).
    server: { port: 3000, strictPort: true },
    preview: { port: 3000, strictPort: true },
  };
});

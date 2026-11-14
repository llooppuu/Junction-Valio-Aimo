import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  // Reads the same optional root .env file as the backend.
  const env = loadEnv(mode, repoRoot, ["BACKEND_", "BUYER_", "WHOLESALER_"]);
  const backendPort = env.BACKEND_PORT ?? "3001";
  const buyerToken = env.BUYER_TOKEN ?? "demo-buyer-token";
  const wholesalerToken = env.WHOLESALER_TOKEN ?? "demo-wholesaler-token";

  // The frontend is the buyer's app. The proxy adds the buyer's demo token on the
  // server side, so the token never ships in the browser bundle.
  // The wholesaler's view is served under its own path with the wholesaler's token, also added here.
  // More specific paths come first, because the proxy uses the first match.
  const proxy = {
    "/api/wholesaler": {
      target: `http://127.0.0.1:${backendPort}`,
      headers: { Authorization: `Bearer ${wholesalerToken}` },
    },
    "/api": {
      target: `http://127.0.0.1:${backendPort}`,
      headers: { Authorization: `Bearer ${buyerToken}` },
    },
  };

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  };
});

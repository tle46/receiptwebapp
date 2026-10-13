import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createGateway } from "./server/gateway.mjs";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  function attachGateway(server, defaultOrigin) {
    const gateway = createGateway({
      backend:
        env.BACKEND_URL || env.VITE_API_BASE_URL || "http://localhost:8080",
      origin: env.PUBLIC_ORIGIN || defaultOrigin,
      dataDir: env.SESSION_DATA_DIR || ".session-data",
      key: env.SESSION_ENCRYPTION_KEY,
    });
    server.middlewares.use((req, res, next) => {
      gateway
        .handle(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch(next);
    });
    server.httpServer?.once("close", () => gateway.close());
  }
  return {
    plugins: [
      react(),
      {
        name: "splitshare-session-gateway",
        configureServer(server) {
          attachGateway(server, "http://localhost:5173");
        },
        configurePreviewServer(server) {
          attachGateway(server, "http://localhost:4173");
        },
      },
    ],
    server: { port: 5173, strictPort: true },
  };
});

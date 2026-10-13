import { defineConfig } from "@playwright/test";
export default defineConfig({
  testMatch: ["auth.spec.ts", "participant.spec.ts", "calculation.spec.ts"],
  use: { channel: "msedge", headless: true },
  timeout: 60000,
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});

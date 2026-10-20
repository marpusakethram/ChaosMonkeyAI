import { defineConfig } from "@playwright/test";
import path from "node:path";

const apiDir = path.resolve(__dirname, "../../services/api");
const python = process.env.API_PYTHON || path.join(apiDir, ".venv/bin/python");
const dataDir = path.resolve(__dirname, "test-results/e2e-data");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: apiDir,
      url: "http://127.0.0.1:8000/api/v1/health",
      env: { CHAOS_DATA_DIR: dataDir, GEMINI_API_KEY: "" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npx next start -p 3000 -H 127.0.0.1",
      url: "http://127.0.0.1:3000",
      env: { API_URL: "http://127.0.0.1:8000" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

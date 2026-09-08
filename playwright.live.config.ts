import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

const output = process.env.YOVA_LIVE_BROWSER_OUTPUT;
if (!output) throw new Error("Use pnpm test:live so browser results and fixtures belong to this run.");
const server = config.webServer;
if (!server || Array.isArray(server)) throw new Error("The live gate requires its isolated preview server.");
export default defineConfig({
  ...config,
  testDir: resolve(process.cwd(), "e2e"),
  outputDir: resolve(output, "artifacts"),
  reporter: [["list"], ["json", { outputFile: resolve(output, "browser.json") }]],
  retries: 0,
  workers: 1,
  webServer: {
    ...server,
    command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100",
    cwd: process.cwd(),
    reuseExistingServer: false,
    env: { ...server.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  },
});

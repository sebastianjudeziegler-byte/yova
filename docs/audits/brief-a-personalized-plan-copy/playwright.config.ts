import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import config from "../../../playwright.config";
export default defineConfig({
  ...config,
  testDir: resolve(process.cwd(), "e2e"),
  webServer: {
    ...config.webServer,
    command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100",
    cwd: process.cwd(),
  },
});

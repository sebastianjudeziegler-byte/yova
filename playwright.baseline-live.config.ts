import { defineConfig } from "@playwright/test";
import baseline from "./playwright.baseline.config";

/**
 * Live baseline practice (Brief 1.5 item 1): the flag-on baseline server with
 * the real model key, running only the live retry spec on desktop and mobile.
 * Invoked by `pnpm test:e2e:baseline:live`; CI supplies OPENAI_API_KEY.
 */
const server = baseline.webServer && !Array.isArray(baseline.webServer) ? baseline.webServer : undefined;

export default defineConfig({
  ...baseline,
  testMatch: /(^|\/)baseline-practice-retry\.live\.spec\.ts$/,
  retries: 0,
  workers: 1,
  webServer: server && {
    ...server,
    env: { ...server.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "", YOVA_NEXT_DIST_DIR: ".next-e2e-baseline-live" },
  },
});

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
  testMatch: /(^|\/)baseline-(practice-retry|hub-profiles|outside)\.live\.spec\.ts$/,
  retries: 0,
  workers: 1,
  webServer: server && {
    ...server,
    // Reuses the baseline build directory, which tsconfig.json already lists.
    // A new directory makes next dev rewrite tsconfig.json mid-run, and that
    // uncommitted change broke the Study Profile comparison's git checkout.
    env: { ...server.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  },
});

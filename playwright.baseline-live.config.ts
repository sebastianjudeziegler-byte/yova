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
  // Keep successful named journeys for founder review, not only failures.
  use: { ...baseline.use, video: "on" },
  testMatch: /(^|\/)baseline-(practice-retry|hub-profiles|outside|session-quality)\.live\.spec\.ts$/,
  retries: 0,
  workers: 1,
  // The two-profile hub sessions are captured at desktop width only. Leaving them out of the
  // phone project, rather than skipping inside the test, keeps "no live case skipped" meaningful.
  projects: (baseline.projects ?? []).map((project) => (
    project.name?.includes("mobile") ? { ...project, testIgnore: /(^|\/)baseline-(hub-profiles|session-quality)\.live\.spec\.ts$/ } : project
  )),
  webServer: server && {
    ...server,
    // Reuses the baseline build directory, which tsconfig.json already lists.
    // A new directory makes next dev rewrite tsconfig.json mid-run, and that
    // uncommitted change broke the Study Profile comparison's git checkout.
    env: { ...server.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  },
});

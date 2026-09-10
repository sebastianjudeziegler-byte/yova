import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Browser cases for the baseline session shapes (docs/redesign), run against
 * a dev server with YOVA_BASELINE_SESSION_SHAPES on and its own build
 * directory. The base config keeps its single flag-off server so the
 * pre-baseline suite, the live gate and the phone-width comparison run exactly
 * as they did on main. Invoked by `pnpm test:e2e:baseline`.
 */
const port = 3101;
const externalBaseURL = process.env.YOVA_E2E_BASE_URL?.trim();
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const baseServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;

export default defineConfig({
  ...base,
  testMatch: /(^|\/)baseline-[^/]*\.spec\.ts$/,
  use: { ...base.use, baseURL },
  projects: [
    {
      name: "baseline-chromium",
      use: { ...devices["Desktop Chrome"], baseURL },
    },
    {
      name: "baseline-mobile-chromium",
      use: { ...devices["Pixel 7"], baseURL },
    },
  ],
  webServer: externalBaseURL ? undefined : {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      ...(baseServer?.env ?? {}),
      YOVA_BASELINE_SESSION_SHAPES: "true",
      YOVA_NEXT_DIST_DIR: ".next-e2e-baseline",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      OPENAI_API_KEY: "",
      AUTH_EMAIL_CODE_VERIFICATION: "false",
      AUTH_PASSWORD_ACCOUNTS: "false",
      AUTH_CAPTCHA_ENABLED: "false",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      SITE_URL: baseURL,
      YOVA_E2E: "1",
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baselinePort = 3101;
const externalBaseURL = process.env.YOVA_E2E_BASE_URL?.trim();
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const passwordAuthMode = process.env.YOVA_E2E_PASSWORD_AUTH === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /baseline-.*\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: /baseline-.*\.spec\.ts/,
    },
    // The baseline session shapes (docs/redesign) run against a second dev
    // server with the flag on. The pre-baseline suites above keep running
    // unchanged against the flag-off server, so every case that passed on
    // main still runs exactly as it did.
    {
      name: "baseline-chromium",
      use: { ...devices["Desktop Chrome"], baseURL: externalBaseURL || `http://127.0.0.1:${baselinePort}` },
      testMatch: /baseline-.*\.spec\.ts/,
    },
    {
      name: "baseline-mobile-chromium",
      use: { ...devices["Pixel 7"], baseURL: externalBaseURL || `http://127.0.0.1:${baselinePort}` },
      testMatch: /baseline-.*\.spec\.ts/,
    },
  ],
  webServer: externalBaseURL ? undefined : [{
    command: passwordAuthMode
      ? `node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port ${port}`
      : `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      YOVA_BASELINE_SESSION_SHAPES: "false",
      NEXT_PUBLIC_SUPABASE_URL: passwordAuthMode ? `${baseURL}/supabase-test` : "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: passwordAuthMode ? "sb_publishable_e2e_password_auth" : "",
      OPENAI_API_KEY: "",
      RESEND_API_KEY: "",
      STUDY_PROFILE_FROM_EMAIL: "",
      AUTH_EMAIL_CODE_VERIFICATION: passwordAuthMode ? "true" : "false",
      AUTH_INVITE_ONLY: "false",
      AUTH_PASSWORD_ACCOUNTS: passwordAuthMode ? "true" : "false",
      AUTH_CAPTCHA_ENABLED: passwordAuthMode ? "true" : "false",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: passwordAuthMode ? "1x00000000000000000000AA" : "",
      SITE_URL: baseURL,
      YOVA_E2E: "1",
    },
  }, {
    command: `pnpm dev --hostname 127.0.0.1 --port ${baselinePort}`,
    url: `http://127.0.0.1:${baselinePort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      YOVA_BASELINE_SESSION_SHAPES: "true",
      YOVA_NEXT_DIST_DIR: ".next-e2e-baseline",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      OPENAI_API_KEY: "",
      RESEND_API_KEY: "",
      STUDY_PROFILE_FROM_EMAIL: "",
      AUTH_EMAIL_CODE_VERIFICATION: "false",
      AUTH_INVITE_ONLY: "false",
      AUTH_PASSWORD_ACCOUNTS: "false",
      AUTH_CAPTCHA_ENABLED: "false",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      SITE_URL: `http://127.0.0.1:${baselinePort}`,
      YOVA_E2E: "1",
    },
  }],
});

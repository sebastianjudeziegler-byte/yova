import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const externalBaseURL = process.env.YOVA_E2E_BASE_URL?.trim();
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const passwordAuthMode = process.env.YOVA_E2E_PASSWORD_AUTH === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
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
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: externalBaseURL ? undefined : {
    command: passwordAuthMode
      ? `node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port ${port}`
      : `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
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
  },
});

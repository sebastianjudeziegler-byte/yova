import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const externalBaseURL = process.env.YOVA_E2E_BASE_URL?.trim();
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;

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
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      OPENAI_API_KEY: "",
      AUTH_EMAIL_CODE_VERIFICATION: "false",
      SITE_URL: baseURL,
      YOVA_E2E: "1",
    },
  },
});

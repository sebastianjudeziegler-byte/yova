import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

const server = config.webServer;
if (!server || Array.isArray(server)) throw new Error("The live browser canary requires its isolated local preview server.");

export default defineConfig({
  ...config,
  webServer: {
    ...server,
    reuseExistingServer: false,
    env: { ...server.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  },
});

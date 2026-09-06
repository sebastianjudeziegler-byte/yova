import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "*journeys.spec.ts",
  outputDir: "./test-results",
  reporter: [["list"], ["json", {outputFile:`./evidence/${process.env.CALENDAR_AUDIT_REPORT || "results.json"}`}]],
  timeout: 60000,
  use: {...base.use, timezoneId:"Europe/London"},
});

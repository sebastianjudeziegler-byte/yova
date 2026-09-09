import { defineConfig } from "vitest/config";
import config from "../../../vitest.config.mts";
export default defineConfig({
  ...config,
  test: { ...config.test, maxWorkers: 1, setupFiles: ["docs/audits/brief-a-personalized-plan-copy/frozen-unit-clock.ts"] },
});

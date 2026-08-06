import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import path from "node:path";

const { loadEnvConfig } = nextEnv;

// Load the same local server configuration as the app before Vitest switches
// itself into test mode. Values are inherited by the child process, but never
// printed or copied into client-side code.
loadEnvConfig(process.cwd(), true);

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OpenAI is not configured. Add OPENAI_API_KEY to .env.local before running live evaluations.");
  process.exit(1);
}

const vitestExecutable = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const child = spawn(
  vitestExecutable,
  ["run", "src/evals/plan-quality.live.test.ts", "--reporter=verbose"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      YOVA_RUN_LIVE_EVALS: "1",
    },
  },
);

child.on("error", (error) => {
  console.error(`Could not start the plan evaluator: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Plan evaluation stopped with signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

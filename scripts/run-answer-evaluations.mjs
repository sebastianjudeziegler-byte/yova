import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import path from "node:path";

const { loadEnvConfig } = nextEnv;
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
  ["run", "src/evals/answer-evaluation-quality.live.test.ts", "--reporter=verbose"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      YOVA_RUN_LIVE_ANSWER_EVALS: "1",
    },
  },
);

child.on("error", (error) => {
  console.error(`Could not start the answer evaluator: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Answer evaluation stopped with signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

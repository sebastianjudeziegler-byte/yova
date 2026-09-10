// CI-only comparison requested for the pre-existing phone-width observation.
// Both source revisions use the same installed dependencies, browser and flags.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (!process.env.CI || !process.env.GITHUB_ACTIONS) {
  throw new Error("This comparison runs only in GitHub Actions; local verification is disabled.");
}
const root = process.cwd();
const output = resolve(root, "test-results/study-profile-comparison");
mkdirSync(output, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const branch = git("rev-parse", "HEAD");
const baseline = "c7b3ca99964524cefc04437b7236b37fe8fe2666";
const configPath = resolve(root, "playwright.profile-comparison.config.ts");
const rows = [];

function collect(suites, result = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      result.push({
        name: spec.title,
        project: test.projectName,
        outcomes: (test.results ?? []).map(run => ({ status: run.status, errors: run.errors })),
      });
    }
    collect(suite.suites, result);
  }
  return result;
}

try {
  git("fetch", "--depth=1", "origin", baseline);
  for (const [label, sha] of [["main", baseline], ["branch", branch]]) {
    mkdirSync(resolve(output, label), { recursive: true });
    // next dev can rewrite this generated type stub. It carries no source work.
    git("restore", "next-env.d.ts");
    git("checkout", "--detach", sha);
    rmSync(resolve(root, ".next"), { recursive: true, force: true });
    writeFileSync(configPath, `import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, retries: 0, workers: 1,
  outputDir: ${JSON.stringify(resolve(output, label, "artifacts"))},
  reporter: [['list'], ['json', { outputFile: ${JSON.stringify(resolve(output, label, "raw.json"))} }]],
  webServer: { ...base.webServer,
    command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100',
    reuseExistingServer: false,
  },
});\n`);
    const run = spawnSync(process.execPath, [
      "node_modules/@playwright/test/cli.js", "test", "e2e/study-profile.spec.ts",
      "--config", configPath, "--project", "mobile-chromium",
      "--grep", "keeps every pre-report screen usable on common phone widths",
    ], { cwd: root, stdio: "inherit", env: { ...process.env, OPENAI_API_KEY: "", YOVA_E2E_PASSWORD_AUTH: "0" } });
    const rawPath = resolve(output, label, "raw.json");
    const raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, "utf8")) : null;
    // Never publish Playwright's config environment in an artifact.
    const tests = collect(raw?.suites);
    const state = tests.length !== 1 || tests[0].outcomes.length !== 1
      ? "unavailable"
      : tests[0].outcomes[0].status === "passed" && run.status === 0
        ? "pass"
        : ["failed", "timedOut"].includes(tests[0].outcomes[0].status) ? "fail" : "unavailable";
    rows.push({ revision: label, sha, state, exitCode: run.status, tests, errors: raw?.errors ?? [] });
    writeFileSync(resolve(output, label, "result.json"), JSON.stringify(rows.at(-1), null, 2));
    rmSync(rawPath, { force: true });
  }
} finally {
  git("restore", "next-env.d.ts");
  git("checkout", "--detach", branch);
  rmSync(configPath, { force: true });
  rmSync(resolve(root, ".next"), { recursive: true, force: true });
  writeFileSync(resolve(output, "report.json"), JSON.stringify(rows, null, 2));
  const before = rows.find(row => row.revision === "main");
  const after = rows.find(row => row.revision === "branch");
  writeFileSync(resolve(output, "report.md"), `# Study Profile phone-width comparison\n\n| Test | main c7b3ca9 | Combined release |\n| --- | --- | --- |\n| Mobile pre-report screens at 320/360/390/430px | ${before?.state ?? "unavailable"} | ${after?.state ?? "unavailable"} |\n\nSame installed dependencies and browser, sequential source checkouts, no retries. Raw outcomes are retained in each result.json. Missing/setup results are unavailable, not red or green.\n`);
  // Existing ordinary-suite failures retain their original gating result.
  // This comparison independently blocks only a demonstrated new regression.
  if (before?.state === "pass" && after?.state === "fail") process.exitCode = 1;
}

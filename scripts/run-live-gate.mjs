import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, caseId, discoverLiveFiles, liveEnvironment, normalizeBrowserReport, publicError, redact, renderMarkdown, unavailableReason } from "./live-gate/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
if (args.some((value, index) => index % 2 === 0 && !["--runs", "--output"].includes(value)) || args.length % 2) throw new Error("Usage: node scripts/run-live-gate.mjs [--runs 1|3] [--output directory]");
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
const runs = Number(options["--runs"] ?? 1);
if (![1, 3].includes(runs)) throw new Error("--runs must be 1 or 3");
const output = resolve(options["--output"] ?? "test-results/live-gate");
mkdirSync(output, { recursive: true });
// Raw reports never enter the published artifact. Only redacted, structured
// errors, summaries, and logs are retained. No production server is contacted.
const scratch = mkdtempSync(resolve(tmpdir(), "yova-live-gate-"));
const files = discoverLiveFiles(root);
const env = liveEnvironment(root, files, process.env);
// These overrides apply only to the isolated local browser server.
delete env.YOVA_E2E_BASE_URL;
env.YOVA_E2E_PASSWORD_AUTH = "0";
let policy = { cases: {}, requiredCases: [] };
const cases = [];
let collected = [];
const metadata = { commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), startedAt: new Date().toISOString(), runs, files, environment: { node: process.version, providerConfigured: Boolean(env.OPENAI_API_KEY?.trim()), modelOverrides: Object.fromEntries(Object.entries(env).filter(([key]) => /^OPENAI_.*_MODEL$/.test(key))) } };
const save = () => {
  const unfinished = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const expected of collected) if (!cases.some((test) => test.id === expected.id && test.run === run)) {
      unfinished.push({ ...expected, run, state: "pending", errors: [{ message: "Full run has not reached this collected case" }] });
    }
  }
  const report = buildReport([...cases, ...unfinished], policy.cases, metadata);
  writeFileSync(resolve(output, "report.json"), redact(JSON.stringify(report, null, 2), env));
  writeFileSync(resolve(output, "report.md"), redact(renderMarkdown(report), env));
  return report;
};
const readJSON = (path) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const execute = (arguments_, childEnv, logName) => new Promise((done) => {
  let text = "";
  const child = spawn(process.execPath, arguments_, { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { text += chunk; });
  child.stderr.on("data", (chunk) => { text += chunk; });
  child.on("error", (error) => { text += error.message; });
  child.on("close", (code) => {
    writeFileSync(resolve(output, logName), redact(`${text}\nExit code: ${code}\n`, env));
    done(code ?? 1);
  });
});
const failure = (file, name, message, run, errors = []) => ({ id: caseId(file, name), file, name, state: "failed", run, errors: [{ message }, ...errors] });
const listFile = resolve(scratch, "collection.json");
try {
  policy = JSON.parse(readFileSync("scripts/live-gate/policy.json", "utf8"));
  if (!Array.isArray(policy.requiredCases) || !policy.cases) throw new Error("The audited gate policy is invalid");
  const missingDependencies = ["node_modules/vitest/vitest.mjs", "node_modules/@playwright/test/cli.js", "node_modules/next/dist/bin/next"].filter((file) => !existsSync(file));
  if (missingDependencies.length) {
    const error = new Error(`Dependencies unavailable: ${missingDependencies.join(", ")}. Install from the lockfile before running.`);
    error.code = "LIVE_ENV_UNAVAILABLE";
    throw error;
  }
  const listingCode = await execute(["node_modules/vitest/vitest.mjs", "list", ...files, `--json=${listFile}`], env, "collection.txt");
  collected = (readJSON(listFile) ?? []).map((test) => {
    const file = test.file.replace(`${root}/`, "");
    return { id: caseId(file, test.name), file, name: test.name, state: "pending" };
  });
  for (const file of files) if (!collected.some((test) => test.file === file)) cases.push(failure(file, "collection", "No runnable cases collected; opt-in/filter/import configuration must be checked", 0));
  if (listingCode !== 0) cases.push(failure("vitest", "collection", "Vitest collection failed; see collection.txt", 0));
  const browserOutput = resolve(scratch, "browser-list");
  mkdirSync(browserOutput);
  const browserEnv = { ...env, YOVA_LIVE_BROWSER_OUTPUT: browserOutput };
  const browserListCode = await execute(["node_modules/@playwright/test/cli.js", "test", "e2e/plan-launch-live.spec.ts", "--config", "playwright.live.config.ts", "--list"], browserEnv, "browser-collection.txt");
  const browserListing = readJSON(resolve(browserOutput, "browser.json"));
  const browserCases = browserListing ? normalizeBrowserReport(browserListing, root).cases : [];
  if (browserListCode !== 0 || browserCases.length !== 2) cases.push(failure("e2e/plan-launch-live.spec.ts", "collection", "Expected the desktop and mobile live browser journeys; see browser-collection.txt", 0));
  collected.push(...browserCases);
  for (const required of policy.requiredCases) if (!collected.some((test) => test.id === required.id)) {
    cases.push(failure(required.file, `${required.name} (required collection)`, "An audited live case disappeared from collection; restore it or document its deliberate replacement", 0));
  }
  save();
  for (let run = 1; run <= runs; run += 1) {
    if (!env.OPENAI_API_KEY?.trim()) {
      cases.push(...collected.map((test) => ({ ...test, run, unavailable: "OPENAI_API_KEY is missing; this case was not run" })));
      save();
      continue;
    }
    const runRoot = resolve(scratch, `run-${run}`);
    mkdirSync(runRoot);
    const runEnv = { ...env, YOVA_LIVE_FIXTURE_ROOT: resolve(runRoot, "fixtures") };
    for (const file of files) {
      console.log(`Live gate ${run}/${runs}: ${file}`);
      const name = file.split("/").at(-1).replace(".live.test.ts", "");
      const reportPath = resolve(runRoot, `${name}.json`);
      const code = await execute(["node_modules/vitest/vitest.mjs", "run", file, "--maxWorkers=1", "--retry=0", "--reporter=default", "--reporter=./scripts/live-gate/vitest-reporter.mjs"], { ...runEnv, YOVA_LIVE_REPORT: reportPath }, `run-${run}-${name}.txt`);
      const result = readJSON(reportPath);
      const setupUnavailable = unavailableReason(result?.errors);
      const actual = (result?.cases ?? []).map((test) => ({ ...test, ...(["pending", "skipped"].includes(test.state) && setupUnavailable ? { unavailable: setupUnavailable } : {}) }));
      cases.push(...actual.map((test) => ({ ...test, run, log: `run-${run}-${name}.txt` })));
      for (const expected of collected.filter((test) => test.file === file)) if (!actual.some((test) => test.id === expected.id)) cases.push({ ...failure(file, expected.name, "Collected case produced no result; see suite log", run), ...(setupUnavailable ? { unavailable: setupUnavailable } : {}) });
      if (result?.errors?.length) cases.push(failure(file, "suite error", "Suite/import/unhandled error; see suite log", run, result.errors.map((error) => publicError(error))));
      if (code !== 0 && actual.every((test) => test.state === "passed") && !result?.errors?.length) cases.push(failure(file, "runner exit", `Test process exited ${code} without a failed case`, run));
      save();
    }
    console.log(`Live gate ${run}/${runs}: desktop + mobile browser`);
    const browserRoot = resolve(runRoot, "browser");
    mkdirSync(browserRoot);
    const code = await execute(["node_modules/@playwright/test/cli.js", "test", "e2e/plan-launch-live.spec.ts", "--config", "playwright.live.config.ts"], { ...runEnv, YOVA_LIVE_BROWSER_OUTPUT: browserRoot }, `run-${run}-browser.txt`);
    const browserReport = readJSON(resolve(browserRoot, "browser.json"));
    const result = browserReport ? normalizeBrowserReport(browserReport, root) : { cases: [], errors: [] };
    const setupUnavailable = unavailableReason(result.errors);
    cases.push(...result.cases.map((test) => ({ ...test, run, log: `run-${run}-browser.txt`, ...(["pending", "skipped"].includes(test.state) && setupUnavailable ? { unavailable: setupUnavailable } : {}) })));
    for (const expected of browserCases) if (!result.cases.some((test) => test.id === expected.id)) cases.push({ ...failure(expected.file, expected.name, "Collected browser case produced no result", run), id: expected.id, project: expected.project, ...(setupUnavailable ? { unavailable: setupUnavailable } : {}) });
    if (result.errors.length || (code !== 0 && result.cases.every((test) => test.state === "passed"))) cases.push(failure("playwright", "browser runner", `Browser process exited ${code}; see browser log`, run, result.errors));
    for (const file of readdirSync(browserRoot, { recursive: true })) {
      if (!/[/\\](?:lesson-complete\.png|completion\.json|error-context\.md|test-failed-\d+\.png)$/.test(file)) continue;
      const destination = resolve(output, `run-${run}-browser-evidence`, file);
      mkdirSync(dirname(destination), { recursive: true });
      if (file.endsWith(".json") || file.endsWith(".md")) writeFileSync(destination, redact(readFileSync(resolve(browserRoot, file), "utf8"), env));
      else copyFileSync(resolve(browserRoot, file), destination);
    }
    save();
  }
} catch (error) {
  if (error.code === "LIVE_ENV_UNAVAILABLE") {
    cases.push({ ...failure("live-gate", "environment setup", error.message, 0), unavailable: error.message });
  } else cases.push(failure("live-gate", "runner", error.message, 0, [publicError(error)]));
} finally {
  metadata.finishedAt = new Date().toISOString();
  const report = save();
  console.log(`Live gate: ${JSON.stringify(report.counts)}. ${resolve(output, "report.md")}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exitCode = report.exitCode;
}

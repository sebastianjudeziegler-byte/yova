import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export function discoverLiveFiles(root) {
  return readdirSync(resolve(root, "src"), { recursive: true })
    .filter((file) => file.endsWith(".live.test.ts"))
    .map((file) => `src/${file.replaceAll("\\", "/")}`)
    .sort((a, b) => {
      const priority = (file) => file.endsWith("launch-session-journeys.live.test.ts") ? 0 : file.endsWith("launch-lesson-streams.live.test.ts") ? 1 : 2;
      return priority(a) - priority(b) || a.localeCompare(b);
    });
}

export function liveEnvironment(root, files, supplied) {
  const env = { ...supplied, YOVA_RUN_LIVE_BROWSER_CANARY: "1" };
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const flag of source.match(/YOVA_RUN_LIVE_[A-Z_]+/g) ?? []) env[flag] = "1";
    for (const flag of source.match(/YOVA_[A-Z_]*(?:EVAL_CASE|LAUNCH_CASE)/g) ?? []) env[flag] = "";
  }
  // Ambient filters/retries must never turn the full gate into a selected run.
  for (const key of Object.keys(env)) if (/^YOVA_.*(?:EVAL_CASE|LAUNCH_CASE)$/.test(key)) env[key] = "";
  for (const key of Object.keys(env)) if (/^YOVA_LIVE_.*_RUN_COUNT$/.test(key)) delete env[key];
  return env;
}

export function redact(text, env) {
  let result = String(text);
  for (const [name, value] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) && typeof value === "string" && value.length >= 8) result = result.replaceAll(value, "[REDACTED]");
  }
  return result;
}

export function publicError(error, depth = 0) {
  if (!error || depth > 5) return null;
  if (typeof error === "string") return { message: error.slice(0, 12000) };
  const result = {};
  for (const name of ["name", "message", "code", "status", "category", "reason", "validationIssueCode", "failedValidator", "repairDetail"]) {
    if (["string", "number"].includes(typeof error[name])) result[name] = typeof error[name] === "string" ? error[name].slice(0, 12000) : error[name];
  }
  for (const name of ["actual", "expected"]) {
    if (error[name] !== undefined) {
      try { result[name] = (typeof error[name] === "string" ? error[name] : JSON.stringify(error[name])).slice(0, 12000); }
      catch { result[name] = "[unserializable assertion value]"; }
    }
  }
  for (const name of ["cause", "providerError", "generationStats"]) {
    if (error[name]) result[name] = publicError(error[name], depth + 1);
  }
  return result;
}

export function unavailableReason(errors) {
  for (const error of errors ?? []) {
    if (!error) continue;
    if (typeof error.actual === "string") {
      try {
        const actual = JSON.parse(error.actual);
        if (Array.isArray(actual) && actual.length && actual.every((item) => item && typeof item.error === "string" && unavailableReason([{ message: item.error }]))) return "Every failed inner attempt was unavailable";
      } catch { /* Assertion prose is not provider telemetry. */ }
    }
    const nested = unavailableReason([error.providerError, error.cause, error.generationStats]);
    if (nested) return nested;
    if (["timeout", "rate_limit", "authentication", "permission", "connection", "provider_server_error", "aborted"].includes(error.category)) return `Provider unavailable: ${error.category}`;
    if ([401, 403, 408, 429, 500, 502, 503, 504].includes(error.status)) return `Provider unavailable: HTTP ${error.status}`;
    if (error.failedValidator === "session_provider_request" && /\((?:timeout|rate_limit|authentication|permission|connection|provider_server_error|aborted)\)|bounded provider deadline/.test(error.repairDetail ?? "")) return "Provider request could not complete (generation telemetry)";
    const text = `${error.name ?? ""} ${error.code ?? ""} ${error.message ?? ""}`;
    if (/APIConnectionTimeoutError|Request timed out\.|insufficient_quota|rate_limit_exceeded|ECONNRESET|ENOTFOUND|OpenAI is not configured|OPENAI_API_KEY.*(?:missing|required)/i.test(text)) return "Provider request could not run or complete";
    if (/ENOENT.*(?:yova-launch-regressions|live-ten-minute|live-gate.*fixtures)|Executable doesn't exist|browserType\.launch.*(?:not found|missing)/i.test(text)) return "Required test fixture or browser is unavailable";
    if (/EADDRINUSE|127\.0\.0\.1:3100 is already used/.test(text)) return "The isolated browser port is unavailable";
    // A locator timeout, invalid request/schema, or a generic test timeout is
    // not evidence of a provider outage and must remain a failing test.
  }
  return null;
}

export function caseId(file, name, project = "") {
  return `${file.replaceAll("\\", "/")}::${project ? `${project}::` : ""}${name}`;
}

export function normalizeBrowserReport(report, root) {
  const cases = [];
  const visit = (suite, parents = []) => {
    const parentNames = suite.file && suite.title === suite.file ? parents : suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const file = spec.file.startsWith(root) ? relative(root, spec.file) : spec.file.startsWith("e2e/") ? spec.file : `e2e/${spec.file}`;
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1);
        const name = [...parentNames.filter((name) => name !== spec.file && !name.endsWith(".spec.ts")), spec.title].join(" > ");
        cases.push({ id: caseId(file, name, test.projectName), file, name, project: test.projectName, state: result?.status === "passed" ? "passed" : result?.status === "skipped" ? "skipped" : result ? "failed" : "pending", errors: (result?.errors ?? []).map((error) => publicError(error)), durationMs: result?.duration ?? 0 });
      }
    }
    for (const child of suite.suites ?? []) visit(child, parentNames);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return { cases, errors: (report.errors ?? []).map((error) => publicError(error)) };
}

export function classifyResult(test, policies) {
  const policy = policies[test.id];
  const unavailable = test.unavailable ?? unavailableReason(test.errors);
  const details = test.errors?.map((error) => [error?.message, error?.actual ? `Received: ${error.actual}` : null, error?.expected ? `Expected: ${error.expected}` : null].filter(Boolean).join(" ")).filter(Boolean).join("; ") || "";
  if (unavailable) return { ...test, status: "unavailable", detail: unavailable, classification: policy?.classification ?? null };
  if (test.state === "skipped" || test.state === "pending") return { ...test, status: "fail", detail: "The full live gate did not execute this collected case", classification: policy?.classification ?? null };
  if (policy?.classification === "FLAKY") return { ...test, status: "flaky", detail: `${test.state}; baseline ${policy.passRate}. ${details}`, classification: "FLAKY" };
  return { ...test, status: test.state === "passed" ? "pass" : "fail", detail: details, classification: policy?.classification ?? null };
}

export function buildReport(cases, policies, metadata) {
  const rows = cases.map((test) => classifyResult(test, policies));
  const counts = { pass: 0, fail: 0, flaky: 0, unavailable: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { version: 1, ...metadata, counts, exitCode: counts.fail ? 1 : 0, rows };
}

export function renderMarkdown(report) {
  const escape = (text) => String(text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
  const title = report.counts.fail ? "BLOCKED — live failures" : report.counts.unavailable ? "NON-BLOCKING — includes unavailable results" : "No gating live failures";
  return [
    `# Live gate: ${title}`, "",
    `Commit: ${report.commit ?? "unknown"}. Runs: ${report.runs ?? 1}. All files execute serially; quarantined flaky tests still execute.`, "",
    `Pass: **${report.counts.pass}** · Fail: **${report.counts.fail}** · Flaky: **${report.counts.flaky}** · Unavailable: **${report.counts.unavailable}**`, "",
    "Flaky and unavailable rows do not block. An unavailable result is neither a pass nor a semantic failure. Unknown failures and unexpected skips block.", "",
    "| Test | Run | Result | Triage | Evidence |", "| --- | --- | --- | --- | --- |",
    ...report.rows.map((row) => `| ${escape(row.file)} — ${escape(row.name)}${row.project ? ` (${escape(row.project)})` : ""} | ${row.run ?? 1} | ${row.status.toUpperCase()} | ${row.classification ?? "unclassified"} | ${escape((row.detail || row.state).slice(0, 500))}${row.log ? ` [log](${row.log})` : ""} |`), "",
  ].join("\n");
}

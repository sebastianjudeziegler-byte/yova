import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const example = { id: "case", file: "src/evals/example.live.test.ts", name: "Learner can complete the lesson", state: "failed", errors: [{ message: "Expected SESSION COMPLETE; saw a retry error" }] };
test("REAL, STALE, and new semantic failures block; audited flakes still execute and report their result", async () => {
  const { buildReport, renderMarkdown } = await import("./core.mjs");
  for (const classification of ["REAL", "STALE", undefined]) {
    const report = buildReport([{ ...example, log: "run-1-example.txt" }], classification ? { case: { classification } } : {}, {});
    assert.equal(report.exitCode, 1);
    assert.equal(report.rows[0].status, "fail");
    assert.match(renderMarkdown(report), /Expected SESSION COMPLETE/);
    assert.match(renderMarkdown(report), /\[log\]\(run-1-example\.txt\)/);
  }
  const report = buildReport([example, { ...example, state: "passed", errors: [] }], { case: { classification: "FLAKY", passRate: "1/3" } }, {});
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.counts, { pass: 0, fail: 0, flaky: 2, unavailable: 0 });
  assert.match(renderMarkdown(report), /failed; baseline 1\/3/);
  assert.match(renderMarkdown(report), /passed; baseline 1\/3/);
});
test("provider timeouts/quota and missing keys are neither red nor green, even for a quarantined case", async () => {
  const { buildReport, publicError, renderMarkdown } = await import("./core.mjs");
  assert.equal(buildReport([{ ...example, state: "pending", unavailable: "OPENAI_API_KEY is missing" }], {}, {}).rows[0].status, "unavailable");
  const errors = [
    { message: "The OpenAI request failed", cause: { name: "APIConnectionTimeoutError", message: "Request timed out." } },
    { message: "Generation failed", providerError: { category: "rate_limit", status: 429 } },
    { message: "Missing OPENAI_API_KEY is required" },
    { message: "http://127.0.0.1:3100 is already used" },
    { message: "Expected no failed inner attempts", actual: [{ run: 1, error: "APIConnectionTimeoutError: Request timed out." }] },
    { message: "Source unavailable", generationStats: { failedValidator: "session_provider_request", repairDetail: "The lesson-structure request failed before YOVA received a usable response (timeout)." } },
    { message: "ENOENT: open '/tmp/yova-live-gate-123/run-1/fixtures/deadline/live-ten-minute.json'" },
  ];
  for (const error of errors) {
    const report = buildReport([{ ...example, errors: [publicError(error)] }], { case: { classification: "FLAKY", passRate: "1/3" } }, {});
    assert.equal(report.rows[0].status, "unavailable");
    assert.equal(report.exitCode, 0);
    assert.equal(report.counts.pass, 0);
    assert.match(renderMarkdown(report), /neither a pass nor a semantic failure/);
  }
});
test("UI timeouts, invalid schemas, and unexecuted cases cannot hide as provider outages or flakes", async () => {
  const { buildReport } = await import("./core.mjs");
  for (const error of [{ message: "locator.click: Timeout 60000ms exceeded" }, { message: "Test timed out in 120000ms" }, { status: 400, category: "invalid_request", message: "Invalid response schema" }]) {
    assert.equal(buildReport([{ ...example, errors: [error] }], {}, {}).exitCode, 1);
  }
  for (const state of ["skipped", "pending"]) assert.equal(buildReport([{ ...example, state }], { case: { classification: "FLAKY" } }, {}).exitCode, 1);
});
test("a mixed batch cannot hide a semantic defect behind another attempt's outage", async () => {
  const { buildReport, publicError, renderMarkdown } = await import("./core.mjs");
  const error = publicError({ message: "Expected no failed attempts", actual: [{ run: 1, error: "Request timed out." }, { run: 2, error: "The lesson contains no usable explanation" }], expected: [] });
  const report = buildReport([{ ...example, errors: [error] }], {}, {});
  assert.equal(report.exitCode, 1);
  assert.match(renderMarkdown(report), /no usable explanation/);
});
test("a recovered REAL case is green without changing its classification", async () => {
  const { buildReport } = await import("./core.mjs");
  const report = buildReport([{ ...example, state: "passed", errors: [] }], { case: { classification: "REAL" } }, {});
  assert.equal(report.exitCode, 0);
  assert.equal(report.rows[0].classification, "REAL");
  assert.equal(report.rows[0].status, "pass");
});
test("full discovery includes future canaries and runs the launch producer before its consumer", async () => {
  const { discoverLiveFiles, liveEnvironment } = await import("./core.mjs");
  const root = mkdtempSync(resolve(tmpdir(), "yova-gate-discovery-"));
  try {
    mkdirSync(resolve(root, "src/evals"), { recursive: true });
    for (const name of ["future", "launch-lesson-streams", "launch-session-journeys"]) writeFileSync(resolve(root, `src/evals/${name}.live.test.ts`), 'process.env.YOVA_RUN_LIVE_FUTURE_EVALS; process.env.YOVA_FUTURE_EVAL_CASE;');
    writeFileSync(resolve(root, "src/evals/ordinary.test.ts"), "");
    const files = discoverLiveFiles(root);
    assert.deepEqual(files.map((file) => file.split("/").at(-1)), ["launch-session-journeys.live.test.ts", "launch-lesson-streams.live.test.ts", "future.live.test.ts"]);
    const env = liveEnvironment(root, files, { OPENAI_API_KEY: "test-key", YOVA_FUTURE_EVAL_CASE: "one", YOVA_LAUNCH_CASE: "calculus", YOVA_RUN_LIVE_FUTURE_EVALS: "0" });
    assert.equal(env.YOVA_RUN_LIVE_FUTURE_EVALS, "1");
    assert.equal(env.YOVA_RUN_LIVE_BROWSER_CANARY, "1");
    assert.equal(env.YOVA_FUTURE_EVAL_CASE, "");
    assert.equal(env.YOVA_LAUNCH_CASE, "");
    assert.equal(env.OPENAI_API_KEY, "test-key");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("desktop and mobile stay separate in the artifact and retain visible failure reasons", async () => {
  const { normalizeBrowserReport, caseId, renderMarkdown, buildReport } = await import("./core.mjs");
  const report = { suites: [{ file: "plan-launch-live.spec.ts", title: "plan-launch-live.spec.ts", specs: [{ file: "plan-launch-live.spec.ts", title: "finishes unrated", tests: [
    { projectName: "desktop-chromium", results: [{ status: "passed", duration: 17 }] },
    { projectName: "mobile-chromium", results: [{ status: "timedOut", errors: [{ message: "I got the key idea button missing" }] }] },
  ] }] }] };
  const result = normalizeBrowserReport(report, "/repo");
  assert.equal(result.cases.length, 2);
  assert.equal(result.cases[0].id, caseId("e2e/plan-launch-live.spec.ts", "finishes unrated", "desktop-chromium"));
  assert.equal(result.cases[0].state, "passed");
  assert.equal(result.cases[1].state, "failed");
  assert.match(renderMarkdown(buildReport(result.cases, {}, {})), /I got the key idea button missing/);
});
test("published errors retain provider classification without credentials, headers, or request bodies", async () => {
  const { publicError, redact } = await import("./core.mjs");
  const error = publicError({ name: "Error", message: "bad request", headers: { authorization: "secret-value" }, request: { learner: "private" }, providerError: { category: "timeout" } });
  assert.deepEqual(error, { name: "Error", message: "bad request", providerError: { category: "timeout" } });
  assert.equal(redact("api-secret-value and token-secret-value", { OPENAI_API_KEY: "api-secret-value", GITHUB_TOKEN: "token-secret-value" }), "[REDACTED] and [REDACTED]");
});

test("Vitest's already-serialized batch errors retain provider-unavailable accounting", async () => {
  const { publicError, buildReport } = await import("./core.mjs");
  const error = publicError({
    message: "Expected no failed inner attempts",
    actual: JSON.stringify([{ run: 1, error: "APIConnectionTimeoutError: Request timed out." }]),
    expected: "[]",
  });
  const report = buildReport([{ ...example, errors: [error] }], {}, {});
  assert.deepEqual(report.counts, { pass: 0, fail: 0, flaky: 0, unavailable: 1 });
  assert.equal(report.exitCode, 0);
});

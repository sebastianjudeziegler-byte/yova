import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// These checks run in the ordinary gate as well as before a live run. They
// protect the full-suite entry point and the CI path without spending API calls.
test("one documented command invokes the full live runner", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["test:live"], "node scripts/run-live-gate.mjs");
  assert.ok(existsSync("scripts/run-live-gate.mjs"));
});
test("CI runs the full set nightly and accepts an explicit PR revision without exposing fork credentials", () => {
  assert.ok(existsSync(".github/workflows/live-gate.yml"), "The complete live set needs its own scheduled workflow");
  const workflow = readFileSync(".github/workflows/live-gate.yml", "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pr\.head\.repo\?\.full_name/);
  assert.match(workflow, /core\.setOutput\('sha', pr\.head\.sha\)/);
  assert.match(workflow, /run: pnpm test:live\n/);
  assert.match(workflow, /path: test-results\/live-gate/);
  assert.match(workflow, /createCommitStatus/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});

test("the audit pins all original canaries so deletion cannot silently shrink the full gate", () => {
  assert.ok(existsSync("scripts/live-gate/policy.json"));
  const policy = JSON.parse(readFileSync("scripts/live-gate/policy.json", "utf8"));
  assert.equal(policy.baselineCommit, "e03a082659f51172c0b06bf84daffdd5599ac773");
  assert.equal(policy.requiredCases.length, 75);
  assert.equal(policy.requiredCases.filter(test => test.file !== "src/evals/grader-calibration.live.test.ts").length, 66);
  assert.equal(policy.requiredCases.filter(test => test.file === "src/evals/grader-calibration.live.test.ts").length, 9);
  assert.equal(new Set(policy.requiredCases.map((test) => test.id)).size, 75);
  assert.equal(policy.requiredCases.filter((test) => test.file.startsWith("e2e/")).length, 2);
  for (const entry of policy.requiredCases) assert.ok(existsSync(entry.file), entry.file);
});

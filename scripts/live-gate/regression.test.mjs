import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalBrowserCaseName, classifyComparisonOutcome, compareLiveReports, isProviderFailureDetail } from "./regression.mjs";
const report = states => ({ exitCode: states.includes("fail") ? 1 : 0, rows: states.map(status => ({ id: "case", status, state: status === "pass" ? "passed" : "failed" })) });
test("the documented draft-placement rename retains its comparison identity without hiding other missing cases", () => {
  const oldName = "map revision cannot activate a stale draft and fresh placement uses the revised map";
  const newName = "map revision cannot activate a stale draft and reviewed starting level preserves placement";
  assert.equal(canonicalBrowserCaseName(oldName), canonicalBrowserCaseName(newName));
  const before = { rows: [{ id: canonicalBrowserCaseName(oldName), state: "passed", status: "pass" }] };
  const after = { rows: [{ id: canonicalBrowserCaseName(newName), state: "passed", status: "pass" }] };
  assert.equal(compareLiveReports(before, after).exitCode, 0);
  assert.equal(compareLiveReports(before, { rows: [{ id: "some other test", state: "passed", status: "pass" }] }).exitCode, 1);
});
test("the release gate reports an unchanged main defect without blocking", () => {
  assert.equal(compareLiveReports(report(["fail"]), report(["fail"])).exitCode, 0);
});
test("a new pass-to-fail regression blocks even when other failures are pre-existing", () => {
  assert.equal(compareLiveReports(report(["pass"]), report(["fail"])).exitCode, 1);
});
test("a scoped fix with a lower pass rate blocks; an improvement does not", () => {
  assert.equal(compareLiveReports(report(["pass", "pass", "fail"]), report(["pass", "fail", "fail"]), { scoped: ["case"] }).exitCode, 1);
  assert.equal(compareLiveReports(report(["fail", "fail", "fail"]), report(["pass", "pass", "fail"]), { scoped: ["case"] }).exitCode, 0);
});
test("provider unavailability is neither a pass nor a semantic regression", () => {
  assert.equal(compareLiveReports(report(["pass"]), report(["unavailable"])).exitCode, 0);
});
test("an established quarantine cannot conceal a scoped regression or an omitted case", () => {
  assert.equal(compareLiveReports(report(["pass"]), report(["flaky"]), { quarantined: ["case"], scoped: ["case"] }).exitCode, 1);
  assert.equal(compareLiveReports(report(["pass"]), { exitCode: 0, rows: [] }).exitCode, 1);
});
test("a clean sample with no regression passes", () => {
  const result = classifyComparisonOutcome({ counts: { pass: 51, fail: 5, flaky: 20, unavailable: 1 }, regressions: [] });
  assert.equal(result.outcome, "passed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.blocks, false);
});
test("a regression on a usable sample blocks for investigation", () => {
  const result = classifyComparisonOutcome({
    counts: { pass: 51, fail: 5, flaky: 20, unavailable: 1 },
    regressions: [{ id: "case", detail: "expected 2 essential ideas, received 1" }],
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.exitCode, 1);
  assert.equal(result.blocks, true);
});
test("a degraded provider makes the sample inconclusive, with or without regressions, and never green", () => {
  // Run 34573759685: 14 of 77 unavailable while the provider returned 500s.
  const counts = { pass: 39, fail: 9, flaky: 15, unavailable: 14 };
  const withRegressions = classifyComparisonOutcome({ counts, regressions: [{ id: "case", detail: "expected 0 to be greater than 100" }] });
  assert.equal(withRegressions.outcome, "inconclusive");
  assert.equal(withRegressions.exitCode, 2);
  assert.equal(withRegressions.blocks, true);
  // "No case flipped" is a weak claim when a chunk of the set never ran.
  const clean = classifyComparisonOutcome({ counts, regressions: [] });
  assert.equal(clean.outcome, "inconclusive");
  assert.equal(clean.blocks, true);
  assert.notEqual(clean.exitCode, 0);
});
test("an explicit provider error on a blocking case is inconclusive even when the set is healthy", () => {
  const counts = { pass: 60, fail: 5, flaky: 11, unavailable: 1 };
  for (const detail of ["Provider unavailable: HTTP 503", "provider_server_error", "The lesson stream could not be completed.", "connect ECONNRESET"]) {
    const result = classifyComparisonOutcome({ counts, regressions: [{ id: "case", detail }] });
    assert.equal(result.outcome, "inconclusive", detail);
    assert.equal(result.blocks, true, detail);
  }
});
test("a validator rejection is not mistaken for provider noise", () => {
  // This prefix also fronts content rejections, so it must not excuse them.
  const detail = "OpenAI did not return a complete streamed teaching skeleton after 1 repair attempt. The compact teaching recovery did not pass the complete session validator (streamed_lesson_scope: this lesson needs 2 distinct explanatory claims).";
  assert.equal(isProviderFailureDetail(detail), false);
  const result = classifyComparisonOutcome({ counts: { pass: 60, fail: 5, flaky: 11, unavailable: 1 }, regressions: [{ id: "case", detail }] });
  assert.equal(result.outcome, "blocked");
});
test("no outcome that blocks can report a zero exit code", () => {
  const samples = [
    { counts: { pass: 10, fail: 0, flaky: 0, unavailable: 0 }, regressions: [] },
    { counts: { pass: 10, fail: 0, flaky: 0, unavailable: 0 }, regressions: [{ id: "a", detail: "assertion failed" }] },
    { counts: { pass: 10, fail: 0, flaky: 0, unavailable: 9 }, regressions: [] },
    { counts: { pass: 10, fail: 0, flaky: 0, unavailable: 0 }, regressions: [{ id: "a", detail: "Provider unavailable: timeout is not matched, HTTP 502 is" }] },
    { counts: {}, regressions: [] },
  ];
  for (const sample of samples) {
    const result = classifyComparisonOutcome(sample);
    assert.equal(result.blocks, result.exitCode !== 0, JSON.stringify(sample));
    assert.ok(["passed", "blocked", "inconclusive"].includes(result.outcome));
  }
});

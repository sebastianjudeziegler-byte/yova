import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLiveReports } from "./regression.mjs";
const report = states => ({ exitCode: states.includes("fail") ? 1 : 0, rows: states.map(status => ({ id: "case", status, state: status === "pass" ? "passed" : "failed" })) });
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

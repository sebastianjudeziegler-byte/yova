// Compares one full run against the retained exact-main evidence and blocks
// on a regression, which the standing rules make the only live-gate condition
// that blocks a merge. Runs for every ref; the scoped lists below remain the
// stricter per-case rules recorded during Brief B.
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalBrowserCaseName, classifyComparisonOutcome, compareLiveReports } from "./live-gate/regression.mjs";
import { normalizeBrowserReport } from "./live-gate/core.mjs";
if (!process.env.GITHUB_ACTIONS) throw new Error("Release comparison runs only in GitHub Actions.");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const baseline = "docs/audits/brief-b/evidence";
const main = read(`${baseline}/main-live/report.json`);
if (main.commit !== "c7b3ca99964524cefc04437b7236b37fe8fe2666") throw new Error("Unexpected main baseline revision.");
const after = read("test-results/live-gate/report.json");
const policy = read("scripts/live-gate/policy.json");
const live = compareLiveReports(main, after, {
  scoped: after.rows.filter(row => row.id.includes("History essay using outside sources") && row.file.includes("plan-session-journey") || row.file.includes("personalization-delta")).map(row => row.id),
  quarantined: Object.entries(policy.cases).filter(([, value]) => value.classification === "FLAKY").map(([id]) => id),
});
const mainBrowser = read(`${baseline}/main-browser-baseline.json`);
const raw = read("artifacts/quality/browser.json");
const normalized = normalizeBrowserReport(raw, process.cwd());
const key = row => `${row.file.replace(/^e2e\//, "")}::${row.project}::${canonicalBrowserCaseName(row.name.replaceAll(" › ", " > "))}`;
const runs = [];
function flatten(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) runs.push(test.results ?? []);
    flatten(suite.suites);
  }
}
flatten(raw.suites);
const observed = normalized.cases.flatMap((row, index) => (runs[index]?.length ? runs[index] : [{ status: "pending" }]).map(result => ({
  ...row, id: key(row), state: result.status === "passed" ? "passed" : result.status === "skipped" ? "skipped" : result.status === "pending" ? "pending" : "failed",
  status: result.status === "passed" ? "pass" : "fail",
}))).filter(row => row.state !== "skipped");
const scopedBrowser = normalized.cases.filter(row => row.file.includes("living-plan") || /visibly shortened inside recipe|10-minute outside teaching-first session|overdue outside teaching-first session|overdue arbitrary inside session|scheduled-review setup stays fixed|shorter sessions preserve weekly availability/.test(row.name)).map(key);
const browserFlakes = normalized.cases.filter((_row, index) => runs[index].some(result => result.status === "passed") && runs[index].some(result => ["failed", "timedOut"].includes(result.status))).map(key);
const browser = compareLiveReports({ rows: mainBrowser.rows.map(row => ({ ...row, id: key(row), state: "passed" })) }, { rows: observed }, {
  scoped: scopedBrowser,
  quarantined: [...browserFlakes,
    // Explicitly pre-existing in the brief and reproduced on main e03a082.
    "calendar-journeys.spec.ts::desktop-chromium::two simultaneous tabs preserve both new events and each tab refreshes"],
});
if (normalized.errors.length) browser.regressions.push({ id: "browser-runner", reason: JSON.stringify(normalized.errors) });
const rows = [...live.rows.map(row => ({ ...row, suite: "live" })), ...browser.rows.map(row => ({ ...row, suite: "browser" }))];
// Carry each live regression's own failure text so the outcome can tell a
// provider outage apart from a branch defect.
const liveDetail = new Map((after.rows ?? []).map(row => [row.id, row.detail ?? ""]));
const failures = [
  ...live.regressions.map(row => ({ ...row, suite: "live", detail: liveDetail.get(row.id) ?? "" })),
  ...browser.regressions.map(row => ({ ...row, suite: "browser", detail: row.reason ?? "" })),
];
const verdict = classifyComparisonOutcome({ counts: after.counts, regressions: failures });
const output = { mainCommit: main.commit, branchCommit: after.commit, liveCounts: after.counts, browserFlakes, outcome: verdict.outcome, outcomeReason: verdict.reason, regressions: failures, rows };
writeFileSync("artifacts/quality/regression-comparison.json", JSON.stringify(output, null, 2));
const rate = row => `${row.passes} pass / ${row.failures} fail / ${row.unavailable} unavailable`;
const escape = text => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const heading = { passed: "No regressions versus main", blocked: "BLOCKED — regression versus main", inconclusive: "INCONCLUSIVE — re-run the gate" }[verdict.outcome];
writeFileSync("artifacts/quality/regression-comparison.md", [
  `# Release comparison: ${heading}`, "",
  verdict.reason, "",
  `Main ${main.commit}; branch ${after.commit}. Raw live counts: ${JSON.stringify(after.counts)}.`, "",
  ...(verdict.outcome === "inconclusive" ? ["Inconclusive blocks the merge exactly as a regression does. It reports that this sample cannot answer the question, not that the branch is clean.", ""] : []),
  ...(verdict.providerBlocked.length ? [`Blocking cases whose own failure text shows a provider error: ${verdict.providerBlocked.length}.`, ""] : []),
  "| Case | Main | Branch | Disposition |", "| --- | --- | --- | --- |",
  ...rows.filter(row => row.blocks || row.main.failures || row.branch.failures || row.branch.unavailable).map(row => `| ${escape(row.id)} | ${rate(row.main)} | ${rate(row.branch)} | ${escape(row.reason)} |`), "",
].join("\n"));
// passed 0, blocked 1, inconclusive 2. Only passed is green.
process.exitCode = verdict.exitCode;

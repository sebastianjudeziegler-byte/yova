// Compares one full run against the retained exact-main evidence and blocks
// on a regression, which the standing rules make the only live-gate condition
// that blocks a merge. Runs for every ref; the scoped lists below remain the
// stricter per-case rules recorded during Brief B.
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalBrowserCaseName, classifyComparisonOutcome, compareLiveReports } from "./live-gate/regression.mjs";
import { normalizeBrowserReport } from "./live-gate/core.mjs";
if (!process.env.GITHUB_ACTIONS) throw new Error("Release comparison runs only in GitHub Actions.");
const read = path => JSON.parse(readFileSync(path, "utf8"));
// Retained main: run 35251019423 on 0ce2292 (2026-09-17), main's own full run.
// Its live half is that run's full-live-gate artifact; its browser half is the
// same run's core-journey step log, parsed case by case (the alternative was a
// 196 MB artifact for the same pass/fail list). The previous baseline, run
// 35098660639 on 00995f1, stays in docs/audits/brief-b/evidence for history:
// it predated Brief 2's rewritten intake and scheduling titles, so most of its
// cases no longer exist under those names. Refresh this one when main has
// moved far enough that the sample no longer reflects main's current tests.
const baseline = "docs/audits/plan-session-launch/main-baseline-413";
const main = read(`${baseline}/main-live/report.json`);
if (main.commit !== "0ce2292b71f7ca53a5978d637280e71d913debb7") throw new Error("Unexpected main baseline revision.");
const after = read("test-results/live-gate/report.json");
const policy = read("scripts/live-gate/policy.json");
// Cases removed on purpose with the feature they tested; absence alone is
// excused. Renamed cases are listed separately with their replacement, so the
// table says which happened instead of reporting both as an absence.
const retirement = read("scripts/live-gate/retired-cases.json");
const retiredCases = retirement.cases;
const renamedCases = retirement.renamed?.cases ?? [];
const matches = (entries, file, name) => entries.some(entry => file.replace(/^e2e\//, "") === entry.file && name === entry.name);
const isRetired = (file, name) => matches(retiredCases, file, name);
const isRenamed = (file, name) => matches(renamedCases, file, name);
for (const entry of renamedCases) {
  if (matches(retiredCases, entry.file, entry.name)) throw new Error(`A case is listed as both retired and renamed: ${entry.file} ${entry.name}`);
  if (!entry.replacedBy) throw new Error(`A renamed case must name its replacement: ${entry.file} ${entry.name}`);
}
const liveIds = (predicate) => main.rows.filter(row => { const [file, , name] = row.id.split("::"); return name !== undefined && predicate(file, name); }).map(row => row.id);
const retiredLive = liveIds(isRetired);
const live = compareLiveReports(main, after, {
  retired: retiredLive,
  renamed: liveIds(isRenamed),
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
// Main's own failures are retained with their outcome, so a case that fails
// on both sides reads as pre-existing instead of as this branch's regression.
const browser = compareLiveReports({ rows: mainBrowser.rows.map(row => ({ ...row, id: key(row), state: row.status === "fail" ? "failed" : "passed" })) }, { rows: observed }, {
  retired: mainBrowser.rows.filter(row => isRetired(row.file, row.name)).map(key),
  renamed: mainBrowser.rows.filter(row => isRenamed(row.file, row.name)).map(key),
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

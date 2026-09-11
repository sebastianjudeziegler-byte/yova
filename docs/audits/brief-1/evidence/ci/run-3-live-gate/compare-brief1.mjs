// Brief 1: row-by-row live-gate comparison against the retained main baseline.
// Uses the repository's own comparator so the verdict matches what
// compare-release-ci.mjs would produce, rather than a fresh interpretation.
import { readFileSync } from "node:fs";
import { compareLiveReports } from "/private/tmp/yova-baseline-sessions-routing/scripts/live-gate/regression.mjs";

const repo = "/private/tmp/yova-baseline-sessions-routing";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const main = read(`${repo}/docs/audits/brief-b/evidence/main-live/report.json`);
const branch = read(process.argv[2]);
const policy = read(`${repo}/scripts/live-gate/policy.json`);

const quarantined = Object.entries(policy.cases)
  .filter(([, value]) => value.classification === "FLAKY")
  .map(([id]) => id);

const result = compareLiveReports(main, branch, { quarantined });

const rate = (row) => `${row.passes}P/${row.failures}F/${row.unavailable}U`;
console.log(`main    ${main.commit} counts=${JSON.stringify(main.counts)}`);
console.log(`branch  ${branch.commit} counts=${JSON.stringify(branch.counts)}`);
console.log(`quarantined (FLAKY in policy): ${quarantined.length}`);
console.log(`\nBLOCKING REGRESSIONS: ${result.regressions.length}`);
for (const row of result.regressions) {
  console.log(`  [${row.reason}] ${row.id}`);
  console.log(`      main ${rate(row.main)} -> branch ${rate(row.branch)}`);
}

const failing = result.rows.filter((row) => row.branch.failures > 0 && !row.blocks);
console.log(`\nNon-blocking failures on the branch: ${failing.length}`);
for (const row of failing) {
  console.log(`  [${row.reason}] ${row.id.slice(0, 110)}`);
  console.log(`      main ${rate(row.main)} -> branch ${rate(row.branch)}`);
}

const notRun = result.rows.filter((row) => row.blocks && row.reason === "Required case was not executed");
console.log(`\nRequired-but-not-executed: ${notRun.length}`);

// Cases present on the branch that main never had, and vice versa.
const mainIds = new Set((main.rows ?? []).map((row) => row.id));
const branchIds = new Set((branch.rows ?? []).map((row) => row.id));
console.log(`\nOnly on branch: ${[...branchIds].filter((id) => !mainIds.has(id)).length}`);
for (const id of [...branchIds].filter((x) => !mainIds.has(x))) console.log(`  + ${id.slice(0, 110)}`);
console.log(`Only on main: ${[...mainIds].filter((id) => !branchIds.has(id)).length}`);
for (const id of [...mainIds].filter((x) => !branchIds.has(x))) console.log(`  - ${id.slice(0, 110)}`);

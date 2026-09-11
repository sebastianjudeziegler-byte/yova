// Would enabling the regression gate block on a stale browser baseline?
// Uses the repository's own normalizeBrowserReport so case ids are built
// exactly as compare-release-ci.mjs builds them.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { normalizeBrowserReport } from "/private/tmp/yova-baseline-sessions-routing/scripts/live-gate/core.mjs";
import { canonicalBrowserCaseName } from "/private/tmp/yova-baseline-sessions-routing/scripts/live-gate/regression.mjs";

const repo = "/private/tmp/yova-baseline-sessions-routing";
const baseline = JSON.parse(readFileSync(`${repo}/docs/audits/brief-b/evidence/main-browser-baseline.json`, "utf8"));
const key = (row) => `${row.file.replace(/^e2e\//, "")}::${row.project}::${canonicalBrowserCaseName(row.name.replaceAll(" › ", " > "))}`;

const listed = JSON.parse(execFileSync("node", [
  "node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json",
], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

const current = new Set(normalizeBrowserReport(listed, repo).cases.map(key));
const baselineIds = baseline.rows.map(key);
const missing = baselineIds.filter((id) => !current.has(id));
const added = [...current].filter((id) => !baselineIds.includes(id));

console.log(`retained baseline cases: ${baselineIds.length}`);
console.log(`cases the current config runs: ${current.size}`);
console.log(`\nIn baseline but NOT run now — these BLOCK as "Required case was not executed": ${missing.length}`);
for (const id of missing) console.log(`  - ${id}`);
console.log(`\nRun now but absent from the baseline — do not block while they pass: ${added.length}`);
for (const id of added.slice(0, 10)) console.log(`  + ${id}`);
if (added.length > 10) console.log(`  … ${added.length - 10} more`);

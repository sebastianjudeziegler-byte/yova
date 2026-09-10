// Baseline implementation retained for the CI red replay.
export function compareLiveReports(_before, after) {
  return { exitCode: after.exitCode, rows: [], regressions: after.exitCode ? ["raw-live-failure"] : [] };
}

// Brief B replaced repeated placement with the specified evidence-preserving
// preview. The same stale-activation test was renamed (EVIDENCE.md); no general
// fuzzy matching is allowed because that could conceal an omitted case.
export function canonicalBrowserCaseName(name) {
  return name === "map revision cannot activate a stale draft and fresh placement uses the revised map"
    ? "map revision cannot activate a stale draft and reviewed starting level preserves placement"
    : name;
}

/** Compare recorded observations; never relabel a failure as a passing run. */
export function compareLiveReports(before, after, { scoped = [], quarantined = [] } = {}) {
  const group = report => {
    const groups = new Map();
    for (const row of report.rows ?? []) groups.set(row.id, [...(groups.get(row.id) ?? []), row]);
    return groups;
  };
  const main = group(before), branch = group(after);
  const summarize = samples => {
    const available = samples.filter(row => row.status !== "unavailable");
    const passes = available.filter(row => row.state === "passed").length;
    return { passes, failures: available.length - passes, unavailable: samples.length - available.length, total: samples.length };
  };
  const rows = [...new Set([...main.keys(), ...branch.keys()])].map(id => {
    const previous = main.get(id) ?? [], current = branch.get(id) ?? [];
    const a = summarize(previous), b = summarize(current);
    let reason = "No regression";
    let blocks = false;
    if (!current.length || current.some(row => ["skipped", "pending"].includes(row.state))) {
      reason = "Required case was not executed"; blocks = true;
    } else if (b.failures) {
      if (quarantined.includes(id) && !scoped.includes(id)) reason = "Established flaky quarantine; raw outcomes retained";
      else if (!previous.length || (a.passes > 0 && a.failures === 0)) { reason = "New failure versus passing main"; blocks = true; }
      else if (scoped.includes(id) && a.passes / (a.passes + a.failures) > b.passes / (b.passes + b.failures)) { reason = "Scoped case passes fewer available samples than main"; blocks = true; }
      else reason = "Pre-existing or improved failure; no product fix claimed";
    } else if (b.unavailable) reason = "Unavailable samples are neither red nor green";
    return { id, main: a, branch: b, blocks, reason };
  });
  const regressions = rows.filter(row => row.blocks);
  return { exitCode: regressions.length ? 1 : 0, rows, regressions };
}

/**
 * Share of the live set that may be unavailable before the comparison stops
 * being usable evidence. A healthy run sits near zero; run 34573759685 had
 * 14 of 77 unavailable while the provider returned 500s and 503s.
 */
export const PROVIDER_DEGRADED_UNAVAILABLE_RATIO = 0.1;

/**
 * Unambiguous transport and availability signals only.
 *
 * Deliberately narrow. "OpenAI did not return a complete …" is excluded
 * because that prefix also fronts validator rejections, where the provider
 * answered and the content failed a check. Treating those as provider noise
 * would let a real content regression be waved through as "re-run".
 */
const PROVIDER_FAILURE_PATTERNS = [
  /provider unavailable/i,
  /provider_server_error/i,
  /provider request could not run/i,
  /\bHTTP 5\d\d\b/,
  /\b(ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)\b/,
  /\boverloaded\b/i,
  /\brate limit(ed)?\b/i,
  /stream could not be completed/i,
];

export function isProviderFailureDetail(detail) {
  const text = typeof detail === "string" ? detail : "";
  return PROVIDER_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Three outcomes, two of which block a merge.
 *
 * - passed:       nothing blocking, on a sample worth trusting.
 * - blocked:      a regression versus main. Investigate.
 * - inconclusive: the sample cannot answer the question, because too much of
 *                 the live set never reached the provider or because a
 *                 blocking case failed with an explicit provider error.
 *                 Re-run rather than investigate.
 *
 * Inconclusive is never a path to green: its exit code is non-zero, so the
 * gate still blocks. A degraded run is inconclusive even with no regressions,
 * because "no case flipped" is a weak claim when a chunk of the set did not
 * execute.
 */
export function classifyComparisonOutcome({ counts = {}, regressions = [] } = {}) {
  const total = ["pass", "fail", "flaky", "unavailable"]
    .reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
  const unavailable = Number(counts.unavailable) || 0;
  const unavailableRatio = total > 0 ? unavailable / total : 0;
  const degraded = total > 0 && unavailableRatio > PROVIDER_DEGRADED_UNAVAILABLE_RATIO;
  const providerBlocked = regressions.filter((row) => isProviderFailureDetail(row?.detail));

  if (degraded) {
    return {
      outcome: "inconclusive",
      exitCode: 2,
      blocks: true,
      unavailableRatio,
      providerBlocked,
      reason: `${unavailable} of ${total} live cases were unavailable (${(unavailableRatio * 100).toFixed(1)}%, over the ${(PROVIDER_DEGRADED_UNAVAILABLE_RATIO * 100).toFixed(0)}% ceiling). The provider was degraded, so this sample cannot establish a regression either way. Re-run the gate.`,
    };
  }
  if (providerBlocked.length) {
    return {
      outcome: "inconclusive",
      exitCode: 2,
      blocks: true,
      unavailableRatio,
      providerBlocked,
      reason: `${providerBlocked.length} of ${regressions.length} blocking ${regressions.length === 1 ? "case" : "cases"} failed with an explicit provider error. Re-run the gate before investigating the branch.`,
    };
  }
  if (regressions.length) {
    return {
      outcome: "blocked",
      exitCode: 1,
      blocks: true,
      unavailableRatio,
      providerBlocked,
      reason: `${regressions.length} ${regressions.length === 1 ? "case passes" : "cases pass"} on main and fail here on a usable sample. Investigate the branch.`,
    };
  }
  return {
    outcome: "passed",
    exitCode: 0,
    blocks: false,
    unavailableRatio,
    providerBlocked,
    reason: "No regression versus main.",
  };
}

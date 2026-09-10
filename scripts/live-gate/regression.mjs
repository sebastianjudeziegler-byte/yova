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

import type { DeadlineMilestone } from "@/lib/domain";

/**
 * Keeps every open deadline reachable. Chronological order deliberately puts
 * overdue work before future work so the Agenda shortcut cannot skip a missed
 * deadline forever once its calendar day leaves the seven-day selector.
 */
export function nextActionableMilestone<T extends Pick<DeadlineMilestone, "dueAt" | "status">>(
  milestones: readonly T[],
) {
  return milestones
    .filter((milestone) => milestone.status === "open")
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))[0] ?? null;
}

export function isMilestoneOverdue(
  milestone: Pick<DeadlineMilestone, "dueAt" | "status">,
  now = new Date(),
) {
  return milestone.status === "open"
    && Date.parse(milestone.dueAt) < startOfLocalDay(now).getTime();
}

function startOfLocalDay(value: Date) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start;
}

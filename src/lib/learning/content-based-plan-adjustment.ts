import { makeUuid, type LearningPlanSession, type SessionLearningMode } from "@/lib/domain";

export type AdjustableSessionRow = {
  id: string;
  sequence: number;
  title: string;
  objective: string;
  method: string;
  method_rationale: string;
  scheduled_for: string | null;
  estimated_minutes: number;
  status: "ready" | "upcoming";
  step_data: unknown;
};

export type ReplacementPlanSession = Omit<LearningPlanSession, "resource" | "adaptationNote" | "reviewConcept" | "reviewType"> & {
  originSessionId: string;
  originalContentMinutes: number;
  segmentIndex: number;
  segmentCount: number;
};

export function buildContentBasedReplacementSessions(
  rows: AdjustableSessionRow[],
  targetMinutes: number,
  startingSequence: number,
) {
  const groups = new Map<string, AdjustableSessionRow[]>();
  for (const row of [...rows].sort((left, right) => left.sequence - right.sequence)) {
    const originId = readText(row.step_data, "originSessionId") || row.id;
    const group = groups.get(originId) ?? [];
    group.push(row);
    groups.set(originId, group);
  }

  let sequence = startingSequence;
  let lastScheduledTime = Number.NEGATIVE_INFINITY;
  const replacements: ReplacementPlanSession[] = [];

  for (const [originSessionId, group] of groups) {
    const ordered = [...group].sort((left, right) => left.sequence - right.sequence);
    const first = ordered[0];
    const remainingContentMinutes = ordered.reduce((total, row) => total + row.estimated_minutes, 0);
    const segmentCount = Math.max(1, Math.ceil(remainingContentMinutes / targetMinutes));
    const targets = unique(ordered.flatMap((row) => readStrings(row.step_data, "contentTargets")));
    const evidence = unique(ordered.flatMap((row) => readStrings(row.step_data, "completionEvidence")));
    const learningMode = readLearningMode(first.step_data);
    const baseTitle = stripPartLabel(first.title);
    const evenMinutes = Math.floor(remainingContentMinutes / segmentCount);
    const extraMinutes = remainingContentMinutes % segmentCount;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const segmentMinutes = evenMinutes + (segmentIndex < extraMinutes ? 1 : 0);
      const contentTargets = distributeStrings(targets, segmentIndex, segmentCount, first.objective);
      const completionEvidence = distributeStrings(evidence, segmentIndex, segmentCount, "Produce an independent attempt for this content slice");
      const scheduledFor = sequencedSchedule(first.scheduled_for, segmentIndex, lastScheduledTime);
      lastScheduledTime = new Date(scheduledFor).getTime();
      replacements.push({
        id: segmentIndex === 0 ? first.id : makeUuid(),
        sequence,
        title: segmentCount > 1 ? `${baseTitle} · Part ${segmentIndex + 1} of ${segmentCount}` : baseTitle,
        objective: segmentCount > 1
          ? `${first.objective} Complete only this bounded part; the remaining content stays in the later parts.`
          : first.objective,
        method: first.method,
        methodReason: first.method_rationale,
        scheduledFor,
        estimatedMinutes: segmentMinutes,
        amountLabel: `${contentTargets.length} focused ${contentTargets.length === 1 ? "target" : "targets"} + evidence check · about ${segmentMinutes} min`,
        learningMode,
        contentTargets,
        completionEvidence,
        status: replacements.length === 0 ? "ready" : "upcoming",
        originSessionId,
        originalContentMinutes: remainingContentMinutes,
        segmentIndex: segmentIndex + 1,
        segmentCount,
      });
      sequence += 1;
    }
  }

  return replacements.slice(0, 14);
}

function readText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : "";
}

function readStrings(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = (value as Record<string, unknown>)[key];
  if (!Array.isArray(item)) return [];
  return item.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function readLearningMode(value: unknown): SessionLearningMode {
  const candidate = readText(value, "learningMode");
  return candidate === "learn" ? "learn" : "study";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function distributeStrings(values: string[], index: number, count: number, fallback: string) {
  const assigned = values.filter((_, valueIndex) => valueIndex % count === index);
  if (assigned.length) return assigned;
  return count > 1 ? [`Part ${index + 1} of ${count}: ${fallback}`] : [fallback];
}

function stripPartLabel(title: string) {
  return title.replace(/\s*·\s*Part\s+\d+\s+of\s+\d+\s*$/i, "").trim();
}

function shiftedSchedule(value: string | null, days: number) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function sequencedSchedule(value: string | null, days: number, lastScheduledTime: number) {
  const candidate = new Date(shiftedSchedule(value, days));
  while (candidate.getTime() <= lastScheduledTime) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

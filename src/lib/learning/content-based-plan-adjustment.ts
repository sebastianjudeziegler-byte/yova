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

export const MAX_ADJUSTED_PLAN_SESSIONS = 14;

export class PlanAdjustmentPartLimitError extends Error {
  constructor() {
    super("This change would create more sessions than this plan can safely hold. Choose a longer session window.");
    this.name = "PlanAdjustmentPartLimitError";
  }
}

export function learningPlanSessionToAdjustableRow(
  session: LearningPlanSession,
): AdjustableSessionRow {
  if (session.status !== "ready" && session.status !== "upcoming") {
    throw new Error("Only unfinished sessions can be adjusted.");
  }

  return {
    id: session.id,
    sequence: session.sequence,
    title: session.title,
    objective: session.objective,
    method: session.method,
    method_rationale: session.methodReason,
    scheduled_for: session.scheduledFor,
    estimated_minutes: session.estimatedMinutes,
    status: session.status,
    step_data: {
      learningMode: session.learningMode,
      topicIds: session.topicIds ?? [],
      contentTargets: session.contentTargets ?? [],
      completionEvidence: session.completionEvidence ?? [],
      ...(session.originSessionId ? { originSessionId: session.originSessionId } : {}),
      ...(session.originalContentMinutes ? { originalContentMinutes: session.originalContentMinutes } : {}),
      ...(session.segmentIndex ? { segmentIndex: session.segmentIndex } : {}),
      ...(session.segmentCount ? { segmentCount: session.segmentCount } : {}),
    },
  };
}

export function buildContentBasedReplacementSessions(
  rows: AdjustableSessionRow[],
  targetMinutes: number,
  startingSequence: number,
  maximumReplacementSessions = MAX_ADJUSTED_PLAN_SESSIONS,
) {
  const replacementLimit = Number.isInteger(maximumReplacementSessions)
    ? Math.max(0, Math.min(MAX_ADJUSTED_PLAN_SESSIONS, maximumReplacementSessions))
    : 0;
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
    const remainingContent = remainingContentFor(ordered);
    const remainingContentMinutes = remainingContent.minutes;
    const segmentCount = Math.max(1, Math.ceil(remainingContentMinutes / targetMinutes));
    if (
      segmentCount > replacementLimit
      || replacements.length + segmentCount > replacementLimit
    ) {
      throw new PlanAdjustmentPartLimitError();
    }
    const targets = unique(ordered.flatMap((row) => readStrings(row.step_data, "contentTargets")));
    const evidence = unique(ordered.flatMap((row) => readStrings(row.step_data, "completionEvidence")));
    const topicIds = unique(ordered.flatMap((row) => readStrings(row.step_data, "topicIds")));
    const learningMode = readLearningMode(first.step_data);
    const baseTitle = stripPartLabel(first.title);

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      // Once content is split, every part gets the full requested session
      // window. Each part needs its own orientation and evidence check, so
      // preserving the old total would create undersized remainders such as
      // 8 and 7 minutes for a requested 10-minute split.
      const segmentMinutes = segmentCount > 1 || remainingContent.wasPreviouslySplit
        ? targetMinutes
        : remainingContentMinutes;
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
        topicIds,
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

  return replacements;
}

function remainingContentFor(rows: AdjustableSessionRow[]) {
  const persistedParts = rows.map((row) => ({
    originalContentMinutes: readPositiveInteger(row.step_data, "originalContentMinutes"),
    segmentIndex: readPositiveInteger(row.step_data, "segmentIndex"),
    segmentCount: readPositiveInteger(row.step_data, "segmentCount"),
  }));
  const first = persistedParts[0];
  const originalContentMinutes = first?.originalContentMinutes ?? null;
  const originalSegmentCount = first?.segmentCount ?? null;
  const hasConsistentSplitMetadata = Boolean(
    originalContentMinutes
    && originalSegmentCount
    && persistedParts.every((part) => (
      part.originalContentMinutes === originalContentMinutes
      && part.segmentCount === originalSegmentCount
      && part.segmentIndex
      && part.segmentIndex <= originalSegmentCount
    ))
    && new Set(persistedParts.map((part) => part.segmentIndex)).size === persistedParts.length,
  );

  if (!hasConsistentSplitMetadata || originalContentMinutes === null || originalSegmentCount === null) {
    return {
      minutes: rows.reduce((total, row) => total + row.estimated_minutes, 0),
      wasPreviouslySplit: false,
    };
  }

  const evenContentMinutes = Math.floor(originalContentMinutes / originalSegmentCount);
  const extraContentMinutes = originalContentMinutes % originalSegmentCount;
  return {
    minutes: persistedParts.reduce((total, part) => (
      total
      + evenContentMinutes
      + (part.segmentIndex !== null && part.segmentIndex <= extraContentMinutes ? 1 : 0)
    ), 0),
    wasPreviouslySplit: true,
  };
}

function readText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : "";
}

function readPositiveInteger(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" && Number.isInteger(item) && item > 0 ? item : null;
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

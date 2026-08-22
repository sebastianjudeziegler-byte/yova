import { type LearningPlanSession } from "@/lib/domain";

type ContinuationSourceSession = Pick<
  LearningPlanSession,
  | "id"
  | "sequence"
  | "title"
  | "objective"
  | "method"
  | "methodReason"
  | "learningMode"
  | "topicIds"
  | "contentTargets"
  | "completionEvidence"
  | "resource"
  | "reviewType"
>;

export type DeferredSessionContinuation = LearningPlanSession & {
  reviewType?: never;
  reviewConcept?: never;
};

/**
 * Turns the exact plan targets omitted from a generated time-bounded resource
 * into durable next work. Generated prose is never treated as curriculum here:
 * only deferred labels that exactly match the stored session contract qualify.
 */
export function buildDeferredSessionContinuation({
  completedSession,
  completedAt,
  plannedMinutes,
  continuationId,
  nextUnfinishedSession = null,
  deadline = null,
}: {
  completedSession: ContinuationSourceSession;
  completedAt: string;
  plannedMinutes: number;
  continuationId: string;
  nextUnfinishedSession?: Pick<LearningPlanSession, "scheduledFor"> | null;
  deadline?: string | null;
}): DeferredSessionContinuation | null {
  if (completedSession.reviewType) return null;

  const targets = validStrings(completedSession.contentTargets, 5, 180, 6);
  const deferredLabels = validStrings(
    completedSession.resource?.coverage?.deferredContent,
    5,
    180,
    4,
  );
  if (!targets || !deferredLabels?.length) return null;

  const deferredKeys = new Set(deferredLabels.map(normalizeTarget));
  const deferredIndexes = targets.flatMap((target, index) => (
    deferredKeys.has(normalizeTarget(target)) ? [index] : []
  ));
  if (!deferredIndexes.length) return null;

  const deferredTargets = deferredIndexes.map((index) => targets[index]!);
  const topicIds = validTopicIds(completedSession.topicIds);
  const completionEvidence = validStrings(
    completedSession.completionEvidence,
    8,
    220,
    4,
  );
  if (!topicIds?.length || !completionEvidence?.length) return null;

  const deferredTopicIds = topicIds.length === targets.length
    ? deferredIndexes.map((index) => topicIds[index]!)
    : topicIds.length === 1
      ? topicIds
      : null;
  const deferredCompletionEvidence = completionEvidence.length === targets.length
    ? deferredIndexes.map((index) => completionEvidence[index]!)
    : synthesizedDeferredEvidence(deferredTargets);
  if (!deferredTopicIds?.length || !deferredCompletionEvidence.length) return null;

  const scheduledFor = new Date(completedAt);
  if (Number.isNaN(scheduledFor.getTime())) return null;
  const requestedMinutes = Number.isInteger(plannedMinutes)
    ? Math.max(10, Math.min(180, plannedMinutes))
    : 10;
  const boundary = earliestBoundary(nextUnfinishedSession?.scheduledFor ?? null, deadline);
  const availableMinutes = boundary === null
    ? requestedMinutes
    : Math.floor((boundary - scheduledFor.getTime()) / 60_000);
  if (availableMinutes < 10) return null;
  const estimatedMinutes = Math.min(requestedMinutes, availableMinutes);
  const targetSummary = deferredTargets.join("; ");
  const baseTitle = completedSession.title.replace(/^Continue\s+/i, "").trim();

  return {
    id: continuationId,
    sequence: completedSession.sequence + 1,
    title: `Continue ${baseTitle || "the remaining session targets"}`.slice(0, 180),
    objective: continuationObjective(completedSession.learningMode, targetSummary),
    method: completedSession.method,
    methodReason: `This continuation preserves the exact plan scope that did not fit the previous time window. Complete only these remaining targets before moving to later curriculum: ${targetSummary}.`.slice(0, 900),
    scheduledFor: scheduledFor.toISOString(),
    estimatedMinutes,
    amountLabel: `${deferredTargets.length} saved ${deferredTargets.length === 1 ? "target" : "targets"} · about ${estimatedMinutes} min`,
    learningMode: completedSession.learningMode,
    topicIds: deferredTopicIds,
    contentTargets: deferredTargets,
    completionEvidence: deferredCompletionEvidence,
    status: "ready",
  };
}

/** True only when the generated resource deferred stored plan targets. */
export function sessionResourceHasDeferredPlanTargets(
  session: Pick<ContinuationSourceSession, "contentTargets" | "resource">,
) {
  const targets = session.contentTargets ?? [];
  const deferred = session.resource?.coverage?.deferredContent ?? [];
  const targetKeys = new Set(targets.map(normalizeTarget));
  return deferred.some((label) => targetKeys.has(normalizeTarget(label)));
}

function continuationObjective(learningMode: LearningPlanSession["learningMode"], targets: string) {
  const prefix = learningMode === "learn"
    ? "Learn and explain the remaining saved targets"
    : "Retrieve or apply the remaining saved targets without notes";
  return `${prefix}: ${targets}.`.slice(0, 900);
}

function validStrings(
  values: string[] | undefined,
  minimumLength: number,
  maximumLength: number,
  maximumItems: number,
) {
  if (
    !values
    || values.length < 1
    || values.length > maximumItems
    || values.some((value) => {
      const trimmed = value.trim();
      return trimmed.length < minimumLength || trimmed.length > maximumLength;
    })
  ) return null;
  return values.map((value) => value.trim());
}

function validTopicIds(values: string[] | undefined) {
  if (!values || values.length < 1 || values.length > 6) return null;
  return values.every((value) => UUID_PATTERN.test(value)) ? [...values] : null;
}

function normalizeTarget(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function synthesizedDeferredEvidence(targets: string[]) {
  return targets.slice(0, 4).map((target) => (
    `Explain or apply this remaining saved target independently: ${target}`.slice(0, 220)
  ));
}

function earliestBoundary(nextScheduledFor: string | null, deadline: string | null) {
  const candidates = [nextScheduledFor, deadline].flatMap((value) => {
    if (!value) return [];
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? [time] : [Number.NEGATIVE_INFINITY];
  });
  return candidates.length ? Math.min(...candidates) : null;
}

import { z } from "zod";
import type {
  LearningPlanSession,
  SessionCompletion,
} from "@/lib/domain";
import type {
  CanonicalObservedMethodEvidence,
  DeepReadonly,
} from "@/lib/learning/canonical-method-selection";
import {
  buildMethodOutcomeSignals,
  type MethodOutcomeAttempt,
} from "@/lib/personalization/method-outcomes";
import {
  resolvePersonalizationForGeneration,
  type GenerationPersonalizationContext,
} from "@/lib/personalization/personalization-generation";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";
import { methodSelectionContextForStudyRoute } from "@/lib/study-route/method-plan-integration";
import {
  methodEvidenceComparisonContextForRoute,
  methodEvidenceComparisonKey,
  type MethodEvidenceComparisonContext,
} from "@/lib/study-route/method-evidence-policy";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

export const METHOD_DECISION_EVIDENCE_ADAPTER_VERSION =
  "method_decision_evidence_adapter_v2" as const;
export const METHOD_DECISION_RECENCY_DAYS = 90 as const;
export const METHOD_DECISION_MAX_COHORTS_PER_METHOD_CONTEXT = 4 as const;
export const METHOD_DECISION_MAX_SESSIONS_PER_COHORT = 8 as const;
/** @deprecated Use METHOD_DECISION_MAX_SESSIONS_PER_COHORT. */
export const METHOD_DECISION_MAX_SESSIONS_PER_METHOD =
  METHOD_DECISION_MAX_SESSIONS_PER_COHORT;

export type AuthorizedMethodEvidenceSession = Pick<
  LearningPlanSession,
  "id" | "estimatedMinutes" | "reviewType" | "reviewConcept" | "resource" | "studyRoute"
>;

export type AuthorizedMethodEvidencePlan = {
  id: string;
  sessions: readonly AuthorizedMethodEvidenceSession[];
};

export type AuthorizedMethodDecisionEvidence = DeepReadonly<{
  personalization: GenerationPersonalizationContext;
  observedEvidence: readonly CanonicalObservedMethodEvidence[];
}>;

type MethodAuthority = {
  planId: string;
  sessionId: string;
  route: StudyRoute;
};

type ComparableCompletion = {
  completion: SessionCompletion;
  authority: MethodAuthority;
  taskType: StudyRoute["target"]["taskFamily"];
  knowledgeStage: ReturnType<typeof methodSelectionContextForStudyRoute>["knowledgeStage"];
  comparisonContext: MethodEvidenceComparisonContext;
};

const IsoTimestampSchema = z.string().datetime({ offset: true });

/**
 * Builds only the typed declarations and exact route-bound outcome evidence
 * that the canonical method selector may consume. Raw profile prose, legacy
 * sessions, reviews, duplicate IDs, stale outcomes, and excluded evidence are
 * deliberately absent from the result.
 */
export function buildAuthorizedMethodDecisionEvidence({
  answers,
  plans,
  completions,
  now,
}: {
  /** Current, server-authorized answers after personalization-state validation. */
  answers: readonly string[];
  plans: readonly AuthorizedMethodEvidencePlan[];
  completions: readonly SessionCompletion[];
  now: Date;
}): AuthorizedMethodDecisionEvidence {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Method evidence requires a valid recency anchor.");
  }
  const personalization = resolvePersonalizationForGeneration({
    answers,
    completions: [],
    interruptions: [],
    plans: [],
    now,
  });
  const state = readPersonalizationStateFromAnswers(answers);
  if (!state.controls.behavior) {
    return deepFreeze({ personalization, observedEvidence: [] });
  }

  const authorities = methodAuthorities(plans);
  const completionIdCounts = countIds(completions.map((completion) => completion.id));
  const excluded = new Set(state.excludedEvidenceRefs);
  const cutoff = now.getTime() - METHOD_DECISION_RECENCY_DAYS * 24 * 60 * 60 * 1_000;
  const futureTolerance = now.getTime() + 5 * 60 * 1_000;
  const comparableAttempts = completions.flatMap((completion): ComparableCompletion[] => {
    const completionId = validEvidenceRef(completion.id);
    const authority = authorities.get(sessionKey(completion.planId, completion.planSessionId));
    if (
      !completionId
      || completionIdCounts.get(completionId) !== 1
      || excluded.has(completionId)
      || !authority
      || excluded.has(routeEvidenceRef(authority.route.identity.routeRevisionId))
      || !completionMatchesAuthority(completion, authority)
    ) return [];
    const completedAt = Date.parse(completion.completedAt);
    if (!Number.isFinite(completedAt) || completedAt < cutoff || completedAt > futureTolerance) {
      return [];
    }
    const context = methodSelectionContextForStudyRoute(authority.route);
    return [{
      completion,
      authority,
      taskType: context.taskType,
      knowledgeStage: context.knowledgeStage,
      comparisonContext: methodEvidenceComparisonContextForRoute(authority.route),
    }];
  });
  // Replaying or retrying one route cannot manufacture multiple "sessions" of
  // method evidence. Keep only the latest exact completion per route revision.
  const comparableByRoute = new Map<string, ComparableCompletion>();
  for (const item of [...comparableAttempts].sort(compareCompletionRecency)) {
    const routeRevisionId = item.authority.route.identity.routeRevisionId;
    if (!comparableByRoute.has(routeRevisionId)) {
      comparableByRoute.set(routeRevisionId, item);
    }
  }
  const comparable = [...comparableByRoute.values()];

  const cohorts = new Map<string, ComparableCompletion[]>();
  for (const item of comparable) {
    const key = [
      item.authority.route.approach.primaryMethodId,
      methodEvidenceComparisonKey(item.comparisonContext),
    ].join(":");
    const current = cohorts.get(key) ?? [];
    current.push(item);
    cohorts.set(key, current);
  }

  // Never pool unlike work. Keep several separately keyed cohorts so a future
  // route can select only its exact comparison cohort. Bound the retained
  // cohort count per method/task/stage to keep the server projection compact.
  const comparableGroups = new Map<string, ComparableCompletion[][]>();
  for (const items of cohorts.values()) {
    const first = items[0]!;
    const key = [
      first.taskType,
      first.knowledgeStage,
      first.authority.route.approach.primaryMethodId,
    ].join(":");
    const current = comparableGroups.get(key) ?? [];
    current.push(items);
    comparableGroups.set(key, current);
  }
  const retainedCohorts = [...comparableGroups.values()].flatMap((candidates) => (
    [...candidates]
      .sort(compareCohortStrength)
      .slice(0, METHOD_DECISION_MAX_COHORTS_PER_METHOD_CONTEXT)
  ));

  const observedEvidence = retainedCohorts.flatMap((items) => {
    const first = items[0]!;
    const comparison = {
      taskType: first.taskType,
      knowledgeStage: first.knowledgeStage,
    };
    const comparisonKey = methodEvidenceComparisonKey(first.comparisonContext);
    const boundedItems = [...items]
      .sort(compareCompletionRecency)
      .slice(0, METHOD_DECISION_MAX_SESSIONS_PER_COHORT);
    const attempts: MethodOutcomeAttempt[] = boundedItems.map((item) => ({
      methodId: item.authority.route.approach.primaryMethodId,
      taskType: comparison.taskType,
      knowledgeStage: comparison.knowledgeStage,
      correctAnswers: item.completion.correctAnswers,
      totalAnswers: item.completion.totalAnswers,
      feedback: item.completion.feedback,
    }));
    const signals = buildMethodOutcomeSignals(attempts, comparison);
    return signals.map((signal): CanonicalObservedMethodEvidence => {
      return {
        comparisonKey,
        signal,
        evidenceRefs: unique(boundedItems.flatMap((item) => [
          item.completion.id,
          routeEvidenceRef(item.authority.route.identity.routeRevisionId),
        ])),
        distinctStudyDays: new Set(boundedItems.map((item) => (
          item.completion.completedAt.slice(0, 10)
        ))).size,
        latestObservedAt: boundedItems
          .map((item) => item.completion.completedAt)
          .sort((left, right) => right.localeCompare(left))[0]!,
      };
    });
  }).sort((left, right) => (
    left.signal.taskType.localeCompare(right.signal.taskType)
    || left.signal.knowledgeStage.localeCompare(right.signal.knowledgeStage)
    || left.signal.methodId.localeCompare(right.signal.methodId)
    || left.comparisonKey.localeCompare(right.comparisonKey)
  ));

  return deepFreeze({ personalization, observedEvidence });
}

function methodAuthorities(plans: readonly AuthorizedMethodEvidencePlan[]) {
  const rawKeyCounts = new Map<string, number>();
  for (const plan of plans) {
    for (const session of plan.sessions) {
      const key = sessionKey(plan.id, session.id);
      rawKeyCounts.set(key, (rawKeyCounts.get(key) ?? 0) + 1);
    }
  }
  const authorities = new Map<string, MethodAuthority>();
  for (const plan of plans) {
    for (const session of plan.sessions) {
      const key = sessionKey(plan.id, session.id);
      if (rawKeyCounts.get(key) !== 1) continue;
      const parsed = StudyRouteSchema.safeParse(session.studyRoute);
      if (!parsed.success) continue;
      const route = parsed.data;
      if (
        route.identity.lifecycleStatus !== "committed"
        || route.identity.planId !== plan.id
        || route.identity.sessionId !== session.id
        || route.timing.durationSource === "scheduled_review"
        || session.reviewType != null
        || Boolean(session.reviewConcept?.trim())
        || session.estimatedMinutes !== route.timing.activeMinutes
        || !route.execution.completionEvidence.some((evidence) => (
          evidence.requiresIndependentAttempt
        ))
        || !resourceMatchesRoute(session, route.identity.routeRevisionId)
      ) continue;
      authorities.set(key, { planId: plan.id, sessionId: session.id, route });
    }
  }
  return authorities;
}

function completionMatchesAuthority(
  completion: SessionCompletion,
  authority: MethodAuthority,
) {
  return completion.planId === authority.planId
    && completion.planSessionId === authority.sessionId
    && completion.routeRevisionId === authority.route.identity.routeRevisionId
    && completion.plannedMinutes === authority.route.timing.activeMinutes
    && Number.isInteger(completion.correctAnswers)
    && Number.isInteger(completion.totalAnswers)
    && completion.totalAnswers > 0
    && completion.totalAnswers <= 500
    && completion.correctAnswers >= 0
    && completion.correctAnswers <= completion.totalAnswers
    && Number.isInteger(completion.actualMinutes)
    && completion.actualMinutes >= 0
    && completion.actualMinutes <= 240
    && IsoTimestampSchema.safeParse(completion.startedAt).success
    && IsoTimestampSchema.safeParse(completion.completedAt).success
    && Date.parse(completion.startedAt) <= Date.parse(completion.completedAt);
}

function resourceMatchesRoute(
  session: AuthorizedMethodEvidenceSession,
  routeRevisionId: string,
) {
  if (!session.resource) return true;
  if (session.resource.routeRevisionId !== routeRevisionId) return false;
  return !session.resource.cacheContext
    || session.resource.cacheContext.routeRevisionId === routeRevisionId;
}

function compareCompletionRecency(left: ComparableCompletion, right: ComparableCompletion) {
  return Date.parse(right.completion.completedAt) - Date.parse(left.completion.completedAt)
    || left.completion.id.localeCompare(right.completion.id);
}

function compareCohortStrength(
  left: readonly ComparableCompletion[],
  right: readonly ComparableCompletion[],
) {
  return right.length - left.length
    || checkedAnswerCount(right) - checkedAnswerCount(left)
    || distinctStudyDayCount(right) - distinctStudyDayCount(left)
    || latestCompletionTime(right) - latestCompletionTime(left)
    || methodEvidenceComparisonKey(left[0]!.comparisonContext).localeCompare(
      methodEvidenceComparisonKey(right[0]!.comparisonContext),
    );
}

function checkedAnswerCount(items: readonly ComparableCompletion[]) {
  return items.reduce((sum, item) => sum + item.completion.totalAnswers, 0);
}

function distinctStudyDayCount(items: readonly ComparableCompletion[]) {
  return new Set(items.map((item) => item.completion.completedAt.slice(0, 10))).size;
}

function latestCompletionTime(items: readonly ComparableCompletion[]) {
  return Math.max(...items.map((item) => Date.parse(item.completion.completedAt)));
}

function countIds(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const valid = validEvidenceRef(value);
    if (valid) counts.set(valid, (counts.get(valid) ?? 0) + 1);
  }
  return counts;
}

function validEvidenceRef(value: string) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && value.trim() === value
    ? value
    : null;
}

function routeEvidenceRef(routeRevisionId: string) {
  return `route-revision:${routeRevisionId}`;
}

function sessionKey(planId: string, sessionId: string) {
  return `${planId}\u0000${sessionId}`;
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

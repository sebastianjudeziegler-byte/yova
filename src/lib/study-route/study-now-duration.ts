import type { LearningPlan } from "@/lib/domain";
import {
  type DurationPlanningWindow,
  NORMAL_DURATION_RECOMMENDER_VERSION,
  type NormalDurationOutcome,
  type NormalStudyDurationRecommendationInput,
  recommendNormalStudyDuration,
} from "@/lib/study-route/duration-recommendation";
import { DURATION_SIGNAL_ADAPTER_VERSION } from "@/lib/study-route/duration-signals";
import {
  resolveNormalStudyDurationPrecedence,
  type InsufficientNormalStudyDuration,
} from "@/lib/study-route/duration-precedence";
import type { StudyNowDurationDecision } from "@/lib/study-route/duration-plan-integration";
import {
  StudyRouteProvenanceSchema,
  StudyRouteSchema,
} from "@/lib/study-route/schema";

export type StudyNowDurationContext = {
  profileVersion: string;
  profile: NormalStudyDurationRecommendationInput["profile"];
  recentOutcomes: readonly NormalDurationOutcome[];
};

export type ResolvedStudyNowDurationDecision = {
  readonly status: "resolved";
  readonly decision: DeepReadonly<StudyNowDurationDecision>;
  readonly recommendationContext: Readonly<{
    taskFamily: NormalStudyDurationRecommendationInput["context"]["taskFamily"];
    mode: NormalStudyDurationRecommendationInput["context"]["mode"];
  }>;
};

export type StudyNowDurationDecisionResult =
  | ResolvedStudyNowDurationDecision
  | InsufficientNormalStudyDuration;

export const STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS = 3 as const;

export type ReconciledStudyNowDurationResult =
  | Readonly<{
      status: "resolved";
      plan: DeepReadonly<LearningPlan>;
      decision: ResolvedStudyNowDurationDecision["decision"];
      recommendationContext: ResolvedStudyNowDurationDecision["recommendationContext"];
    }>
  | InsufficientNormalStudyDuration;

/**
 * Composes the authorized recommendation and precedence kernels for one
 * preliminary, ordinary Study Now plan. Content is rebuilt from the returned
 * sidecar by the preview/materialization boundary; this function never edits
 * a plan or route in place.
 */
export function decideStudyNowDuration({
  preliminaryPlan,
  context,
  scheduledWindow,
  hardMaximumMinutes,
}: {
  preliminaryPlan: LearningPlan;
  context: StudyNowDurationContext;
  scheduledWindow: DurationPlanningWindow | null;
  hardMaximumMinutes: number;
}): StudyNowDurationDecisionResult {
  const recommendationContext = studyNowRecommendationContext(preliminaryPlan);

  const profileVersion = StudyRouteProvenanceSchema.shape.profileVersion.parse(
    context.profileVersion,
  );
  if (profileVersion === "legacy_unknown") {
    throw new Error("Study Now duration requires an honest authorized-context version.");
  }

  const recommendation = recommendNormalStudyDuration({
    context: recommendationContext,
    profile: context.profile,
    schedule: { window: scheduledWindow },
    recentOutcomes: context.recentOutcomes,
  });
  const resolved = resolveNormalStudyDurationPrecedence({
    systemRecommendation: recommendation,
    learnerOverrideMinutes: null,
    hardMaximumMinutes,
  });
  if (resolved.status === "insufficient_time") return resolved;

  return deepFreeze({
    status: "resolved",
    decision: {
      timing: resolved.timing,
      ruleTrace: [
        {
          ruleId: DURATION_SIGNAL_ADAPTER_VERSION,
          result: "authorized_context_applied",
          reason: "Only structured learner signals and exact route-bound outcomes allowed by the learner's personalization controls entered duration routing.",
          evidenceRefs: [],
        },
        ...resolved.ruleTrace,
      ],
      routerVersion: NORMAL_DURATION_RECOMMENDER_VERSION,
      profileVersion,
    },
    recommendationContext,
  });
}

/**
 * Finds a bounded fixed point between duration-dependent content budgeting and
 * the canonical task/mode used to choose that duration. Candidate plans stay
 * local until their route context matches the context that produced their
 * sidecar; an oscillating builder can never leak a mismatched decision.
 */
export function reconcileStudyNowDuration({
  preliminaryPlan,
  context,
  scheduledWindow,
  hardMaximumMinutes,
  buildPlan,
}: {
  preliminaryPlan: LearningPlan;
  context: StudyNowDurationContext;
  scheduledWindow: DurationPlanningWindow | null;
  hardMaximumMinutes: number;
  buildPlan: (
    decision: ResolvedStudyNowDurationDecision["decision"],
  ) => LearningPlan;
}): ReconciledStudyNowDurationResult {
  let contextPlan = preliminaryPlan;

  for (
    let buildNumber = 1;
    buildNumber <= STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS;
    buildNumber += 1
  ) {
    const resolved = decideStudyNowDuration({
      preliminaryPlan: contextPlan,
      context,
      scheduledWindow,
      hardMaximumMinutes,
    });
    if (resolved.status === "insufficient_time") return resolved;

    const candidatePlan = buildPlan(resolved.decision);
    const candidateContext = studyNowRecommendationContext(candidatePlan);
    assertStudyNowDurationDecisionApplied(candidatePlan, resolved.decision);

    if (sameRecommendationContext(candidateContext, resolved.recommendationContext)) {
      return deepFreeze({
        status: "resolved",
        plan: structuredClone(candidatePlan),
        decision: resolved.decision,
        recommendationContext: resolved.recommendationContext,
      });
    }

    contextPlan = candidatePlan;
  }

  throw new Error(
    `Study Now duration routing did not converge after ${STUDY_NOW_DURATION_RECONCILIATION_MAX_BUILDS} bounded builds.`,
  );
}

function studyNowRecommendationContext(plan: LearningPlan) {
  if (plan.creationIntent !== "study_now" || plan.sessions.length !== 1) {
    throw new Error("A Study Now duration decision requires exactly one preliminary focused session.");
  }
  const session = plan.sessions[0]!;
  if (session.reviewType !== undefined || session.reviewConcept !== undefined) {
    throw new Error("A lightweight review cannot enter the normal Study Now duration engine.");
  }

  const route = StudyRouteSchema.parse(session.studyRoute);
  if (
    route.identity.lifecycleStatus !== "provisional"
    || route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
  ) {
    throw new Error("The preliminary Study Now route is not an exact provisional session route.");
  }

  return {
    taskFamily: route.target.taskFamily,
    mode: route.approach.mode,
  } as const;
}

/**
 * Revalidates that a provisional Study Now plan carries the exact timing and
 * provenance produced by a server-owned duration decision. The bounded
 * reconciliation loop uses this before the authenticated draft is signed.
 */
export function assertStudyNowDurationDecisionApplied(
  plan: LearningPlan,
  decision: ResolvedStudyNowDurationDecision["decision"],
) {
  studyNowRecommendationContext(plan);
  const session = plan.sessions[0]!;
  const route = StudyRouteSchema.parse(session.studyRoute);
  const timingMatches = route.timing.activeMinutes === decision.timing.activeMinutes
    && route.timing.elapsedMinutes === decision.timing.elapsedMinutes
    && route.timing.durationSource === decision.timing.durationSource
    && route.timing.hardMaximumMinutes === decision.timing.hardMaximumMinutes
    && route.timing.optionalTimedBreak?.minutes === decision.timing.optionalTimedBreak?.minutes
    && route.timing.optionalTimedBreak?.afterPhaseId === decision.timing.optionalTimedBreak?.afterPhaseId;
  const traceTail = route.provenance.ruleTrace.slice(-decision.ruleTrace.length);
  const traceMatches = traceTail.length === decision.ruleTrace.length
    && traceTail.every((entry, index) => sameRuleTraceEntry(entry, decision.ruleTrace[index]!));
  const routerVersions = route.provenance.routerVersion.split("+");

  if (
    session.estimatedMinutes !== decision.timing.activeMinutes
    || !timingMatches
    || route.provenance.profileVersion !== decision.profileVersion
    || !routerVersions.includes(decision.routerVersion)
    || !traceMatches
  ) {
    throw new Error("The Study Now builder did not apply the resolved duration decision exactly.");
  }
}

function sameRecommendationContext(
  left: ResolvedStudyNowDurationDecision["recommendationContext"],
  right: ResolvedStudyNowDurationDecision["recommendationContext"],
) {
  return left.taskFamily === right.taskFamily && left.mode === right.mode;
}

function sameRuleTraceEntry(
  left: ResolvedStudyNowDurationDecision["decision"]["ruleTrace"][number],
  right: ResolvedStudyNowDurationDecision["decision"]["ruleTrace"][number],
) {
  return left.ruleId === right.ruleId
    && left.result === right.result
    && left.reason === right.reason
    && left.evidenceRefs.length === right.evidenceRefs.length
    && left.evidenceRefs.every((reference, index) => reference === right.evidenceRefs[index]);
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

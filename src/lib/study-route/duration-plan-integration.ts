import { z } from "zod";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { LEGACY_STUDY_ROUTE_ADAPTER_VERSION } from "@/lib/study-route/adapters";
import {
  NORMAL_STUDY_DURATION_LEVELS,
  type ResolvedNormalStudyDuration,
} from "@/lib/study-route/duration-precedence";
import {
  StudyRouteProvenanceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  StudyRouteTimingSchema,
  type StudyRoute,
  type StudyRouteTiming,
} from "@/lib/study-route/schema";
import { composeStudyRouteProfileVersion } from "@/lib/study-route/provenance-version";

export const STUDY_NOW_DURATION_PLAN_INTEGRATION_VERSION =
  "study_now_duration_plan_integration_v1" as const;

const LEGACY_DURATION_UNCERTAINTY =
  "The duration is preserved, but the legacy record does not show how it was chosen.";
const MAX_INTEGRATION_RULE_TRACE_ENTRIES = 199;
const NORMAL_DURATION_SOURCES = new Set<StudyRouteTiming["durationSource"]>([
  "router_default",
  "profile_recommendation",
  "observed_outcome_adjustment",
  "availability_cap",
  "learner_override",
]);
const StudyNowDurationDecisionSchema = z.object({
  timing: StudyRouteTimingSchema,
  ruleTrace: z.array(StudyRouteRuleTraceEntrySchema)
    .min(1)
    .max(MAX_INTEGRATION_RULE_TRACE_ENTRIES),
  routerVersion: StudyRouteProvenanceSchema.shape.routerVersion,
  profileVersion: StudyRouteProvenanceSchema.shape.profileVersion,
}).strict();

/**
 * A resolved, ordinary-session duration decision. It is deliberately separate
 * from the generated draft so an LLM never owns timing, provenance, or the
 * final content budget.
 */
export type StudyNowDurationDecision = {
  readonly timing: ResolvedNormalStudyDuration["timing"];
  readonly ruleTrace: ResolvedNormalStudyDuration["ruleTrace"];
  /** Version of the deterministic duration recommender, not a prose model. */
  readonly routerVersion: string;
  /** Honest profile/evidence snapshot version supplied by the server loader. */
  readonly profileVersion: string;
};

/**
 * Validates the sidecar against the exact Study Now availability cap. The
 * returned value is a fresh parsed copy that callers may safely use for
 * budgeting and route materialization.
 */
export function parseStudyNowDurationDecision(
  decision: StudyNowDurationDecision,
  expectedHardMaximumMinutes: number,
): StudyNowDurationDecision {
  if (
    !Number.isInteger(expectedHardMaximumMinutes)
    || expectedHardMaximumMinutes < 1
    || expectedHardMaximumMinutes > 240
  ) {
    throw new Error("A Study Now duration decision requires a valid hard availability maximum.");
  }

  const parsed = StudyNowDurationDecisionSchema.parse(decision);
  const timing = parsed.timing;
  if (!NORMAL_STUDY_DURATION_LEVELS.some((minutes) => minutes === timing.activeMinutes)) {
    throw new Error("A Study Now duration decision must use a normal-session duration level.");
  }
  if (timing.optionalTimedBreak) {
    throw new Error("The current Study Now duration resolver does not insert timed breaks.");
  }
  if (!NORMAL_DURATION_SOURCES.has(timing.durationSource)) {
    throw new Error("A Study Now duration decision cannot use review or legacy duration provenance.");
  }
  if (timing.hardMaximumMinutes !== expectedHardMaximumMinutes) {
    throw new Error("The Study Now duration decision must preserve the request's exact hard maximum.");
  }
  const routerVersion = parsed.routerVersion;
  const profileVersion = parsed.profileVersion;
  if (routerVersion === LEGACY_STUDY_ROUTE_ADAPTER_VERSION || routerVersion === "legacy_unknown") {
    throw new Error("The duration sidecar must identify its deterministic duration router.");
  }
  if (profileVersion === "legacy_unknown") {
    throw new Error("The duration sidecar must identify its authorized profile snapshot.");
  }

  return {
    timing,
    ruleTrace: parsed.ruleTrace,
    routerVersion,
    profileVersion,
  };
}

/**
 * Applies a duration decision only to the newly materialized, provisional
 * Study Now route whose scalar and phase budget already use the same resolved
 * minutes. This never reinterprets stored legacy routes or scheduled reviews.
 */
export function integrateStudyNowDurationDecision({
  creationIntent,
  hardMaximumMinutes,
  session,
  route: routeInput,
  decision: decisionInput,
}: {
  creationIntent: LearningPlan["creationIntent"];
  hardMaximumMinutes: number;
  session: Pick<
    LearningPlanSession,
    "estimatedMinutes" | "reviewConcept" | "reviewType"
  >;
  route: StudyRoute;
  decision: StudyNowDurationDecision;
}): StudyRoute {
  if (creationIntent !== "study_now") {
    throw new Error("A Study Now duration decision cannot be applied to a normal plan.");
  }

  const route = StudyRouteSchema.parse(routeInput);
  if (route.identity.lifecycleStatus !== "provisional") {
    throw new Error("A duration decision can be integrated only before a StudyRoute is committed.");
  }
  if (route.provenance.routerVersion !== LEGACY_STUDY_ROUTE_ADAPTER_VERSION) {
    throw new Error("Duration integration accepts only a fresh materialization route, not a stored legacy route.");
  }
  if (
    session.reviewType !== undefined
    || session.reviewConcept !== undefined
    || route.timing.durationSource === "scheduled_review"
  ) {
    throw new Error("Scheduled reviews must keep their separate lightweight duration contract.");
  }

  const decision = parseStudyNowDurationDecision(
    decisionInput,
    hardMaximumMinutes,
  );

  if (
    session.estimatedMinutes !== decision.timing.activeMinutes
    || route.timing.activeMinutes !== session.estimatedMinutes
  ) {
    throw new Error(
      "Study Now duration must be applied to the scalar, content budget, phases, and route together.",
    );
  }

  const evidenceRefs = unique([
    ...route.provenance.evidenceRefs,
    ...decision.ruleTrace.flatMap((entry) => entry.evidenceRefs),
  ]);
  if (evidenceRefs.length > 100) {
    throw new Error("The combined StudyRoute duration provenance exceeds its evidence-reference limit.");
  }
  const ruleTrace = [
    ...route.provenance.ruleTrace,
    ...decision.ruleTrace,
  ];
  if (ruleTrace.length > 200) {
    throw new Error("The combined StudyRoute duration provenance exceeds its rule-trace limit.");
  }

  return StudyRouteSchema.parse({
    ...route,
    timing: decision.timing,
    explanation: {
      ...route.explanation,
      uncertainties: route.explanation.uncertainties.filter((uncertainty) => (
        uncertainty !== LEGACY_DURATION_UNCERTAINTY
      )),
    },
    provenance: {
      ...route.provenance,
      routerVersion: compositeRouterVersion(
        route.provenance.routerVersion,
        decision.routerVersion,
      ),
      profileVersion: composeStudyRouteProfileVersion(
        route.provenance.profileVersion,
        decision.profileVersion,
      ),
      evidenceRefs,
      ruleTrace,
    },
  });
}

function compositeRouterVersion(currentVersion: string, durationVersion: string) {
  const components = unique([
    currentVersion,
    STUDY_NOW_DURATION_PLAN_INTEGRATION_VERSION,
    durationVersion,
  ]);
  const value = components.join("+");
  return StudyRouteProvenanceSchema.shape.routerVersion.parse(value);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

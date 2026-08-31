import {
  PERSONALIZATION_BASELINE_ROUTE_VERSION,
  PERSONALIZATION_ROUTE_VERSION,
  personalizationRouteVersionFromRouterVersion,
} from "@/lib/study-route/personalization-rollout";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

export const PERSONALIZATION_COUNTERFACTUAL_POLICY_VERSION =
  "personalization_counterfactual_v1" as const;

export const PERSONALIZATION_COUNTERFACTUAL_DIFFERENCES = [
  "method",
  "duration",
  "support",
  "structure",
  "rationale",
] as const;

export type PersonalizationCounterfactualDifference =
  (typeof PERSONALIZATION_COUNTERFACTUAL_DIFFERENCES)[number];

/**
 * Produces a content-free comparison for rollout evaluation. It rejects a
 * pair unless the task/mastery boundary is unchanged, so copy or scope drift
 * cannot masquerade as personalization benefit.
 */
export function comparePersonalizationRouteCounterfactual({
  baseline: baselineInput,
  personalized: personalizedInput,
}: {
  baseline: StudyRoute;
  personalized: StudyRoute;
}) {
  const baseline = StudyRouteSchema.parse(baselineInput);
  const personalized = StudyRouteSchema.parse(personalizedInput);
  assertCounterfactualBoundary(baseline, personalized);
  const baselineVersion = personalizationRouteVersionFromRouterVersion(
    baseline.provenance.routerVersion,
  );
  const personalizedVersion = personalizationRouteVersionFromRouterVersion(
    personalized.provenance.routerVersion,
  );
  if (
    baselineVersion !== PERSONALIZATION_BASELINE_ROUTE_VERSION
    || personalizedVersion !== PERSONALIZATION_ROUTE_VERSION
  ) {
    throw new Error("A rollout counterfactual needs one baseline and one personalized route version.");
  }

  const differences: PersonalizationCounterfactualDifference[] = [];
  if (baseline.approach.primaryMethodId !== personalized.approach.primaryMethodId) {
    differences.push("method");
  }
  if (
    baseline.timing.activeMinutes !== personalized.timing.activeMinutes
    || baseline.timing.elapsedMinutes !== personalized.timing.elapsedMinutes
  ) {
    differences.push("duration");
  }
  if (baseline.execution.initialSupport !== personalized.execution.initialSupport) {
    differences.push("support");
  }
  if (phaseSignature(baseline) !== phaseSignature(personalized)) {
    differences.push("structure");
  }
  if (
    baseline.explanation.shortReason !== personalized.explanation.shortReason
    || !sameValues(
      baseline.provenance.evidenceRefs,
      personalized.provenance.evidenceRefs,
    )
  ) {
    differences.push("rationale");
  }

  return Object.freeze({
    policyVersion: PERSONALIZATION_COUNTERFACTUAL_POLICY_VERSION,
    baselineRouteVersion: baselineVersion,
    personalizedRouteVersion: personalizedVersion,
    taskFamily: baseline.target.taskFamily,
    mode: baseline.approach.mode,
    baselineMethodId: baseline.approach.primaryMethodId,
    personalizedMethodId: personalized.approach.primaryMethodId,
    baselineActiveMinutes: baseline.timing.activeMinutes,
    personalizedActiveMinutes: personalized.timing.activeMinutes,
    differences: Object.freeze(differences),
  });
}

function assertCounterfactualBoundary(
  baseline: StudyRoute,
  personalized: StudyRoute,
) {
  const invariantPairs: Array<readonly [unknown, unknown, string]> = [
    [baseline.identity.planId, personalized.identity.planId, "plan"],
    [baseline.identity.sessionId, personalized.identity.sessionId, "session"],
    [baseline.target.taskFamily, personalized.target.taskFamily, "task family"],
    [baseline.approach.mode, personalized.approach.mode, "Learn/Practice mode"],
    [baseline.approach.executionEnvironment, personalized.approach.executionEnvironment, "execution environment"],
    [baseline.timing.hardMaximumMinutes, personalized.timing.hardMaximumMinutes, "hard duration maximum"],
    [targetStateSignature(baseline), targetStateSignature(personalized), "target-state snapshot"],
    [sourceSignature(baseline), sourceSignature(personalized), "source requirements"],
  ];
  const changed = invariantPairs.find(([left, right]) => left !== right);
  if (changed) {
    throw new Error(`A personalization counterfactual must hold the ${changed[2]} fixed.`);
  }
}

function targetStateSignature(route: StudyRoute) {
  return JSON.stringify(route.target.targetStates.map((target) => ({
    targetId: target.targetId,
    stage: target.stage,
    uncertainty: target.uncertainty,
    evidenceRefs: target.evidenceRefs,
    lastObservedAt: target.lastObservedAt ?? null,
    nextReview: target.nextReview ?? null,
  })));
}

function sourceSignature(route: StudyRoute) {
  return JSON.stringify(route.target.sourceRequirements);
}

function phaseSignature(route: StudyRoute) {
  return JSON.stringify(route.execution.orderedPhases.map((phase) => ({
    methodPhase: phase.methodPhase,
    activeMinutes: phase.activeMinutes,
    targetIds: phase.targetIds,
  })));
}

function sameValues<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

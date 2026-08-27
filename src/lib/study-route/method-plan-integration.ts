import {
  CORE_METHOD_CATALOG,
  METHOD_PRESENTATION_POLICY_VERSION,
} from "@/lib/learning/method-catalog";
import {
  type CanonicalMethodSelectionResult,
  CANONICAL_METHOD_SELECTION_POLICY_VERSION,
} from "@/lib/learning/canonical-method-selection";
import {
  eligibleMethodIdsFor,
  METHOD_ELIGIBILITY_POLICY_VERSION,
  type KnowledgeStage,
} from "@/lib/learning/method-eligibility";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import {
  methodRuntimeCapabilityFor,
  METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
} from "@/lib/session-generation/method-runtime-capability";
import {
  StudyRouteProvenanceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteSchema,
  type StudyRoute,
  type StudyRouteAlternative,
  type StudyRoutePhase,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";
import { METHOD_DECISION_EVIDENCE_ADAPTER_VERSION } from "@/lib/study-route/method-decision-evidence";
import {
  STUDY_ROUTE_REASON_MAX_LENGTH,
} from "@/lib/study-route/scalar-contract";
import { composeStudyRouteProfileVersion } from "@/lib/study-route/provenance-version";

export const STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION =
  "study_route_method_plan_integration_v1" as const;

const LEGACY_AGENCY_UNCERTAINTY =
  "The legacy record does not show who selected the route or which control mode was active.";
const LEGACY_PHASE_UNCERTAINTY =
  "The intended phase skeleton comes from the method contract rather than a saved executed sequence.";

export type StudyRouteMethodDecision = {
  selection: CanonicalMethodSelectionResult;
  /** Authorized profile/evidence snapshot used to create the selection. */
  profileVersion: string;
};

/**
 * Converts a pure method selection into the fixed route recipe that content
 * generation must fill. It changes method-owned scalars, phase order, agency,
 * rationale, and provenance together; callers then project the route back to
 * compatibility session fields rather than mutating those fields alone.
 */
export function integrateStudyRouteMethodDecision({
  route: routeInput,
  decision,
}: {
  route: StudyRoute;
  decision: StudyRouteMethodDecision;
}): StudyRoute {
  const route = StudyRouteSchema.parse(routeInput);
  if (route.identity.lifecycleStatus !== "provisional") {
    throw new Error("A method decision can be integrated only before a StudyRoute is committed.");
  }
  if (route.timing.durationSource === "scheduled_review") {
    throw new Error("Scheduled reviews keep their separate lightweight method contract.");
  }
  if (decision.selection.authority === "committed_route") {
    throw new Error("A provisional route cannot import a committed-route selection authority.");
  }

  const profileVersion = StudyRouteProvenanceSchema.shape.profileVersion.parse(
    decision.profileVersion,
  );
  if (profileVersion === "legacy_unknown") {
    throw new Error("A canonical method decision must identify its authorized profile context.");
  }

  const expectedContext = methodSelectionContextForStudyRoute(route);
  validateSelectionAgainstRoute(decision.selection, expectedContext);
  const methodId = decision.selection.selectedMethodId;
  const learningMode = expectedContext.learningMode;
  const runtimeCapability = methodRuntimeCapabilityFor({
    methodId,
    ...expectedContext,
    executionEnvironment: route.approach.executionEnvironment,
  });
  if (runtimeCapability.status !== "supported") {
    throw new Error("The selected method has no valid runtime for this provisional StudyRoute.");
  }
  const targetIds = activeStudyRouteTargetIds(route);
  const methodPhases = methodFidelityContractForPrompt(methodId, learningMode).orderedPhases;
  const phaseMinutes = allocatePositiveMinutes(
    route.timing.activeMinutes,
    methodPhases.length,
  );
  const orderedPhases: StudyRoutePhase[] = methodPhases.map((methodPhase, index) => ({
    phaseId: `method-${index + 1}-${methodPhase}`,
    methodPhase,
    activeMinutes: phaseMinutes[index]!,
    targetIds,
  }));
  const alternatives = methodAlternatives(decision.selection, route);
  const method = CORE_METHOD_CATALOG[methodId];
  const shortReason = boundedReason(decision.selection.learnerFacingReason);
  const learnerDeclaration = decision.selection.authority === "learner_choice"
    || decision.selection.authority === "authorized_declaration";
  const observed = decision.selection.authority === "observed_outcomes"
    || decision.selection.authority === "continuity";
  const evidenceRefs = unique([
    ...route.provenance.evidenceRefs,
    ...decision.selection.evidenceRefs,
  ]);
  const presentationTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: METHOD_PRESENTATION_POLICY_VERSION,
    result: "recognizable_method_names",
    reason: "Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.",
    evidenceRefs: [],
  });
  const existingPresentationTrace = route.provenance.ruleTrace.filter((entry) => (
    entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
  ));
  if (
    existingPresentationTrace.length > 1
    || (existingPresentationTrace[0]
      && (
        existingPresentationTrace[0].result !== presentationTrace.result
        || existingPresentationTrace[0].reason !== presentationTrace.reason
        || !sameValues(
          existingPresentationTrace[0].evidenceRefs,
          presentationTrace.evidenceRefs,
        )
      ))
  ) {
    throw new Error("The StudyRoute has inconsistent method-presentation provenance.");
  }
  const ruleTrace = [
    ...route.provenance.ruleTrace,
    StudyRouteRuleTraceEntrySchema.parse({
      ruleId: METHOD_DECISION_EVIDENCE_ADAPTER_VERSION,
      result: "authorized_context_applied",
      reason: "Only structured learner declarations and exact route-bound outcomes allowed by the learner's personalization controls entered method routing.",
      evidenceRefs: [],
    }),
    ...decision.selection.ruleTrace,
    StudyRouteRuleTraceEntrySchema.parse({
      ruleId: METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
      result: [
        runtimeCapability.primaryGenerationPath,
        runtimeCapability.delivery.kind,
        `recovery_${runtimeCapability.boundedRecovery}`,
      ].join(":"),
      reason: runtimeCapability.reason,
      evidenceRefs: [],
    }),
    ...(existingPresentationTrace.length === 0 ? [presentationTrace] : []),
  ];
  if (evidenceRefs.length > 100) {
    throw new Error("The combined StudyRoute method provenance exceeds its evidence-reference limit.");
  }
  if (ruleTrace.length > 200) {
    throw new Error("The combined StudyRoute method provenance exceeds its rule-trace limit.");
  }

  return StudyRouteSchema.parse({
    ...route,
    approach: {
      mode: route.approach.mode,
      executionEnvironment: route.approach.executionEnvironment,
      primaryMethodId: methodId,
      visibleMethodName: method.name,
      confidenceLevel: route.approach.confidenceLevel,
    },
    execution: {
      ...route.execution,
      orderedPhases,
      initialSupport: learningMode === "learn"
        ? "supported_start"
        : "independent_start",
      activityLimit: Math.max(route.execution.activityLimit, orderedPhases.length),
    },
    agency: {
      controlMode: decision.selection.authority === "learner_choice"
        ? "learner_customizes"
        : "yova_decides",
      selectedBy: decision.selection.authority === "learner_choice"
        ? "learner"
        : "yova",
      alternatives,
      ...(decision.selection.authority === "learner_choice"
        && decision.selection.changedFromBaseline
        ? {
            override: {
              requestedAt: route.identity.createdAt,
              changedFields: ["primary_method" as const],
              reason: shortReason,
            },
          }
        : {}),
    },
    explanation: {
      shortReason,
      taskRequirements: unique([
        `${method.name} is eligible for this ${expectedContext.taskType.replaceAll("_", " ")} ${learningMode === "learn" ? "Learn" : "Practice"} route at the ${expectedContext.knowledgeStage.replaceAll("_", " ")} stage.`,
        ...route.explanation.taskRequirements,
      ]).slice(0, 10),
      learnerDeclarations: learnerDeclaration
        ? unique([shortReason, ...route.explanation.learnerDeclarations]).slice(0, 10)
        : route.explanation.learnerDeclarations,
      observations: observed
        ? unique([shortReason, ...route.explanation.observations]).slice(0, 10)
        : route.explanation.observations,
      uncertainties: route.explanation.uncertainties.filter((uncertainty) => ![
        LEGACY_AGENCY_UNCERTAINTY,
        LEGACY_PHASE_UNCERTAINTY,
      ].includes(uncertainty)),
    },
    provenance: {
      routerVersion: compositeRouterVersion(route.provenance.routerVersion),
      profileVersion: composeStudyRouteProfileVersion(
        route.provenance.profileVersion,
        profileVersion,
      ),
      evidenceRefs,
      ruleTrace,
    },
  });
}

export function methodSelectionContextForStudyRoute(routeInput: StudyRoute) {
  const route = StudyRouteSchema.parse(routeInput);
  const activeTargetIds = new Set(activeStudyRouteTargetIds(route));
  const activeStages = route.target.targetStates
    .filter((target) => activeTargetIds.has(target.targetId))
    .map((target) => target.stage);
  if (activeStages.length === 0) {
    throw new Error("A method decision requires at least one active target.");
  }
  return {
    taskType: route.target.taskFamily,
    knowledgeStage: mostSupportiveStage(activeStages),
    learningMode: route.approach.mode === "learn" ? "learn" as const : "study" as const,
  };
}

function validateSelectionAgainstRoute(
  selection: CanonicalMethodSelectionResult,
  context: ReturnType<typeof methodSelectionContextForStudyRoute>,
) {
  if (
    selection.policyVersion !== CANONICAL_METHOD_SELECTION_POLICY_VERSION
    || selection.eligibilityPolicyVersion !== METHOD_ELIGIBILITY_POLICY_VERSION
  ) {
    throw new Error("The method decision does not use the current canonical policy versions.");
  }
  if (
    selection.taskType !== context.taskType
    || selection.knowledgeStage !== context.knowledgeStage
    || selection.learningMode !== context.learningMode
  ) {
    throw new Error("The method decision context does not match the provisional StudyRoute.");
  }
  const expectedEligible = eligibleMethodIdsFor(context);
  if (!sameValues(selection.eligibleMethodIds, expectedEligible)) {
    throw new Error("The method decision's eligible set does not match the current eligibility policy.");
  }
  if (!expectedEligible.includes(selection.selectedMethodId)) {
    throw new Error("The selected method is not eligible for the provisional StudyRoute.");
  }
  const expectedOrder = [
    selection.selectedMethodId,
    ...expectedEligible.filter((methodId) => methodId !== selection.selectedMethodId),
  ];
  if (!sameValues(selection.orderedMethodIds, expectedOrder)) {
    throw new Error("The method decision candidate order is inconsistent with its selection.");
  }
  if (
    selection.baselineMethodId !== expectedEligible[0]
    || selection.changedFromBaseline !== (
      selection.selectedMethodId !== selection.baselineMethodId
    )
    || selection.selectedMethodName !== CORE_METHOD_CATALOG[selection.selectedMethodId].name
  ) {
    throw new Error("The method decision's baseline or display projection is inconsistent.");
  }
  const selectionTrace = selection.ruleTrace.find((entry) => (
    entry.ruleId === CANONICAL_METHOD_SELECTION_POLICY_VERSION
  ));
  if (
    !selectionTrace
    || selectionTrace.result !== `${selection.authority}:${selection.selectedMethodId}`
    || !sameValues(selectionTrace.evidenceRefs, selection.evidenceRefs)
  ) {
    throw new Error("The method decision is missing its exact authority trace.");
  }
}

function methodAlternatives(
  selection: CanonicalMethodSelectionResult,
  route: StudyRoute,
): StudyRouteAlternative[] {
  return selection.orderedMethodIds.slice(1, 3).map((methodId) => ({
    alternativeId: `method-alternative:${methodId}`,
    mode: route.approach.mode,
    executionEnvironment: route.approach.executionEnvironment,
    primaryMethodId: methodId,
    visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
    activeMinutes: route.timing.activeMinutes,
    tradeoff: boundedTradeoff(
      `${CORE_METHOD_CATALOG[methodId].name} also fits this task and stage, but it would use a different practice sequence.`,
    ),
  }));
}

function mostSupportiveStage(stages: readonly KnowledgeStage[]): KnowledgeStage {
  if (stages.includes("novice")) return "novice";
  if (stages.includes("developing")) return "developing";
  return "retrieval_ready";
}

function allocatePositiveMinutes(total: number, count: number) {
  if (!Number.isInteger(total) || !Number.isInteger(count) || count < 1 || total < count) {
    throw new Error("A method recipe needs enough active minutes to budget every required phase.");
  }
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function boundedReason(value: string) {
  const normalized = value.trim();
  const fallback = "YOVA selected an evidence-constrained method for this route.";
  return (normalized.length >= 8 ? normalized : fallback)
    .slice(0, STUDY_ROUTE_REASON_MAX_LENGTH);
}

function boundedTradeoff(value: string) {
  const normalized = value.trim();
  return (normalized.length >= 8 ? normalized : "This option uses a different eligible sequence.")
    .slice(0, 300);
}

function compositeRouterVersion(currentVersion: string) {
  return StudyRouteProvenanceSchema.shape.routerVersion.parse(unique([
    ...currentVersion.split("+").filter(Boolean),
    STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION,
    METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
    METHOD_PRESENTATION_POLICY_VERSION,
  ]).join("+"));
}

function sameValues<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

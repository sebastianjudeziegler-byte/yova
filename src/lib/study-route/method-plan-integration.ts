import {
  CORE_METHOD_CATALOG,
  METHOD_PRESENTATION_POLICY_VERSION,
} from "@/lib/learning/method-catalog";
import {
  type CanonicalMethodSelectionResult,
  CANONICAL_METHOD_SELECTION_POLICY_VERSION,
} from "@/lib/learning/canonical-method-selection";
import {
  eligibleMethodIdsForPolicyVersion,
  METHOD_ELIGIBILITY_POLICY_VERSIONS,
  type KnowledgeStage,
} from "@/lib/learning/method-eligibility";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import {
  methodRuntimeCapabilityFor,
  METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
} from "@/lib/session-generation/method-runtime-capability";
import {
  STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
  boundedAgencyMethodAlternatives,
  resolveStudyRouteAgencyMode,
  studyRouteControlModeForAgencyMode,
  type StudyRouteAgencyModeDecision,
} from "@/lib/study-route/agency-mode-controller";
import {
  StudyRouteProvenanceSchema,
  StudyRouteRuleTraceEntrySchema,
  STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH,
  StudyRouteSchema,
  type StudyRoute,
  type StudyRoutePhase,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";
import { METHOD_DECISION_EVIDENCE_ADAPTER_VERSION } from "@/lib/study-route/method-decision-evidence";
import {
  METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
  METHOD_EVIDENCE_POLICY_VERSION,
} from "@/lib/study-route/method-evidence-policy";
import {
  PERSONALIZATION_ROLLOUT_POLICY_VERSION,
  appendPersonalizationRolloutVersion,
  personalizationRouteVersionFromRouterVersion,
  type PersonalizationRolloutDecision,
} from "@/lib/study-route/personalization-rollout";
import {
  STUDY_ROUTE_REASON_MAX_LENGTH,
} from "@/lib/study-route/scalar-contract";
import { composeStudyRouteProfileVersion } from "@/lib/study-route/provenance-version";

export const STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION =
  "study_route_method_plan_integration_v1" as const;
export const STUDY_ROUTE_ROUTER_HISTORY_COMPACTION_VERSION =
  "study_route.router_history_compaction_v1" as const;

/**
 * Reads both the bounded current router manifest and any exact predecessor
 * components archived by the version compactor.
 */
export function studyRouteProvenanceIncludesRouterComponent(
  provenance: Pick<StudyRoute["provenance"], "routerVersion" | "ruleTrace">,
  component: string,
) {
  if (provenance.routerVersion.split("+").includes(component)) return true;
  return provenance.ruleTrace.some((entry) => (
    entry.ruleId === STUDY_ROUTE_ROUTER_HISTORY_COMPACTION_VERSION
    && entry.evidenceRefs.includes(`router-component:${component}`)
  ));
}

const LEGACY_AGENCY_UNCERTAINTY =
  "The legacy record does not show who selected the route or which control mode was active.";
const LEGACY_PHASE_UNCERTAINTY =
  "The intended phase skeleton comes from the method contract rather than a saved executed sequence.";

export type StudyRouteMethodDecision = {
  selection: CanonicalMethodSelectionResult;
  /** Authorized profile/evidence snapshot used to create the selection. */
  profileVersion: string;
  /** Authorized canonical control-mode resolution for this new route. */
  agencyMode?: StudyRouteAgencyModeDecision;
  /** Server-owned cohort assignment for new route issuance. */
  rolloutDecision?: PersonalizationRolloutDecision;
  /**
   * Optional immutable predecessor choice set. Post-commit changes use this
   * to rotate choices without revealing a previously hidden eligible method.
   */
  boundedChoiceMethodIds?: readonly CanonicalMethodSelectionResult["selectedMethodId"][];
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
  const alternatives = boundedAgencyMethodAlternatives({
    route,
    orderedMethodIds: decision.boundedChoiceMethodIds
      ?? decision.selection.orderedMethodIds,
    selectedMethodId: methodId,
    allowedMethodIds: decision.boundedChoiceMethodIds,
    eligibilityPolicyVersion: decision.selection.eligibilityPolicyVersion,
  });
  const method = CORE_METHOD_CATALOG[methodId];
  const shortReason = boundedReason(decision.selection.learnerFacingReason);
  const suppliedAgencyMode = decision.agencyMode
    ?? resolveStudyRouteAgencyMode();
  const effectiveAgencyMode = decision.selection.authority === "learner_choice"
    ? {
        mode: "ill_customize" as const,
        source: "learner_choice" as const,
        uncertainty: null,
        evidenceRefs: decision.selection.evidenceRefs,
      }
    : suppliedAgencyMode;
  const learnerDeclaration = decision.selection.authority === "learner_choice"
    || decision.selection.authority === "authorized_declaration";
  const observed = decision.selection.authority === "observed_outcomes"
    || decision.selection.authority === "continuity";
  const evidenceRefs = unique([
    ...route.provenance.evidenceRefs,
    ...decision.selection.evidenceRefs,
    ...effectiveAgencyMode.evidenceRefs,
  ]);
  const presentationTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: METHOD_PRESENTATION_POLICY_VERSION,
    result: "recognizable_method_names",
    reason: "Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.",
    evidenceRefs: [],
  });
  const agencyTrace = StudyRouteRuleTraceEntrySchema.parse({
    ruleId: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
    result: `${effectiveAgencyMode.mode}:${effectiveAgencyMode.source}:alternatives:${alternatives.map((alternative) => alternative.primaryMethodId).join(",") || "none"}`,
    reason: effectiveAgencyMode.source === "learner_choice"
      ? "The learner chose this exact route-bound method, so the shared agency controller recorded learner customization and kept at most two eligible, deliverable alternatives."
      : effectiveAgencyMode.uncertainty
        ? `${effectiveAgencyMode.uncertainty} The shared agency controller kept at most two eligible, deliverable alternatives.`
        : `The authorized canonical control-mode answer selected ${effectiveAgencyMode.mode}; the shared agency controller kept at most two eligible, deliverable alternatives.`,
    evidenceRefs: effectiveAgencyMode.evidenceRefs,
  });
  const rolloutTrace = decision.rolloutDecision
    ? StudyRouteRuleTraceEntrySchema.parse({
        ruleId: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
        result: decision.rolloutDecision.routeVersion,
        reason: "The server-owned staged rollout selected the version for new route issuance; it did not alternate methods or create method evidence.",
        evidenceRefs: [],
      })
    : null;
  const existingRolloutTrace = route.provenance.ruleTrace.filter((entry) => (
    entry.ruleId === PERSONALIZATION_ROLLOUT_POLICY_VERSION
  ));
  if (
    existingRolloutTrace.length > 1
    || (existingRolloutTrace[0]
      && rolloutTrace
      && !sameValues(
        [
          existingRolloutTrace[0].result,
          existingRolloutTrace[0].reason,
          ...existingRolloutTrace[0].evidenceRefs,
        ],
        [rolloutTrace.result, rolloutTrace.reason, ...rolloutTrace.evidenceRefs],
      ))
  ) {
    throw new Error("The StudyRoute has inconsistent personalization-rollout provenance.");
  }
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
  const routerDecision = compositeRouterVersion(
    route.provenance.routerVersion,
    decision.rolloutDecision,
  );
  const routerCompactionTrace = routerDecision.compactedComponents
    ? StudyRouteRuleTraceEntrySchema.parse({
        ruleId: STUDY_ROUTE_ROUTER_HISTORY_COMPACTION_VERSION,
        result: "prior_router_chain_compacted",
        reason: "The bounded routerVersion keeps the complete current method and rollout policy set. The exact ordered predecessor router components remain in this trace for audit and rollback.",
        evidenceRefs: routerDecision.compactedComponents.map((component) => (
          `router-component:${component}`
        )),
      })
    : null;
  const ruleTrace = [
    ...route.provenance.ruleTrace,
    ...(rolloutTrace && existingRolloutTrace.length === 0 ? [rolloutTrace] : []),
    ...(routerCompactionTrace ? [routerCompactionTrace] : []),
    StudyRouteRuleTraceEntrySchema.parse({
      ruleId: METHOD_DECISION_EVIDENCE_ADAPTER_VERSION,
      result: "authorized_context_applied",
      reason: "Only structured learner declarations and exact route-bound outcomes allowed by the learner's personalization controls entered method routing.",
      evidenceRefs: [],
    }),
    StudyRouteRuleTraceEntrySchema.parse({
      ruleId: METHOD_EVIDENCE_POLICY_VERSION,
      result: "thresholded_outcome_evidence",
      reason: "Method outcomes can rank an eligible method only after the versioned session, checked-answer, and distinct-study-day evidence minimums are met.",
      evidenceRefs: [],
    }),
    StudyRouteRuleTraceEntrySchema.parse({
      ruleId: METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
      result: "comparison_context_required",
      reason: "Outcome evidence may enter method routing only after the versioned task, stage, mode, environment, difficulty, duration, support, target-relationship, and assessment context matches.",
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
    agencyTrace,
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
      controlMode: studyRouteControlModeForAgencyMode(effectiveAgencyMode.mode),
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
      ].includes(uncertainty)).concat(
        effectiveAgencyMode.uncertainty ? [effectiveAgencyMode.uncertainty] : [],
      ).filter((uncertainty, index, values) => (
        values.indexOf(uncertainty) === index
      )).slice(0, 10),
    },
    provenance: {
      routerVersion: routerDecision.routerVersion,
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
    || !METHOD_ELIGIBILITY_POLICY_VERSIONS.includes(
      selection.eligibilityPolicyVersion,
    )
  ) {
    throw new Error("The method decision does not use a supported canonical policy version.");
  }
  if (
    selection.taskType !== context.taskType
    || selection.knowledgeStage !== context.knowledgeStage
    || selection.learningMode !== context.learningMode
  ) {
    throw new Error("The method decision context does not match the provisional StudyRoute.");
  }
  const expectedEligible = eligibleMethodIdsForPolicyVersion(
    context,
    selection.eligibilityPolicyVersion,
  );
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

function compositeRouterVersion(
  currentVersion: string,
  rolloutDecision?: PersonalizationRolloutDecision,
) {
  const currentComponents = unique(currentVersion.split("+").filter(Boolean));
  const requiredMethodComponents = [
    STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION,
    METHOD_DECISION_EVIDENCE_ADAPTER_VERSION,
    METHOD_EVIDENCE_POLICY_VERSION,
    METHOD_EVIDENCE_COMPARABILITY_POLICY_VERSION,
    METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
    METHOD_PRESENTATION_POLICY_VERSION,
    STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
  ] as const;
  const existingRolloutVersion = personalizationRouteVersionFromRouterVersion(
    currentVersion,
  );
  if (
    rolloutDecision
    && existingRolloutVersion
    && existingRolloutVersion !== rolloutDecision.routeVersion
  ) {
    throw new Error("A versioned StudyRoute cannot change personalization cohorts in place.");
  }
  const rolloutComponents = rolloutDecision
    ? appendPersonalizationRolloutVersion(
        requiredMethodComponents.join("+"),
        rolloutDecision,
      ).split("+").filter((component) => (
        !requiredMethodComponents.includes(
          component as (typeof requiredMethodComponents)[number],
        )
      ))
    : existingRolloutVersion
      ? [PERSONALIZATION_ROLLOUT_POLICY_VERSION, existingRolloutVersion]
      : [];
  const preferredComponents = unique([
    ...currentComponents,
    ...requiredMethodComponents,
    ...rolloutComponents,
  ]);
  const preferredVersion = preferredComponents.join("+");
  if (preferredVersion.length <= STUDY_ROUTE_ROUTER_VERSION_MAX_LENGTH) {
    return {
      routerVersion: StudyRouteProvenanceSchema.shape.routerVersion.parse(
        preferredVersion,
      ),
      compactedComponents: null,
    } as const;
  }

  const compactedVersion = unique([
    ...requiredMethodComponents,
    ...rolloutComponents,
  ]).join("+");
  return {
    routerVersion: StudyRouteProvenanceSchema.shape.routerVersion.parse(
      compactedVersion,
    ),
    compactedComponents: currentComponents,
  } as const;
}

function sameValues<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

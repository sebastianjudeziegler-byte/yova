import {
  BLURTING_MAX_ACTIVE_MINUTES,
  BLURTING_ORDERED_PHASES,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  METHOD_RECIPE_POLICY_VERSION,
  selectMethodRecipe,
  type BlurtingMethodRecipeDecision,
} from "@/lib/learning/method-recipes";
import { METHOD_RUNTIME_CAPABILITY_POLICY_VERSION } from "@/lib/session-generation/method-runtime-capability";
import type {
  StudyRoute,
  StudyRouteExecutionEnvironment,
  StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetStates } from "@/lib/study-route/targets";

export const BLURTING_RECIPE_RUNTIME_VERSION =
  "blurting_recipe_runtime_v1" as const;

export const BLURTING_COMPARISON_SOURCE_TYPES = Object.freeze([
  "user_materials",
  "trusted_external_source",
] as const);

export const BLURTING_PHASE_IDS = Object.freeze([
  "method-1-retrieve",
  "method-2-repair",
  "method-3-transfer",
] as const);

export const BLURTING_FINAL_CHECK_EVIDENCE_PREFIX =
  "blurting-final-check:" as const;

export const BLURTING_RECIPE_RUNTIME_RESULTS = Object.freeze({
  inside_yova: "full:dedicated_runtime:recovery_none",
  outside_yova: "full:outside_source_contract:recovery_none",
} as const satisfies Record<StudyRouteExecutionEnvironment, string>);

export const BLURTING_RECIPE_RUNTIME_REASONS = Object.freeze({
  inside_yova: "Blurting uses the dedicated broad-recall runtime inside YOVA: recall stays minimally cued, repair compares with the committed source, and transfer closes the source again.",
  outside_yova: "Blurting uses the outside-source broad-recall contract: recall stays minimally cued, repair compares with the committed source, and transfer closes the source again.",
} as const satisfies Record<StudyRouteExecutionEnvironment, string>);

type FrozenRuleTraceEntry = Readonly<
  Omit<StudyRouteRuleTraceEntry, "evidenceRefs"> & {
    evidenceRefs: readonly string[];
  }
>;

/**
 * Produces the exact current policy trace appended by an active Blurting
 * revision. Older revisions may remain earlier in the append-only history;
 * the reason stays owned by the pure selector so route and eligibility policy
 * cannot silently drift apart.
 */
export function blurtingMethodRecipeTrace(
  decision: BlurtingMethodRecipeDecision,
): FrozenRuleTraceEntry {
  return freezeTrace({
    ruleId: METHOD_RECIPE_POLICY_VERSION,
    result: `recipe:${decision.recipeId}`,
    reason: decision.reason,
    evidenceRefs: [],
  });
}

/** Produces the exact current runtime trace for one execution environment. */
export function blurtingRecipeRuntimeTrace(
  executionEnvironment: StudyRouteExecutionEnvironment,
): FrozenRuleTraceEntry {
  return freezeTrace({
    ruleId: BLURTING_RECIPE_RUNTIME_VERSION,
    result: BLURTING_RECIPE_RUNTIME_RESULTS[executionEnvironment],
    reason: BLURTING_RECIPE_RUNTIME_REASONS[executionEnvironment],
    evidenceRefs: [],
  });
}

/** Mirrors the route allocator: divide evenly, then give remainders to early phases. */
export function allocateBlurtingPhaseMinutes(activeMinutes: number) {
  if (
    !Number.isInteger(activeMinutes)
    || activeMinutes < BLURTING_PHASE_IDS.length
    || activeMinutes > BLURTING_MAX_ACTIVE_MINUTES
  ) {
    throw new Error(`Blurting phase allocation requires between ${BLURTING_PHASE_IDS.length} and ${BLURTING_MAX_ACTIVE_MINUTES} whole active minutes.`);
  }
  const baseMinutes = Math.floor(activeMinutes / BLURTING_PHASE_IDS.length);
  const remainder = activeMinutes % BLURTING_PHASE_IDS.length;
  return Object.freeze(BLURTING_PHASE_IDS.map((_, index) => (
    baseMinutes + (index < remainder ? 1 : 0)
  )) as [number, number, number]);
}

export function blurtingFinalCheckEvidenceId(targetId: string) {
  return `${BLURTING_FINAL_CHECK_EVIDENCE_PREFIX}${targetId}` as const;
}

/** True only for a complete, internally consistent active Blurting route. */
export function isBlurtingStudyRoute(route: StudyRoute) {
  return route.approach.visibleSupportingTechniqueId
    === BLURTING_SUPPORTING_TECHNIQUE_ID
    && blurtingStudyRouteIssue(route) === null;
}

/**
 * Validates the bounded StudyRoute representation of Blurting. Rollout state
 * is deliberately absent: the flag controls issuance, not whether an already
 * signed draft or committed route remains readable.
 */
export function blurtingStudyRouteIssue(route: StudyRoute): string | null {
  if (
    route.approach.visibleSupportingTechniqueId
    && route.approach.visibleSupportingTechniqueId
      !== BLURTING_SUPPORTING_TECHNIQUE_ID
  ) {
    return "This StudyRoute uses an unsupported visible supporting-technique marker.";
  }
  if (route.agency.alternatives.some(alternativeRepresentsBlurting)) {
    return "Blurting cannot be represented as a method-only StudyRoute alternative in recipe v1.";
  }

  const routerComponents = route.provenance.routerVersion.split("+");
  const runtimeComponentCount = routerComponents.filter((component) => (
    component === BLURTING_RECIPE_RUNTIME_VERSION
  )).length;
  const techniqueIsBlurting = route.approach.visibleSupportingTechniqueId
    === BLURTING_SUPPORTING_TECHNIQUE_ID;
  const nameLooksLikeBlurting = route.approach.visibleMethodName.toLowerCase()
    === BLURTING_VISIBLE_METHOD_NAME.toLowerCase();
  const hasAnyBlurtingSignal = techniqueIsBlurting
    || nameLooksLikeBlurting
    || runtimeComponentCount > 0;

  if (!hasAnyBlurtingSignal) return null;

  if (
    !techniqueIsBlurting
    || route.approach.visibleMethodName !== BLURTING_VISIBLE_METHOD_NAME
    || runtimeComponentCount !== 1
  ) {
    return "An active Blurting route requires the exact technique ID, visible name, and one blurting_recipe_runtime_v1 router component together.";
  }
  if (routerComponents.includes(METHOD_RUNTIME_CAPABILITY_POLICY_VERSION)) {
    return "An active Blurting route must replace the generic method runtime router component with its dedicated recipe-runtime component.";
  }

  const activeTargets = activeStudyRouteTargetStates(route);
  const knowledgeStage = mostSupportiveStage(
    activeTargets.map((target) => target.stage),
  );
  const decision = selectMethodRecipe({
    // Validation always recognizes a previously issued recipe. The server-only
    // rollout flag remains responsible for deciding whether to issue one.
    blurtingEnabled: true,
    learningMode: route.approach.mode === "practice" ? "study" : "learn",
    primaryMethodId: route.approach.primaryMethodId,
    taskType: route.target.taskFamily,
    knowledgeStage,
    isReview: route.timing.durationSource === "scheduled_review",
    activeMinutes: route.timing.activeMinutes,
    activeTargetCount: activeTargets.length,
    comparisonSourceAvailable: hasBlurtingComparisonSource(route),
  });
  if (decision.kind !== "recipe") {
    return `The active Blurting marker is outside the method recipe boundary. ${decision.reason}`;
  }
  if (route.execution.initialSupport !== "independent_start") {
    return "Blurting must begin with independent recall rather than a supported start.";
  }
  if (route.execution.activityLimit < BLURTING_PHASE_IDS.length) {
    return "Blurting requires capacity for its three bounded learning phases.";
  }

  const currentRecipeTrace = latestRuleTraceEntry(
    route.provenance.ruleTrace,
    [METHOD_RECIPE_POLICY_VERSION],
  );
  if (
    !currentRecipeTrace
    || !sameTrace(currentRecipeTrace, blurtingMethodRecipeTrace(decision))
  ) {
    return "An active Blurting route requires the latest method_recipe_v1 trace to match its current route facts.";
  }

  const currentRuntimeTrace = latestRuleTraceEntry(
    route.provenance.ruleTrace,
    [METHOD_RUNTIME_CAPABILITY_POLICY_VERSION, BLURTING_RECIPE_RUNTIME_VERSION],
  );
  if (
    !currentRuntimeTrace
    || !sameTrace(
      currentRuntimeTrace,
      blurtingRecipeRuntimeTrace(route.approach.executionEnvironment),
    )
  ) {
    return "An active Blurting route requires its latest runtime-policy trace to be the exact current recipe-runtime trace for its execution environment.";
  }

  const phases = route.execution.orderedPhases;
  if (
    phases.length !== BLURTING_ORDERED_PHASES.length
    || phases.some((phase, index) => (
      phase.methodPhase !== BLURTING_ORDERED_PHASES[index]
      || phase.phaseId !== BLURTING_PHASE_IDS[index]
    ))
  ) {
    return "Blurting requires the canonical retrieve, repair, then transfer phase identities and sequence.";
  }
  const activeTargetIds = activeTargets.map((target) => target.targetId);
  if (phases.some((phase) => !sameStringSet(phase.targetIds, activeTargetIds))) {
    return "Every Blurting phase must cover the exact active target set.";
  }
  const expectedPhaseMinutes = allocateBlurtingPhaseMinutes(
    route.timing.activeMinutes,
  );
  if (phases.some((phase, index) => (
    phase.activeMinutes !== expectedPhaseMinutes[index]
  ))) {
    return "Blurting phase minutes must use the deterministic earliest-remainder allocation.";
  }

  const evidence = route.execution.completionEvidence;
  if (
    evidence.length !== activeTargetIds.length
    || evidence.some((item) => (
      item.kind !== "verification"
      || !item.requiresIndependentAttempt
      || item.targetIds.length !== 1
      || !activeTargetIds.includes(item.targetIds[0]!)
      || item.evidenceId !== blurtingFinalCheckEvidenceId(item.targetIds[0]!)
    ))
    || !sameStringSet(
      evidence.map((item) => item.targetIds[0]!),
      activeTargetIds,
    )
  ) {
    return "Blurting requires one independent final verification evidence item for each active target.";
  }

  return null;
}

function hasBlurtingComparisonSource(route: StudyRoute) {
  const source = route.target.sourceRequirements;
  return source.groundingRequired
    && source.requiredSourceIds.length >= 1
    && (BLURTING_COMPARISON_SOURCE_TYPES as readonly string[]).includes(
      source.sourceType,
    );
}

function alternativeRepresentsBlurting(
  alternative: StudyRoute["agency"]["alternatives"][number],
) {
  return alternative.visibleMethodName.toLowerCase()
    === BLURTING_VISIBLE_METHOD_NAME.toLowerCase()
    || alternative.alternativeId === BLURTING_SUPPORTING_TECHNIQUE_ID
    || alternative.alternativeId.endsWith(`:${BLURTING_SUPPORTING_TECHNIQUE_ID}`);
}

function mostSupportiveStage(
  stages: readonly StudyRoute["target"]["targetStates"][number]["stage"][],
) {
  if (stages.includes("novice")) return "novice" as const;
  if (stages.includes("developing")) return "developing" as const;
  return "retrieval_ready" as const;
}

function sameTrace(
  actual: StudyRouteRuleTraceEntry,
  expected: FrozenRuleTraceEntry,
) {
  return actual.ruleId === expected.ruleId
    && actual.result === expected.result
    && actual.reason === expected.reason
    && sameStrings(actual.evidenceRefs, expected.evidenceRefs);
}

function latestRuleTraceEntry(
  entries: readonly StudyRouteRuleTraceEntry[],
  ruleIds: readonly string[],
) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (ruleIds.includes(entry.ruleId)) return entry;
  }
  return null;
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return sameStrings(
    [...new Set(left)].sort((a, b) => a.localeCompare(b)),
    [...new Set(right)].sort((a, b) => a.localeCompare(b)),
  );
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function freezeTrace(entry: StudyRouteRuleTraceEntry): FrozenRuleTraceEntry {
  Object.freeze(entry.evidenceRefs);
  return Object.freeze(entry);
}

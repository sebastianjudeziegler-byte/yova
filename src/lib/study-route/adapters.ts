import type {
  LearningPlan,
  LearningPlanSession,
  SessionResource,
} from "@/lib/domain";
import { CORE_METHOD_CATALOG, type CoreMethodId } from "@/lib/learning/method-catalog";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import {
  classifyLearningTask,
  methodIdFromText,
  type KnowledgeStage,
} from "@/lib/learning/method-router";
import { stableFingerprint } from "@/lib/stable-fingerprint";
import {
  STUDY_ROUTE_SCHEMA_VERSION,
  StudyRouteSchema,
  type StudyRoute,
  type StudyRouteCompletionEvidence,
  type StudyRouteIdentity,
  type StudyRoutePhase,
  type StudyRouteTargetState,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";
import {
  STUDY_ROUTE_METHOD_MAX_LENGTH,
  STUDY_ROUTE_OUTCOME_MAX_LENGTH,
  STUDY_ROUTE_REASON_MAX_LENGTH,
} from "@/lib/study-route/scalar-contract";

export const LEGACY_STUDY_ROUTE_ADAPTER_VERSION = "legacy_adapter_v1" as const;
export const RESOURCE_STUDY_ROUTE_ADAPTER_VERSION = "resource_adapter_v1" as const;

export const LEGACY_STUDY_ROUTE_ISSUES = [
  "agency_unknown",
  "difficulty_unknown",
  "duration_provenance_unknown",
  "legacy_identity_canonicalized",
  "legacy_route_time_reconstructed",
  "method_unclassified",
  "phase_structure_derived",
  "source_identity_missing",
  "synthetic_target_id",
  "target_stage_inferred_from_mode",
  "target_state_reconstructed",
  "task_family_inferred",
] as const;

export type LegacyStudyRouteIssue = (typeof LEGACY_STUDY_ROUTE_ISSUES)[number];

export type StudyRouteIdentitySeed = {
  routeLineageId?: string;
  routeRevisionId?: string;
  revisionNumber?: number;
  lifecycleStatus?: "provisional" | "committed";
  createdAt?: string;
  committedAt?: string;
};

export type LegacyStudyRouteAdaptation = {
  route: StudyRoute | null;
  issues: LegacyStudyRouteIssue[];
};

export type LegacyPlanSessionRouteInput = {
  plan: LearningPlan;
  session: LearningPlanSession;
  identity?: StudyRouteIdentitySeed;
  /**
   * The timestamp at which this canonical legacy snapshot is created. Callers
   * that intend to persist the route must provide it. Pure legacy selectors
   * omit it and receive a deterministic reconstruction timestamp plus an
   * explicit compatibility issue.
   */
  adaptedAt?: string;
};

export type SessionResourceRouteInput = LegacyPlanSessionRouteInput & {
  resource?: SessionResource;
};

export type LegacySessionRouteProjection = Pick<
  LearningPlanSession,
  "method" | "methodReason" | "estimatedMinutes" | "learningMode" | "topicIds" | "completionEvidence"
>;

/**
 * Canonicalizes the planned promise carried by a legacy plan-session row.
 * This is deliberately a compatibility snapshot, not a reconstruction of
 * historical router confidence, agency, or prior revisions.
 */
export function adaptLegacySessionToStudyRoute(
  input: LegacyPlanSessionRouteInput,
): LegacyStudyRouteAdaptation {
  return buildAdaptedRoute({ ...input, source: "plan" });
}

/** Required Milestone 1 adapter name. */
export function legacyPlanSessionToStudyRoute(
  input: LegacyPlanSessionRouteInput,
): StudyRoute | null {
  return adaptLegacySessionToStudyRoute(input).route;
}

/**
 * Canonicalizes what a validated saved resource says actually ran. Resource
 * structure wins over plan prose, while stable targets and the original plan
 * promise remain available on the legacy session itself.
 */
export function adaptSessionResourceToStudyRoute(
  input: SessionResourceRouteInput,
): LegacyStudyRouteAdaptation {
  return buildAdaptedRoute({
    ...input,
    resource: input.resource ?? input.session.resource,
    source: "resource",
  });
}

/** Required Milestone 1 adapter name. */
export function sessionResourceToStudyRoute(
  input: SessionResourceRouteInput,
): StudyRoute | null {
  return adaptSessionResourceToStudyRoute(input).route;
}

/**
 * Keeps legacy RPC and component shapes working while route-aware readers are
 * rolled out. It intentionally projects only fields the route truly owns.
 */
export function studyRouteToLegacySessionProjection(
  routeInput: StudyRoute,
): LegacySessionRouteProjection {
  const route = StudyRouteSchema.parse(routeInput);
  return {
    method: route.approach.visibleMethodName,
    methodReason: route.explanation.shortReason,
    estimatedMinutes: route.timing.activeMinutes,
    learningMode: route.approach.mode === "learn" ? "learn" : "study",
    topicIds: activeStudyRouteTargetIds(route),
    completionEvidence: route.execution.completionEvidence.map((evidence) => evidence.description),
  };
}

export function legacyMethodIdFromText(value: string): CoreMethodId | null {
  const direct = methodIdFromText(value);
  if (direct) return direct;
  const normalized = value.trim().toLocaleLowerCase();
  if (/\b(mixed practice|case comparison|compare cases)\b/.test(normalized)) {
    return "interleaved_practice";
  }
  if (/\b(independent confirmation)\b/.test(normalized)) {
    return "retrieval_practice";
  }
  if (/\b(brief transfer check|misconception repair|guided (?:concept )?repair|independent application)\b/.test(normalized)) {
    return "practice_test_error_repair";
  }
  return null;
}

export function deterministicLegacyRouteUuid(value: unknown, purpose: string) {
  const first = stableFingerprint({ purpose, half: 1, value }, "uuid").split(":")[1]!;
  const second = stableFingerprint({ purpose, half: 2, value }, "uuid").split(":")[1]!;
  const raw = `${first}${second}`.slice(0, 32);
  const versioned = `${raw.slice(0, 12)}5${raw.slice(13)}`;
  const variant = `${versioned.slice(0, 16)}8${versioned.slice(17)}`;
  return `${variant.slice(0, 8)}-${variant.slice(8, 12)}-${variant.slice(12, 16)}-${variant.slice(16, 20)}-${variant.slice(20)}`;
}

function buildAdaptedRoute(
  input: LegacyPlanSessionRouteInput & {
    source: "plan" | "resource";
    resource?: SessionResource;
  },
): LegacyStudyRouteAdaptation {
  const { plan, session, source } = input;
  const resource = source === "resource" ? input.resource : undefined;
  const issues = new Set<LegacyStudyRouteIssue>([
    "agency_unknown",
    "difficulty_unknown",
    "duration_provenance_unknown",
    "target_state_reconstructed",
  ]);
  const methodId = resource?.methodBriefing?.methodId
    ?? legacyMethodIdFromText(session.method);
  if (!methodId) {
    issues.add("method_unclassified");
    return { route: null, issues: [...issues].sort() };
  }

  const classification = resource?.routingContext
    ? {
      taskType: resource.routingContext.taskType,
      confidence: "clear" as const,
    }
    : resource?.methodBriefing
      ? {
        taskType: resource.methodBriefing.taskType,
        confidence: "clear" as const,
      }
      : classifyLearningTask([
        plan.kind,
        plan.topic,
        session.title,
        session.objective,
        session.method,
      ].join(" "));
  if (!resource?.routingContext && !resource?.methodBriefing) {
    issues.add("task_family_inferred");
  }

  const targetStates = legacyTargetStates({
    plan,
    session,
    resource,
    issues,
  });
  const activeTargetIds = targetStates.map((target) => target.targetId);
  const activeMinutes = boundedActiveMinutes(
    resource?.cacheContext?.effectiveMinutes ?? session.estimatedMinutes,
  );
  const phases = legacyExecutionPhases({
    source,
    resource,
    methodId,
    learningMode: resource?.methodBriefing?.learningMode ?? session.learningMode,
    executionEnvironment: plan.studyMode,
    reviewType: session.reviewType,
    activeMinutes,
    targetIds: activeTargetIds,
    issues,
  });
  const lifecycleStatus = input.identity?.lifecycleStatus
    ?? (source === "resource" || plan.status !== "draft" ? "committed" : "provisional");
  const reconstructedTime = source === "resource"
    ? resource?.generatedAt ?? plan.createdAt
    : plan.createdAt;
  const createdAt = input.identity?.createdAt ?? input.adaptedAt ?? reconstructedTime;
  if (!input.adaptedAt && !input.identity?.createdAt) {
    issues.add("legacy_route_time_reconstructed");
  }
  const identity = legacyRouteIdentity({
    plan,
    session,
    source,
    identity: input.identity,
    lifecycleStatus,
    createdAt,
    adaptedAt: input.adaptedAt,
    resource,
    issues,
  });
  const completionEvidence = legacyCompletionEvidence({
    session,
    resource,
    taskFamily: classification.taskType,
    executionEnvironment: plan.studyMode,
    targetIds: activeTargetIds,
  });
  const requiredSourceIds = plan.sourceMode === "user_materials"
    ? unique((plan.materials ?? []).map((material) => material.id))
    : [];
  if (plan.sourceMode === "user_materials" && requiredSourceIds.length === 0) {
    issues.add("source_identity_missing");
    requiredSourceIds.push("legacy:unresolved-material");
  }
  const shortReason = boundedReason(
    source === "resource" ? resource?.methodBriefing?.why ?? resource?.rationale : session.methodReason,
    `Use ${resource?.methodBriefing?.name ?? session.method} for this session.`,
  );
  const uncertainties = issueExplanations([...issues]);
  const evidenceRefs = unique(targetStates.flatMap((target) => target.evidenceRefs));
  const route = StudyRouteSchema.parse({
    identity,
    target: {
      taskFamily: classification.taskType,
      desiredOutcome: boundedOutcome(session.objective, session.title),
      targetStates,
      sourceRequirements: {
        sourceType: plan.sourceMode,
        requiredSourceIds,
        groundingRequired: plan.sourceMode === "user_materials",
        instructions: plan.sourceMode === "user_materials"
          ? ["Use the learner's attached material as the factual source for this route."]
          : [],
      },
    },
    approach: {
      mode: (resource?.methodBriefing?.learningMode ?? session.learningMode) === "learn"
        ? "learn"
        : "practice",
      executionEnvironment: plan.studyMode,
      primaryMethodId: methodId,
      visibleMethodName: boundedMethodName(resource?.methodBriefing?.name ?? session.method, methodId),
      confidenceLevel: "unknown",
    },
    timing: {
      activeMinutes,
      elapsedMinutes: activeMinutes,
      durationSource: "legacy_reconstruction",
    },
    execution: {
      orderedPhases: phases,
      difficultyTier: "unknown",
      initialSupport: resource?.supportPlan?.level
        ?? ((resource?.methodBriefing?.learningMode ?? session.learningMode) === "learn"
          ? "supported_start"
          : "independent_start"),
      activityLimit: resource?.deliveryPolicy?.pacing.maximumActivities
        ?? Math.max(1, phases.length),
      completionEvidence,
      deferredTargets: [],
    },
    agency: {
      controlMode: "legacy_unknown",
      selectedBy: "legacy_unknown",
      alternatives: [],
    },
    explanation: {
      shortReason,
      taskRequirements: unique([
        boundedExplanationItem(session.objective),
        ...(session.completionEvidence ?? []).map(boundedExplanationItem),
      ]).slice(0, 10),
      learnerDeclarations: [],
      observations: source === "resource"
        ? ["A validated saved session resource supplies the executed structure in this compatibility snapshot."]
        : [],
      uncertainties,
    },
    provenance: {
      routerVersion: source === "resource"
        ? RESOURCE_STUDY_ROUTE_ADAPTER_VERSION
        : LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
      profileVersion: "legacy_unknown",
      evidenceRefs,
      ruleTrace: [
        {
          ruleId: source === "resource"
            ? "study_route.legacy_resource_adapter"
            : "study_route.legacy_plan_adapter",
          result: source === "resource"
            ? "canonicalized_executed_resource"
            : "canonicalized_planned_promise",
          reason: source === "resource"
            ? "Preserved validated generated-session structure without claiming it was the original router decision."
            : "Preserved the legacy plan-session promise without inventing historical agency or confidence.",
          evidenceRefs,
        },
      ],
    },
  });

  return { route, issues: [...issues].sort() };
}

function legacyRouteIdentity({
  plan,
  session,
  source,
  identity,
  lifecycleStatus,
  createdAt,
  adaptedAt,
  resource,
  issues,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  source: "plan" | "resource";
  identity: StudyRouteIdentitySeed | undefined;
  lifecycleStatus: "provisional" | "committed";
  createdAt: string;
  adaptedAt: string | undefined;
  resource: SessionResource | undefined;
  issues: Set<LegacyStudyRouteIssue>;
}): StudyRouteIdentity {
  const exactPlanId = isUuid(plan.id) ? plan.id : deterministicLegacyRouteUuid(plan.id, "plan");
  const exactSessionId = isUuid(session.id) ? session.id : deterministicLegacyRouteUuid(
    { planId: plan.id, sessionId: session.id },
    "session",
  );
  if (exactPlanId !== plan.id || exactSessionId !== session.id) {
    issues.add("legacy_identity_canonicalized");
  }
  const routeLineageId = identity?.routeLineageId ?? deterministicLegacyRouteUuid(
    { planId: plan.id, sessionId: session.id },
    "route-lineage",
  );
  const routeRevisionId = identity?.routeRevisionId ?? deterministicLegacyRouteUuid(
    {
      planId: plan.id,
      sessionId: session.id,
      source,
      generatedAt: source === "resource" ? resource?.generatedAt ?? null : null,
    },
    "route-revision",
  );
  const committedAt = lifecycleStatus === "committed"
    ? identity?.committedAt ?? adaptedAt ?? createdAt
    : undefined;
  return StudyRouteSchema.shape.identity.parse({
    routeLineageId,
    routeRevisionId,
    revisionNumber: identity?.revisionNumber ?? 1,
    schemaVersion: STUDY_ROUTE_SCHEMA_VERSION,
    lifecycleStatus,
    planId: exactPlanId,
    sessionId: exactSessionId,
    createdAt,
    ...(committedAt ? { committedAt } : {}),
  });
}

function legacyTargetStates({
  plan,
  session,
  resource,
  issues,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  resource: SessionResource | undefined;
  issues: Set<LegacyStudyRouteIssue>;
}): StudyRouteTargetState[] {
  const knowledgeTopics = plan.knowledgeMap?.topics ?? [];
  const directIds = unique([
    ...(session.topicIds ?? []),
    ...(resource?.topicIds ?? []),
    ...(resource?.activities.flatMap((activity) => activity.topicId ? [activity.topicId] : []) ?? []),
  ]).filter(isUuid);
  const targetIds = directIds.length > 0
    ? directIds
    : (session.contentTargets?.length ? session.contentTargets : [session.objective]).map((target, index) => (
      deterministicLegacyRouteUuid(
        { planId: plan.id, sessionId: session.id, target, index },
        "target",
      )
    ));
  if (directIds.length === 0) issues.add("synthetic_target_id");

  return targetIds.map((targetId) => {
    const topic = knowledgeTopics.find((candidate) => candidate.id === targetId);
    const resourceStage = resource?.routingContext?.knowledgeStage;
    if (!topic && !resourceStage) issues.add("target_stage_inferred_from_mode");
    const initialEvidence = topic?.initialEvidence;
    return {
      targetId,
      stage: topic
        ? legacyKnowledgeStage(topic.status)
        : resourceStage ?? (session.learningMode === "learn" ? "novice" : "developing"),
      uncertainty: "unknown" as const,
      evidenceRefs: initialEvidence
        ? [`placement:${targetId}:${initialEvidence.observedAt}`]
        : [],
      ...(initialEvidence ? { lastObservedAt: initialEvidence.observedAt } : {}),
    };
  });
}

function legacyExecutionPhases({
  source,
  resource,
  methodId,
  learningMode,
  executionEnvironment,
  reviewType,
  activeMinutes,
  targetIds,
  issues,
}: {
  source: "plan" | "resource";
  resource: SessionResource | undefined;
  methodId: CoreMethodId;
  learningMode: "learn" | "study";
  executionEnvironment: LearningPlan["studyMode"];
  reviewType: LearningPlanSession["reviewType"];
  activeMinutes: number;
  targetIds: string[];
  issues: Set<LegacyStudyRouteIssue>;
}): StudyRoutePhase[] {
  if (executionEnvironment === "outside_yova") {
    return [{
      phaseId: "outside-work",
      methodPhase: "independent_practice",
      activeMinutes,
      targetIds,
    }];
  }
  if (reviewType) {
    return [{
      phaseId: "quick-review",
      methodPhase: "retrieve",
      activeMinutes,
      targetIds,
    }];
  }

  const resourcePhases = source === "resource"
    ? resource?.activities.flatMap((activity) => activity.methodPhase
      ? [{ methodPhase: activity.methodPhase, weight: activity.estimatedMinutes ?? 1 }]
      : []) ?? []
    : [];
  const phaseInputs = resourcePhases.length > 0 && resourcePhases.length <= activeMinutes
    ? resourcePhases
    : methodFidelityContractForPrompt(methodId, learningMode).orderedPhases.map((methodPhase) => ({
      methodPhase,
      weight: 1,
    }));
  if (resourcePhases.length === 0 || resourcePhases.length > activeMinutes) {
    issues.add("phase_structure_derived");
  }
  const minutes = allocatePositiveMinutes(activeMinutes, phaseInputs.map((phase) => phase.weight));
  return phaseInputs.map((phase, index) => ({
    phaseId: `phase-${index + 1}`,
    methodPhase: phase.methodPhase,
    activeMinutes: minutes[index]!,
    targetIds,
  }));
}

function legacyCompletionEvidence({
  session,
  resource,
  taskFamily,
  executionEnvironment,
  targetIds,
}: {
  session: LearningPlanSession;
  resource: SessionResource | undefined;
  taskFamily: StudyRoute["target"]["taskFamily"];
  executionEnvironment: LearningPlan["studyMode"];
  targetIds: string[];
}): StudyRouteCompletionEvidence[] {
  const descriptions = (session.completionEvidence?.length
    ? session.completionEvidence
    : resource?.coverage?.completionEvidence?.length
      ? resource.coverage.completionEvidence
      : [session.objective]
  ).slice(0, 12);
  const kind: StudyRouteCompletionEvidence["kind"] = executionEnvironment === "outside_yova"
    ? "artifact"
    : taskFamily === "problem_solving" || taskFamily === "programming"
      ? "application"
      : session.learningMode === "learn"
        ? "explanation"
        : "retrieval";
  return descriptions.map((description, index) => ({
    evidenceId: `legacy-evidence-${index + 1}`,
    targetIds,
    kind,
    description: boundedEvidenceDescription(description),
    requiresIndependentAttempt: executionEnvironment === "inside_yova",
  }));
}

function legacyKnowledgeStage(status: "not_started" | "taught" | "evidenced" | "secure"): KnowledgeStage {
  if (status === "not_started") return "novice";
  if (status === "secure") return "retrieval_ready";
  return "developing";
}

function issueExplanations(issues: LegacyStudyRouteIssue[]) {
  const copy: Record<LegacyStudyRouteIssue, string> = {
    agency_unknown: "The legacy record does not show who selected the route or which control mode was active.",
    difficulty_unknown: "The legacy record does not contain a canonical difficulty decision.",
    duration_provenance_unknown: "The duration is preserved, but the legacy record does not show how it was chosen.",
    legacy_identity_canonicalized: "A non-UUID legacy identifier was converted to a deterministic compatibility identifier.",
    legacy_route_time_reconstructed: "The route timestamp is reconstructed because the legacy record has no route creation time.",
    method_unclassified: "The legacy method text cannot be mapped safely to a canonical method.",
    phase_structure_derived: "The intended phase skeleton comes from the method contract rather than a saved executed sequence.",
    source_identity_missing: "The plan requires learner material but its legacy record has no material identifier.",
    synthetic_target_id: "The legacy session has no trustworthy target identifier, so this compatibility target is synthetic.",
    target_stage_inferred_from_mode: "The target stage is a conservative compatibility baseline because no target state was stored.",
    target_state_reconstructed: "Target state is a current legacy snapshot, not proof of the state when the route first ran.",
    task_family_inferred: "The task family is derived from legacy task text rather than a stored routing decision.",
  };
  return issues
    .filter((issue) => issue !== "method_unclassified")
    .map((issue) => copy[issue])
    .slice(0, 10);
}

function allocatePositiveMinutes(total: number, weights: number[]) {
  if (weights.length === 0 || total < weights.length) {
    throw new Error("A route needs enough active minutes to give every phase a positive budget.");
  }
  const safeWeights = weights.map((weight) => Math.max(1, Number.isFinite(weight) ? weight : 1));
  const remaining = total - safeWeights.length;
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const exactExtras = safeWeights.map((weight) => remaining * weight / weightTotal);
  const extras = exactExtras.map(Math.floor);
  let unassigned = remaining - extras.reduce((sum, extra) => sum + extra, 0);
  const remainderOrder = exactExtras
    .map((exact, index) => ({ index, remainder: exact - extras[index]! }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < unassigned; index += 1) {
    extras[remainderOrder[index]!.index]! += 1;
  }
  unassigned = 0;
  return extras.map((extra) => extra + 1);
}

function boundedActiveMinutes(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(180, Math.max(5, Math.round(value)));
}

function boundedOutcome(value: string, fallback: string) {
  const normalized = value.trim() || fallback.trim() || "Complete this session";
  return normalized.length >= 5
    ? normalized.slice(0, STUDY_ROUTE_OUTCOME_MAX_LENGTH)
    : `Learn ${normalized}`.slice(0, STUDY_ROUTE_OUTCOME_MAX_LENGTH);
}

function boundedMethodName(value: string, methodId: CoreMethodId) {
  const normalized = value.trim();
  return (normalized.length >= 2 ? normalized : CORE_METHOD_CATALOG[methodId].name)
    .slice(0, STUDY_ROUTE_METHOD_MAX_LENGTH);
}

function boundedReason(value: string | undefined, fallback: string) {
  const normalized = value?.trim() || fallback;
  return (normalized.length >= 8 ? normalized : fallback)
    .slice(0, STUDY_ROUTE_REASON_MAX_LENGTH);
}

function boundedEvidenceDescription(value: string) {
  const normalized = value.trim() || "Complete the planned evidence check.";
  return (normalized.length >= 8 ? normalized : `Complete: ${normalized}`).slice(0, 300);
}

function boundedExplanationItem(value: string) {
  const normalized = value.trim();
  return (normalized.length >= 3 ? normalized : `Task: ${normalized || "session"}`).slice(0, 500);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

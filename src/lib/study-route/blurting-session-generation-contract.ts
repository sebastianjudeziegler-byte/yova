import { BLURTING_RUNTIME_FORMAT } from "@/lib/learning/method-recipes";
import {
  BroadRecallRuntimeTargetBindingSchema,
  RetrievalRoundRuntimeSchema,
  type BroadRecallRuntimeTargetBinding,
} from "@/lib/session-generation/method-runtime";
import {
  GeneratedSessionDraftOutputSchema,
  type GeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import {
  isBlurtingStudyRoute,
} from "@/lib/study-route/method-recipe-contract";
import {
  StudyRouteSchema,
  type StudyRouteExecutionEnvironment,
} from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

export const BLURTING_SESSION_GENERATION_CONTRACT_VERSION =
  "blurting_session_generation_v1" as const;

export const BLURTING_SESSION_SOURCE_READINESS =
  "pending_runtime_source_validation" as const;

export const BLURTING_SESSION_DELIVERY_UNAVAILABLE_ISSUE =
  "The broad-recall route and runtime are structurally bound, but the current GeneratedSessionActivity and renderer contracts cannot deliver Blurting: phase-wide target identity cannot use scalar topicId, the generic evidence path would duplicate or misattribute transfer evidence, and retrieval_round still selects the legacy prompt UI. A dedicated multi-target activity shell, renderer, and target-bound completion bridge are required." as const;

/**
 * Deterministic non-evidence scaffolds for the three route-owned phases.
 *
 * These are not learner interactions. They deliberately use the only current
 * activity shape that carries no scalar target, answer, or generic evidence.
 * A future dedicated renderer must replace their generic semantics and drive
 * progression from BroadRecallProgress. Until that renderer and its cache
 * schema exist, `blurtingSessionRuntimeIssue` remains fail closed.
 */
export const BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS = Object.freeze([
  Object.freeze({
    methodPhase: "retrieve" as const,
    label: "BROAD RECALL",
    title: "Recall before checking",
    body: "Complete the closed-source recall in the dedicated Blurting workspace.",
  }),
  Object.freeze({
    methodPhase: "repair" as const,
    label: "SOURCE REPAIR",
    title: "Compare and repair every gap",
    body: "Use the committed source only during this comparison-and-repair phase.",
  }),
  Object.freeze({
    methodPhase: "transfer" as const,
    label: "FRESH CHECK",
    title: "Transfer with the source closed",
    body: "Complete the target-bound transfer check in the dedicated Blurting workspace.",
  }),
] as const);

export type BlurtingSessionGenerationRouteIdentity = Readonly<{
  planId: string;
  sessionId: string;
  routeRevisionId: string;
}>;

/**
 * Criteria attached by trusted server code after source-to-target grounding.
 * Generated session content is never allowed to define this expected value;
 * otherwise two plausible target rubrics could be swapped without detection.
 */
export type BlurtingSessionRuntimeTargetContract = Readonly<{
  targetId: string;
  evidenceId: string;
  concept: string;
  comparisonCriterion: string;
  transferSuccessCriterion: string;
}>;

type BlurtingGenerationPhase = Readonly<{
  phaseId: string;
  methodPhase: "retrieve" | "repair" | "transfer";
  activeMinutes: number;
  targetIds: readonly string[];
}>;

type BlurtingGenerationEvidence = Readonly<{
  evidenceId: string;
  targetId: string;
  kind: "verification";
  description: string;
  requiresIndependentAttempt: true;
}>;

/**
 * The route-owned identity a future Blurting runtime must deliver exactly.
 *
 * This contract proves only that a committed route authorizes this shape. It
 * does not assert that source material is ready or that a renderer/runtime can
 * deliver it. Callers must keep those delivery capabilities fail closed.
 */
export type BlurtingSessionGenerationContract = Readonly<{
  version: typeof BLURTING_SESSION_GENERATION_CONTRACT_VERSION;
  identity: BlurtingSessionGenerationRouteIdentity;
  executionEnvironment: StudyRouteExecutionEnvironment;
  runtimeFormat: typeof BLURTING_RUNTIME_FORMAT;
  sourceReadiness: typeof BLURTING_SESSION_SOURCE_READINESS;
  targetIds: readonly string[];
  orderedPhases: readonly BlurtingGenerationPhase[];
  completionEvidence: readonly BlurtingGenerationEvidence[];
}>;

/**
 * Returns a generation identity only for the exact committed Blurting route
 * named by the trusted plan/session/revision tuple. There is deliberately no
 * public enablement flag or boolean authorization that could be detached from
 * the committed route.
 */
export function blurtingSessionGenerationContract(
  routeInput: unknown,
  expectedIdentity: BlurtingSessionGenerationRouteIdentity,
): BlurtingSessionGenerationContract | null {
  const parsed = StudyRouteSchema.safeParse(routeInput);
  if (!parsed.success) return null;

  const route = parsed.data;
  if (
    route.identity.lifecycleStatus !== "committed"
    || route.identity.planId !== expectedIdentity.planId
    || route.identity.sessionId !== expectedIdentity.sessionId
    || route.identity.routeRevisionId !== expectedIdentity.routeRevisionId
    || !isBlurtingStudyRoute(route)
  ) {
    return null;
  }

  const targetIds = activeStudyRouteTargetIds(route);
  const completionEvidence = targetIds.flatMap((targetId) => {
    const evidence = route.execution.completionEvidence.find((candidate) => (
      candidate.targetIds.length === 1 && candidate.targetIds[0] === targetId
    ));
    return evidence
      ? [Object.freeze({
          evidenceId: evidence.evidenceId,
          targetId,
          kind: "verification" as const,
          description: evidence.description,
          requiresIndependentAttempt: true as const,
        })]
      : [];
  });
  if (completionEvidence.length !== targetIds.length) return null;

  const canonicalTargetIds = Object.freeze([...targetIds]);
  const orderedPhases = Object.freeze(route.execution.orderedPhases.map((phase) => (
    Object.freeze({
      phaseId: phase.phaseId,
      methodPhase: phase.methodPhase as BlurtingGenerationPhase["methodPhase"],
      activeMinutes: phase.activeMinutes,
      targetIds: Object.freeze([...canonicalTargetIds]),
    })
  )));

  return Object.freeze({
    version: BLURTING_SESSION_GENERATION_CONTRACT_VERSION,
    identity: Object.freeze({
      planId: route.identity.planId,
      sessionId: route.identity.sessionId,
      routeRevisionId: route.identity.routeRevisionId,
    }),
    executionEnvironment: route.approach.executionEnvironment,
    runtimeFormat: BLURTING_RUNTIME_FORMAT,
    sourceReadiness: BLURTING_SESSION_SOURCE_READINESS,
    targetIds: canonicalTargetIds,
    orderedPhases,
    completionEvidence: Object.freeze(completionEvidence),
  });
}

/**
 * Checks route/runtime identity without claiming the result is renderable.
 *
 * A null result proves only that a structurally readable candidate has the
 * exact route identity, trusted target criteria, and three non-evidence phase
 * scaffolds. It does not prove source readiness, cache compatibility, learner
 * progression, rendering, evaluation, or completion evidence. The generation
 * API remains blocked before cache/provider work.
 */
export function blurtingSessionRuntimeBindingIssue(
  sessionInput: unknown,
  routeInput: unknown,
  expectedIdentity: BlurtingSessionGenerationRouteIdentity,
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[],
): string | null {
  const broadRuntimeIndexes = rawBroadRuntimeIndexes(sessionInput);
  const contract = blurtingSessionGenerationContract(routeInput, expectedIdentity);

  if (!contract) {
    return broadRuntimeIndexes.length > 0
      ? "A broad-recall runtime requires the exact committed Blurting StudyRoute."
      : null;
  }

  if (rawActivityTopicIds(sessionInput).some((topicId) => typeof topicId === "string")) {
    return "Broad-recall phases span the complete route target set and cannot carry a scalar per-activity topicId.";
  }

  const parsedSession = GeneratedSessionDraftOutputSchema.safeParse(sessionInput);
  if (!parsedSession.success) {
    return "The broad-recall session candidate must be a structurally readable filled-session draft.";
  }
  const session = parsedSession.data as GeneratedSessionDraft;
  const route = StudyRouteSchema.parse(routeInput);
  const expectedLearningMode = route.approach.mode === "learn" ? "learn" : "study";
  if (
    session.methodBriefing.learningMode !== expectedLearningMode
    || session.methodBriefing.taskType !== route.target.taskFamily
    || session.methodBriefing.methodId !== route.approach.primaryMethodId
    || session.methodBriefing.name !== route.approach.visibleMethodName
  ) {
    return "The broad-recall session learning mode, task type, and method identity must exactly match its committed Blurting route.";
  }
  if (!sameStrings(session.topicIds, contract.targetIds)) {
    return "The broad-recall session targets must exactly match the committed route order.";
  }
  if (
    session.activities.length !== contract.orderedPhases.length
    || session.activities.some((activity, index) => (
      activity.methodPhase !== contract.orderedPhases[index]?.methodPhase
      || activity.estimatedMinutes !== contract.orderedPhases[index]?.activeMinutes
    ))
  ) {
    return "The broad-recall activities must exactly match the committed phase and minute order.";
  }
  if (session.activities.some((activity) => activity.requiredForCompletion !== true)) {
    return "Every broad-recall phase must be required; progression is complete only after the target-bound transfer evaluation.";
  }
  if (session.activities.some((activity) => activity.topicId !== null)) {
    return "Broad-recall phases span the complete route target set and cannot carry a scalar per-activity topicId.";
  }
  if (!hasExactNonEvidenceActivityScaffolds(session)) {
    return "Broad-recall phases must use the exact non-evidence retrieve, repair, and transfer scaffolds without generic questions, answers, teaching, or evidence fields.";
  }

  const retrieveIndex = contract.orderedPhases.findIndex((phase) => (
    phase.methodPhase === "retrieve"
  ));
  const attachedRuntimeIndexes = session.activities.flatMap((activity, index) => (
    activity.methodRuntime ? [index] : []
  ));
  if (
    broadRuntimeIndexes.length !== 1
    || broadRuntimeIndexes[0] !== retrieveIndex
    || attachedRuntimeIndexes.length !== 1
  ) {
    return "The canonical retrieve activity must carry the session's only broad-recall runtime.";
  }

  const runtime = RetrievalRoundRuntimeSchema.safeParse(
    session.activities[retrieveIndex]?.methodRuntime,
  );
  if (!runtime.success || runtime.data.format !== BLURTING_RUNTIME_FORMAT) {
    return "The canonical retrieve activity has an invalid broad-recall runtime.";
  }
  if (!runtime.data.targetBindings) {
    return "The broad-recall runtime is missing its target bindings.";
  }

  const expectedContractIssue = trustedTargetContractIssue(
    expectedTargetContracts,
    contract.completionEvidence,
  );
  if (expectedContractIssue) return expectedContractIssue;

  if (!sameOrderedRuntimeBindings(runtime.data.targetBindings, expectedTargetContracts)) {
    return "The broad-recall runtime target, evidence, concept, and assessment criteria must exactly match the trusted server-owned target contract.";
  }

  return null;
}

/**
 * Delivery-capability boundary for a generated Blurting session.
 *
 * Ordinary sessions still return null. An exact Blurting candidate remains
 * unavailable after binding succeeds because the current activity/cache/UI
 * model cannot truthfully represent its multi-target state machine. Keeping
 * this separate from the binding checker prevents a null binding result from
 * being mistaken for issuance or learner-runtime readiness.
 */
export function blurtingSessionRuntimeIssue(
  sessionInput: unknown,
  routeInput: unknown,
  expectedIdentity: BlurtingSessionGenerationRouteIdentity,
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[],
): string | null {
  const bindingIssue = blurtingSessionRuntimeBindingIssue(
    sessionInput,
    routeInput,
    expectedIdentity,
    expectedTargetContracts,
  );
  if (bindingIssue) return bindingIssue;
  return blurtingSessionGenerationContract(routeInput, expectedIdentity)
    ? BLURTING_SESSION_DELIVERY_UNAVAILABLE_ISSUE
    : null;
}

function sameOrderedRuntimeBindings(
  actual: readonly BroadRecallRuntimeTargetBinding[],
  expected: readonly BlurtingSessionRuntimeTargetContract[],
) {
  return actual.length === expected.length
    && actual.every((binding, index) => (
      binding.targetId === expected[index]?.targetId
      && binding.evidenceId === expected[index]?.evidenceId
      && binding.concept === expected[index]?.concept
      && binding.comparisonCriterion === expected[index]?.comparisonCriterion
      && binding.transferSuccessCriterion === expected[index]?.transferSuccessCriterion
    ));
}

function trustedTargetContractIssue(
  expected: readonly BlurtingSessionRuntimeTargetContract[],
  routeEvidence: readonly BlurtingGenerationEvidence[],
) {
  if (
    expected.length !== routeEvidence.length
    || expected.some((binding, index) => (
      !BroadRecallRuntimeTargetBindingSchema.safeParse(binding).success
      || binding.targetId !== routeEvidence[index]?.targetId
      || binding.evidenceId !== routeEvidence[index]?.evidenceId
    ))
  ) {
    return "The trusted broad-recall target contract must bind one valid criterion set to each committed route target and evidence item in order.";
  }
  return null;
}

function hasExactNonEvidenceActivityScaffolds(session: GeneratedSessionDraft) {
  return session.activities.every((activity, index) => {
    const scaffold = BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS[index];
    return Boolean(
      scaffold
      && activity.type === "reflection"
      && activity.topicId === null
      && activity.concept === null
      && activity.choices.length === 0
      && activity.correctAnswer === null
      && activity.feedback === null
      && activity.teaching === null
      && (!("lessonBrief" in activity) || activity.lessonBrief === null)
      && (activity.practiceIntent ?? null) === null
      && (activity.misconceptionSummary ?? null) === null
      && activity.methodPhase === scaffold.methodPhase
      && activity.label === scaffold.label
      && activity.title === scaffold.title
      && activity.body === scaffold.body
    );
  });
}

function rawBroadRuntimeIndexes(sessionInput: unknown) {
  const activities = rawActivities(sessionInput);
  return activities.flatMap((activity, index) => {
    if (!activity || typeof activity !== "object" || !("methodRuntime" in activity)) return [];
    const runtime = (activity as { methodRuntime?: unknown }).methodRuntime;
    if (!runtime || typeof runtime !== "object") return [];
    return (
      (runtime as { kind?: unknown }).kind === "retrieval_round"
      && (runtime as { format?: unknown }).format === BLURTING_RUNTIME_FORMAT
    ) ? [index] : [];
  });
}

function rawActivityTopicIds(sessionInput: unknown) {
  return rawActivities(sessionInput).map((activity) => (
    activity && typeof activity === "object" && "topicId" in activity
      ? (activity as { topicId?: unknown }).topicId
      : undefined
  ));
}

function rawActivities(sessionInput: unknown): unknown[] {
  if (!sessionInput || typeof sessionInput !== "object" || !("activities" in sessionInput)) {
    return [];
  }
  const activities = (sessionInput as { activities?: unknown }).activities;
  return Array.isArray(activities) ? activities : [];
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

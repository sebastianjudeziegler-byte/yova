import type { SessionLearningMode } from "@/lib/domain";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import {
  classifyLearningTask,
  type LearningTaskClassification,
} from "@/lib/learning/method-router";
import {
  PlanKnowledgeMapSchema,
  type KnowledgeMapTopic,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import {
  canonicalizePlanAvailabilitySlots,
  enumeratePlanAvailabilitySlots,
  type PlanAvailabilitySlot,
} from "@/lib/plan-generation/availability-slots";
import {
  contentBudgetForMinutes,
  type SessionContentBudget,
} from "@/lib/plan-generation/content-budget";
import {
  resolveInitialPlanSessionModes,
  type InitialPlanModeRuleTraceEntry,
  type InitialPlanSessionModeBasis,
  type InitialPlanTargetModeDecision,
} from "@/lib/plan-generation/initial-session-mode";
import {
  MAX_GENERATED_PLAN_SESSIONS,
  PlanGenerationRequestSchema,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { studyDayWindowForInstant } from "@/lib/scheduling/study-window";
import {
  NORMAL_DURATION_RECOMMENDER_VERSION,
  type NormalDurationOutcome,
  type NormalStudyDurationRecommendationInput,
  recommendNormalStudyDuration,
} from "@/lib/study-route/duration-recommendation";
import {
  resolveNormalStudyDurationPrecedence,
  type ResolvedNormalStudyDuration,
} from "@/lib/study-route/duration-precedence";
import {
  StudyRouteRuleTraceEntrySchema,
  StudyRouteProvenanceSchema,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";

export const NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION =
  "normal_plan_envelope_composer_v1" as const;

export const NORMAL_PLAN_ENVELOPE_ERROR_CODES = [
  "invalid_request",
  "not_normal_plan",
  "missing_knowledge_map",
  "invalid_clock",
  "invalid_search_days",
  "invalid_profile_version",
  "invalid_learning_intent",
  "duplicate_topic_id",
  "duplicate_prerequisite",
  "unknown_prerequisite",
  "prerequisite_cycle",
  "empty_active_target_set",
  "no_normal_session_capacity",
  "scope_minimum_unreachable",
  "minimum_teaching_unreachable",
] as const;

export type NormalPlanEnvelopeErrorCode =
  (typeof NORMAL_PLAN_ENVELOPE_ERROR_CODES)[number];

export class NormalPlanEnvelopeComposerError extends Error {
  constructor(
    readonly code: NormalPlanEnvelopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NormalPlanEnvelopeComposerError";
  }
}

export type NormalPlanDurationContext = Readonly<{
  profileVersion: string;
  profile: NormalStudyDurationRecommendationInput["profile"];
  recentOutcomes: readonly NormalDurationOutcome[];
}>;

export type NormalPlanEnvelopeInput = Readonly<{
  /** The accepted map is required on the request so there is one map authority. */
  request: PlanGenerationRequest;
  learningIntentRecommendation: Readonly<{
    intent: "learn" | "study";
    basis: string;
  }>;
  durationContext: NormalPlanDurationContext;
  now: Date;
  searchDays?: number;
}>;

export const NORMAL_PLAN_DEFERRAL_REASON_CODES = [
  "accepted_map_deferral",
  "prerequisite_deferred",
  "session_cap",
  "deadline_capacity",
  "availability_capacity",
] as const;

export type NormalPlanDeferralReasonCode =
  (typeof NORMAL_PLAN_DEFERRAL_REASON_CODES)[number];

export type NormalPlanTargetDeferral = Readonly<{
  topicId: string;
  reasonCode: NormalPlanDeferralReasonCode;
  reason: string;
  prerequisiteTopicIds: readonly string[];
}>;

export type NormalPlanEnvelopeKind =
  | "initial_coverage"
  | "required_practice"
  | "additional_practice";

export type NormalPlanSessionEnvelope = Readonly<{
  envelopeId: string;
  sequence: number;
  kind: NormalPlanEnvelopeKind;
  topicIds: readonly string[];
  learningMode: SessionLearningMode;
  modeBasisCode: InitialPlanSessionModeBasis;
  targetModeDecisions: readonly InitialPlanTargetModeDecision[];
  taskFamily: LearningTaskType;
  taskClassification: DeepReadonly<LearningTaskClassification>;
  scheduledFor: string;
  availabilityStartsAt: string;
  availabilityDayIndex: number;
  availabilityWindowIndex: number;
  /** Exact unused capacity in this occurrence immediately before the session. */
  hardMaximumMinutes: number;
  timing: ResolvedNormalStudyDuration["timing"];
  contentBudget: Readonly<SessionContentBudget>;
  durationRouterVersion: typeof NORMAL_DURATION_RECOMMENDER_VERSION;
  durationRuleTrace: readonly DeepReadonly<StudyRouteRuleTraceEntry>[];
  prerequisiteEvidenceRefs: readonly string[];
  modeRuleTrace: readonly InitialPlanModeRuleTraceEntry[];
}>;

export type NormalPlanEnvelopeComposition = Readonly<{
  version: typeof NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION;
  status: "complete" | "partial";
  profileVersion: string;
  envelopes: readonly NormalPlanSessionEnvelope[];
  deferrals: readonly NormalPlanTargetDeferral[];
}>;

type Target = Readonly<{
  topic: DeepReadonly<KnowledgeMapTopic>;
  orderIndex: number;
  firstMode: SessionLearningMode;
  firstModeBasis: InitialPlanTargetModeDecision["basisCode"];
  taskClassification: DeepReadonly<LearningTaskClassification>;
}>;

type Cursor = Readonly<{
  slotIndex: number;
  usedMinutes: number;
}>;

type DraftEnvelope = Readonly<{
  kind: NormalPlanEnvelopeKind;
  targets: readonly Target[];
  learningMode: SessionLearningMode;
  placement: Placement;
}>;

type Placement = Readonly<{
  cursor: Cursor;
  slot: PlanAvailabilitySlot;
  scheduledFor: string;
  hardMaximumMinutes: number;
  duration: ResolvedNormalStudyDuration;
  contentBudget: SessionContentBudget;
}>;

type InitialComposition = Readonly<{
  envelopes: readonly DraftEnvelope[];
  cursor: Cursor;
}>;

/**
 * Produces the structural sidecar for an ordinary plan before any provider
 * writes learner-facing prose. The function is pure: it neither generates
 * identifiers randomly nor mutates the accepted request/map/profile.
 */
export function composeNormalPlanEnvelopes(
  input: NormalPlanEnvelopeInput,
): NormalPlanEnvelopeComposition {
  const request = parseRequest(input.request);
  if (request.intent !== "plan") {
    throw new NormalPlanEnvelopeComposerError(
      "not_normal_plan",
      "Normal-plan envelope composition cannot be used for Study Now.",
    );
  }
  if (!request.knowledgeMap) {
    throw new NormalPlanEnvelopeComposerError(
      "missing_knowledge_map",
      "Normal-plan envelope composition requires the accepted knowledge map on the request.",
    );
  }
  const now = parseClock(input.now);
  const searchDays = parseSearchDays(
    input.searchDays ?? Math.max(42, request.knowledgeMap.scopeJudgment.maximumSessions * 10),
  );
  const profileVersion = parseProfileVersion(input.durationContext.profileVersion);
  const knowledgeMap = PlanKnowledgeMapSchema.parse(request.knowledgeMap);
  if (
    input.learningIntentRecommendation.intent !== request.learningIntent
    || !input.learningIntentRecommendation.basis.trim()
  ) {
    throw new NormalPlanEnvelopeComposerError(
      "invalid_learning_intent",
      "The explicit starting recommendation must match the resolved request intent and include its basis.",
    );
  }
  const ordered = stableTopologicalOrder(knowledgeMap);
  const topicsById = new Map(ordered.map((topic) => [topic.id, topic]));
  const mapDeferrals = resolveMapDeferrals(ordered, topicsById);
  const activeTopics = ordered.filter((topic) => !mapDeferrals.has(topic.id));
  if (!activeTopics.length) {
    throw new NormalPlanEnvelopeComposerError(
      "empty_active_target_set",
      "The accepted knowledge map has no active target that can enter a runnable normal plan.",
    );
  }
  const firstModes = activeTopics.length > 0
    ? resolveInitialPlanSessionModes({
        learningIntentRecommendation: input.learningIntentRecommendation,
        knowledgeMap,
        sessions: activeTopics.map((topic) => ({
          key: `first:${topic.id}`,
          topicIds: [topic.id],
        })),
      })
    : [];
  const firstDecisionById = new Map(firstModes.map((decision) => [
    decision.targetDecisions[0]!.topicId,
    decision.targetDecisions[0]!,
  ]));
  const targets = dependencyAwareEvidenceOrder(activeTopics.map<Target>((topic, orderIndex) => ({
    topic,
    orderIndex,
    firstMode: firstDecisionById.get(topic.id)!.learningMode,
    firstModeBasis: firstDecisionById.get(topic.id)!.basisCode,
    taskClassification: classifyLearningTask(authoritativeTaskText(request, topic)),
  })));
  const learnTargetCount = targets.filter((target) => target.firstMode === "learn").length;
  // The scope judgment predates placement. Exact target decisions therefore
  // cap its teaching minimum instead of inventing teaching for demonstrated
  // or explicitly Practice-default targets.
  const minimumTeachingSessions = Math.min(
    knowledgeMap.scopeJudgment.minimumTeachingSessions,
    learnTargetCount,
  );

  const enumeratedSlots = enumeratePlanAvailabilitySlots(request, now, searchDays);
  const slots = canonicalizePlanAvailabilitySlots(
    enumeratedSlots,
    now,
  );
  const maximumSessions = Math.min(
    knowledgeMap.scopeJudgment.maximumSessions,
    MAX_GENERATED_PLAN_SESSIONS,
  );
  let selected: InitialComposition | null = null;
  let coveredTargetCount = 0;
  for (let count = targets.length; count >= 1; count -= 1) {
    const candidateTargets = targets.slice(0, count);
    if (
      candidateTargets.filter((target) => target.firstMode === "learn").length
        < minimumTeachingSessions
    ) continue;
    const candidate = composeInitialAndRequiredPractice({
      targets: candidateTargets,
      slots,
      request,
      durationContext: input.durationContext,
      maximumSessions,
      minimumTeachingSessions,
      allowUnrepeatedLearn: maximumSessions === 1,
    });
    if (!candidate) continue;
    selected = candidate;
    coveredTargetCount = count;
    break;
  }

  if (!selected) {
    if (minimumTeachingSessions > 0) {
      throw new NormalPlanEnvelopeComposerError(
        "minimum_teaching_unreachable",
        "The learner's availability and session cap cannot hold the accepted minimum teaching progression plus its required later Practice.",
      );
    }
    throw new NormalPlanEnvelopeComposerError(
      "no_normal_session_capacity",
      "The learner's availability cannot hold one coherent ten-minute normal session.",
    );
  }

  const selectedTargets = targets.slice(0, coveredTargetCount);
  const withOptionalPractice = addOptionalPractice({
    composition: selected,
    targets: selectedTargets,
    slots,
    request,
    durationContext: input.durationContext,
    maximumSessions,
    recommendedSessions: Math.min(
      knowledgeMap.scopeJudgment.recommendedSessions,
      maximumSessions,
    ),
  });
  if (withOptionalPractice.envelopes.length < knowledgeMap.scopeJudgment.minimumSessions) {
    throw new NormalPlanEnvelopeComposerError(
      "scope_minimum_unreachable",
      `The learner's availability can hold ${withOptionalPractice.envelopes.length} normal sessions, fewer than the accepted minimum of ${knowledgeMap.scopeJudgment.minimumSessions}.`,
    );
  }
  const nextUnscheduledTarget = targets[coveredTargetCount] ?? null;
  const deadlineLimitedAvailability = nextUnscheduledTarget
    ? deadlineRestrictsAvailability({
        request,
        now,
        searchDays,
        boundedSlots: slots,
        cursor: withOptionalPractice.cursor,
        durationContext: input.durationContext,
        learningMode: nextUnscheduledTarget.firstMode,
        taskFamily: nextUnscheduledTarget.taskClassification.taskType,
      })
    : false;

  const envelopes = finalizeEnvelopes({
    drafts: withOptionalPractice.envelopes,
    knowledgeMap,
    learningIntentRecommendation: input.learningIntentRecommendation,
  });
  assertCoverageInvariants({
    envelopes,
    scheduledTargets: selectedTargets,
    maximumSessions,
    minimumTeachingSessions,
    allowUnrepeatedLearn: maximumSessions === 1,
  });

  const deferrals = buildDeferrals({
    ordered,
    mapDeferrals,
    scheduledIds: new Set(selectedTargets.map((target) => target.topic.id)),
    topicsById,
    envelopeCount: envelopes.length,
    maximumSessions,
    deadlineLimitedAvailability,
  });
  return deepFreeze({
    version: NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
    status: deferrals.some((deferral) => (
      deferral.reasonCode === "session_cap"
      || deferral.reasonCode === "deadline_capacity"
      || deferral.reasonCode === "availability_capacity"
    )) ? "partial" : "complete",
    profileVersion,
    envelopes,
    deferrals,
  });
}

function composeInitialAndRequiredPractice({
  targets,
  slots,
  request,
  durationContext,
  maximumSessions,
  minimumTeachingSessions,
  allowUnrepeatedLearn,
}: {
  targets: readonly Target[];
  slots: readonly PlanAvailabilitySlot[];
  request: PlanGenerationRequest;
  durationContext: NormalPlanDurationContext;
  maximumSessions: number;
  minimumTeachingSessions: number;
  allowUnrepeatedLearn: boolean;
}): InitialComposition | null {
  const failed = new Set<string>();
  const visit = (
    targetIndex: number,
    cursor: Cursor,
    envelopes: readonly DraftEnvelope[],
    teachingCount: number,
  ): InitialComposition | null => {
    const key = `${targetIndex}:${cursor.slotIndex}:${cursor.usedMinutes}:${envelopes.length}:${teachingCount}`;
    if (failed.has(key)) return null;
    if (targetIndex >= targets.length) {
      if (teachingCount < minimumTeachingSessions) {
        failed.add(key);
        return null;
      }
      if (allowUnrepeatedLearn) return { envelopes, cursor };
      const learned = targets.filter((target) => target.firstMode === "learn");
      const practice = composeRequiredPractice({
        targets: learned,
        targetIndex: 0,
        cursor,
        envelopes,
        slots,
        request,
        durationContext,
        maximumSessions,
      });
      if (practice) return practice;
      failed.add(key);
      return null;
    }
    if (envelopes.length >= maximumSessions) {
      failed.add(key);
      return null;
    }

    const first = targets[targetIndex]!;
    const placement = placeSession({
      cursor,
      slots,
      request,
      durationContext,
      learningMode: first.firstMode,
      taskFamily: first.taskClassification.taskType,
    });
    if (!placement) {
      failed.add(key);
      return null;
    }
    const compatibleCount = adjacentCompatibleCount(targets, targetIndex, first, false);
    const budget = placement.contentBudget;
    const maximumSize = Math.min(
      compatibleCount,
      budget.maximumContentTargets,
      budget.maximumCompletionChecks,
    );
    let sizes = preferredThenLarger(
      Math.min(maximumSize, budget.preferredContentTargets),
      maximumSize,
    );
    if (first.firstMode === "learn" && teachingCount < minimumTeachingSessions) {
      const neededAfterThis = minimumTeachingSessions - teachingCount - 1;
      const remainingLearnTargets = targets.slice(targetIndex)
        .filter((target) => target.firstMode === "learn").length;
      const largestAllowed = remainingLearnTargets - neededAfterThis;
      sizes = sizes.filter((size) => size <= largestAllowed);
      const preferred = Math.min(maximumSize, budget.preferredContentTargets, largestAllowed);
      sizes = [
        preferred,
        ...Array.from({ length: Math.max(0, preferred - 1) }, (_, index) => preferred - index - 1),
        ...sizes.filter((size) => size > preferred),
      ].filter(uniqueNumber);
    }

    for (const size of sizes) {
      if (size < 1) continue;
      const group = targets.slice(targetIndex, targetIndex + size);
      const result = visit(
        targetIndex + size,
        placement.cursor,
        [...envelopes, {
          kind: "initial_coverage",
          targets: group,
          learningMode: first.firstMode,
          placement,
        }],
        teachingCount + (first.firstMode === "learn" ? 1 : 0),
      );
      if (result) return result;
    }
    failed.add(key);
    return null;
  };
  return visit(0, { slotIndex: 0, usedMinutes: 0 }, [], 0);
}

function composeRequiredPractice({
  targets,
  targetIndex,
  cursor,
  envelopes,
  slots,
  request,
  durationContext,
  maximumSessions,
}: {
  targets: readonly Target[];
  targetIndex: number;
  cursor: Cursor;
  envelopes: readonly DraftEnvelope[];
  slots: readonly PlanAvailabilitySlot[];
  request: PlanGenerationRequest;
  durationContext: NormalPlanDurationContext;
  maximumSessions: number;
}): InitialComposition | null {
  if (targetIndex >= targets.length) return { envelopes, cursor };
  if (envelopes.length >= maximumSessions) return null;
  const first = targets[targetIndex]!;
  const placement = placeSession({
    cursor,
    slots,
    request,
    durationContext,
    learningMode: "study",
    taskFamily: first.taskClassification.taskType,
  });
  if (!placement) return null;
  const compatibleCount = adjacentCompatibleCount(targets, targetIndex, first, true);
  const maximumSize = Math.min(
    compatibleCount,
    placement.contentBudget.maximumContentTargets,
    placement.contentBudget.maximumCompletionChecks,
  );
  const sizes = preferredThenLarger(
    Math.min(maximumSize, placement.contentBudget.preferredContentTargets),
    maximumSize,
  );
  for (const size of sizes) {
    const result = composeRequiredPractice({
      targets,
      targetIndex: targetIndex + size,
      cursor: placement.cursor,
      envelopes: [...envelopes, {
        kind: "required_practice",
        targets: targets.slice(targetIndex, targetIndex + size),
        learningMode: "study",
        placement,
      }],
      slots,
      request,
      durationContext,
      maximumSessions,
    });
    if (result) return result;
  }
  return null;
}

function addOptionalPractice({
  composition,
  targets,
  slots,
  request,
  durationContext,
  maximumSessions,
  recommendedSessions,
}: {
  composition: InitialComposition;
  targets: readonly Target[];
  slots: readonly PlanAvailabilitySlot[];
  request: PlanGenerationRequest;
  durationContext: NormalPlanDurationContext;
  maximumSessions: number;
  recommendedSessions: number;
}): InitialComposition {
  if (!targets.length) return composition;
  const envelopes = [...composition.envelopes];
  let cursor = composition.cursor;
  let targetIndex = 0;
  while (envelopes.length < recommendedSessions && envelopes.length < maximumSessions) {
    const first = targets[targetIndex]!;
    const placement = placeSession({
      cursor,
      slots,
      request,
      durationContext,
      learningMode: "study",
      taskFamily: first.taskClassification.taskType,
    });
    if (!placement) break;
    const compatibleCount = adjacentCompatibleCount(targets, targetIndex, first, false);
    const size = Math.max(1, Math.min(
      compatibleCount,
      placement.contentBudget.preferredContentTargets,
      placement.contentBudget.maximumCompletionChecks,
    ));
    envelopes.push({
      kind: "additional_practice",
      targets: targets.slice(targetIndex, targetIndex + size),
      learningMode: "study",
      placement,
    });
    cursor = placement.cursor;
    targetIndex = (targetIndex + size) % targets.length;
  }
  return { envelopes, cursor };
}

function placeSession({
  cursor,
  slots,
  request,
  durationContext,
  learningMode,
  taskFamily,
}: {
  cursor: Cursor;
  slots: readonly PlanAvailabilitySlot[];
  request: PlanGenerationRequest;
  durationContext: NormalPlanDurationContext;
  learningMode: SessionLearningMode;
  taskFamily: LearningTaskType;
}): Placement | null {
  let slotIndex = cursor.slotIndex;
  let usedMinutes = cursor.usedMinutes;
  while (slotIndex < slots.length) {
    const slot = slots[slotIndex]!;
    const remaining = slot.minutes - usedMinutes;
    if (remaining < 10) {
      slotIndex += 1;
      usedMinutes = 0;
      continue;
    }
    const scheduledFor = new Date(
      Date.parse(slot.startsAt) + usedMinutes * 60_000,
    ).toISOString();
    const recommendation = recommendNormalStudyDuration({
      context: {
        taskFamily,
        mode: learningMode === "learn" ? "learn" : "practice",
      },
      profile: durationContext.profile,
      schedule: {
        window: studyDayWindowForInstant(scheduledFor, request.timeZone),
      },
      recentOutcomes: durationContext.recentOutcomes,
    });
    const duration = resolveNormalStudyDurationPrecedence({
      systemRecommendation: recommendation,
      learnerOverrideMinutes: null,
      hardMaximumMinutes: remaining,
    });
    if (duration.status === "insufficient_time") {
      slotIndex += 1;
      usedMinutes = 0;
      continue;
    }
    const activeMinutes = duration.timing.activeMinutes;
    return {
      cursor: { slotIndex, usedMinutes: usedMinutes + activeMinutes },
      slot,
      scheduledFor,
      hardMaximumMinutes: remaining,
      duration,
      contentBudget: contentBudgetForMinutes(activeMinutes),
    };
  }
  return null;
}

function finalizeEnvelopes({
  drafts,
  knowledgeMap,
  learningIntentRecommendation,
}: {
  drafts: readonly DraftEnvelope[];
  knowledgeMap: PlanKnowledgeMap;
  learningIntentRecommendation: NormalPlanEnvelopeInput["learningIntentRecommendation"];
}): readonly NormalPlanSessionEnvelope[] {
  if (!drafts.length) return [];
  const envelopeIds = drafts.map((_, index) => envelopeIdFor(index));
  const topicsById = new Map(knowledgeMap.topics.map((topic) => [topic.id, topic]));
  const decisions = resolveInitialPlanSessionModes({
    learningIntentRecommendation,
    knowledgeMap,
    sessions: drafts.map((draft, index) => ({
      key: envelopeIds[index]!,
      topicIds: draft.targets.map((target) => target.topic.id),
    })),
  });
  return drafts.map((draft, index) => {
    const decision = decisions[index]!;
    if (decision.learningMode !== draft.learningMode) {
      throw new Error("The final mode decision does not match the composed envelope.");
    }
    const first = draft.targets[0]!;
    const prerequisiteEvidenceRefs = unique(draft.targets.flatMap((target) => (
      target.topic.prerequisiteTopicIds.flatMap((prerequisiteId) => (
        prerequisiteEvidenceRefsFor(topicsById.get(prerequisiteId))
      ))
    )));
    const prerequisiteTrace = prerequisiteEvidenceRefs.length > 0
      ? [StudyRouteRuleTraceEntrySchema.parse({
          ruleId: "normal_plan_prerequisite_evidence_v1",
          result: `satisfied_${prerequisiteEvidenceRefs.length}_prerequisite_evidence_refs`,
          reason: "Accepted target-specific evidence satisfies these prerequisites without requiring another prerequisite session in this plan.",
          evidenceRefs: prerequisiteEvidenceRefs,
        })]
      : [];
    return deepFreeze({
      envelopeId: envelopeIds[index]!,
      sequence: index + 1,
      kind: draft.kind,
      topicIds: draft.targets.map((target) => target.topic.id),
      learningMode: decision.learningMode,
      modeBasisCode: decision.basisCode,
      targetModeDecisions: decision.targetDecisions,
      taskFamily: first.taskClassification.taskType,
      taskClassification: first.taskClassification,
      scheduledFor: draft.placement.scheduledFor,
      availabilityStartsAt: draft.placement.slot.startsAt,
      availabilityDayIndex: draft.placement.slot.dayIndex,
      availabilityWindowIndex: draft.placement.slot.windowIndex,
      hardMaximumMinutes: draft.placement.hardMaximumMinutes,
      timing: draft.placement.duration.timing,
      contentBudget: draft.placement.contentBudget,
      durationRouterVersion: NORMAL_DURATION_RECOMMENDER_VERSION,
      durationRuleTrace: draft.placement.duration.ruleTrace,
      prerequisiteEvidenceRefs,
      modeRuleTrace: [...decision.ruleTrace, ...prerequisiteTrace],
    });
  });
}

function envelopeIdFor(index: number) {
  return `normal-plan-envelope-${String(index + 1).padStart(3, "0")}`;
}

function assertCoverageInvariants({
  envelopes,
  scheduledTargets,
  maximumSessions,
  minimumTeachingSessions,
  allowUnrepeatedLearn,
}: {
  envelopes: readonly NormalPlanSessionEnvelope[];
  scheduledTargets: readonly Target[];
  maximumSessions: number;
  minimumTeachingSessions: number;
  allowUnrepeatedLearn: boolean;
}) {
  if (envelopes.length > maximumSessions) {
    throw new Error("The composer exceeded the accepted session maximum.");
  }
  if (envelopes.some((envelope) => (
    envelope.topicIds.length > envelope.contentBudget.maximumCompletionChecks
  ))) {
    throw new Error("Every composed target must retain one code-owned completion check.");
  }
  const initialIds = envelopes
    .filter((envelope) => envelope.kind === "initial_coverage")
    .flatMap((envelope) => envelope.topicIds);
  if (
    initialIds.length !== scheduledTargets.length
    || new Set(initialIds).size !== initialIds.length
    || scheduledTargets.some((target) => !initialIds.includes(target.topic.id))
  ) {
    throw new Error("Every scheduled target must have exactly one initial-coverage envelope.");
  }
  const teachingCount = envelopes.filter((envelope) => (
    envelope.kind === "initial_coverage" && envelope.learningMode === "learn"
  )).length;
  if (teachingCount < minimumTeachingSessions && scheduledTargets.length > 0) {
    throw new Error("The composer did not honor the accepted minimum teaching-session count.");
  }
  if (!allowUnrepeatedLearn) {
    for (const envelope of envelopes.filter((item) => (
      item.kind === "initial_coverage" && item.learningMode === "learn"
    ))) {
      for (const topicId of envelope.topicIds) {
        const laterPractice = envelopes.some((candidate) => (
          candidate.sequence > envelope.sequence
          && candidate.learningMode === "study"
          && candidate.topicIds.includes(topicId)
        ));
        if (!laterPractice) {
          throw new Error(`Learn target ${topicId} has no later Practice envelope.`);
        }
      }
    }
  }
}

function stableTopologicalOrder(knowledgeMap: PlanKnowledgeMap) {
  const topicsById = new Map<string, KnowledgeMapTopic>();
  const orderById = new Map<string, number>();
  knowledgeMap.topics.forEach((topic, index) => {
    if (topicsById.has(topic.id)) {
      throw new NormalPlanEnvelopeComposerError(
        "duplicate_topic_id",
        `The accepted knowledge map repeats topic ${topic.id}.`,
      );
    }
    topicsById.set(topic.id, topic);
    orderById.set(topic.id, index);
  });
  for (const topic of knowledgeMap.topics) {
    const prerequisiteIds = new Set<string>();
    for (const prerequisiteId of topic.prerequisiteTopicIds) {
      if (prerequisiteIds.has(prerequisiteId)) {
        throw new NormalPlanEnvelopeComposerError(
          "duplicate_prerequisite",
          `Topic ${topic.id} repeats prerequisite ${prerequisiteId}.`,
        );
      }
      prerequisiteIds.add(prerequisiteId);
      if (!topicsById.has(prerequisiteId)) {
        throw new NormalPlanEnvelopeComposerError(
          "unknown_prerequisite",
          `Topic ${topic.id} references unknown prerequisite ${prerequisiteId}.`,
        );
      }
    }
  }
  const indegree = new Map(knowledgeMap.topics.map((topic) => [
    topic.id,
    topic.prerequisiteTopicIds.length,
  ]));
  const dependents = new Map<string, string[]>();
  for (const topic of knowledgeMap.topics) {
    for (const prerequisiteId of topic.prerequisiteTopicIds) {
      const values = dependents.get(prerequisiteId) ?? [];
      values.push(topic.id);
      dependents.set(prerequisiteId, values);
    }
  }
  const ready = knowledgeMap.topics
    .filter((topic) => indegree.get(topic.id) === 0)
    .map((topic) => topic.id);
  const result: KnowledgeMapTopic[] = [];
  while (ready.length) {
    ready.sort((left, right) => orderById.get(left)! - orderById.get(right)!);
    const id = ready.shift()!;
    result.push(topicsById.get(id)!);
    for (const dependentId of dependents.get(id) ?? []) {
      const next = indegree.get(dependentId)! - 1;
      indegree.set(dependentId, next);
      if (next === 0) ready.push(dependentId);
    }
  }
  if (result.length !== knowledgeMap.topics.length) {
    throw new NormalPlanEnvelopeComposerError(
      "prerequisite_cycle",
      "The accepted knowledge map contains a prerequisite cycle.",
    );
  }
  return result;
}

/**
 * Reorders only dependency-ready targets. Measured gaps win first, then
 * unobserved Learn baselines, then independent Practice. An evidenced
 * prerequisite removes its dependency edge because the accepted map already
 * proves that foundation; every other prerequisite stays ordered.
 */
function dependencyAwareEvidenceOrder(
  targets: readonly Target[],
): readonly Target[] {
  const targetById = new Map(targets.map((target) => [target.topic.id, target]));
  const indegree = new Map(targets.map((target) => [target.topic.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const target of targets) {
    for (const prerequisiteId of target.topic.prerequisiteTopicIds) {
      const prerequisite = targetById.get(prerequisiteId);
      if (!prerequisite || prerequisiteEvidenceRefsFor(prerequisite.topic).length > 0) {
        continue;
      }
      indegree.set(target.topic.id, indegree.get(target.topic.id)! + 1);
      const values = dependents.get(prerequisiteId) ?? [];
      values.push(target.topic.id);
      dependents.set(prerequisiteId, values);
    }
  }

  const ready = targets.filter((target) => indegree.get(target.topic.id) === 0);
  const result: Target[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (
      targetPriority(left) - targetPriority(right)
      || left.orderIndex - right.orderIndex
    ));
    const target = ready.shift()!;
    result.push(target);
    for (const dependentId of dependents.get(target.topic.id) ?? []) {
      const next = indegree.get(dependentId)! - 1;
      indegree.set(dependentId, next);
      if (next === 0) ready.push(targetById.get(dependentId)!);
    }
  }
  if (result.length !== targets.length) {
    throw new Error("Dependency-aware target ordering lost an accepted target.");
  }
  return result.map((target, orderIndex) => deepFreeze({
    ...target,
    orderIndex,
  }));
}

function targetPriority(target: Target) {
  if (target.firstModeBasis === "placement_gap") return 0;
  if (target.firstModeBasis === "unobserved_learn_baseline") return 1;
  return 2;
}

function resolveMapDeferrals(
  ordered: readonly KnowledgeMapTopic[],
  topicsById: ReadonlyMap<string, KnowledgeMapTopic>,
) {
  const deferrals = new Map<string, NormalPlanTargetDeferral>();
  for (const topic of ordered) {
    if (topic.deferred) {
      deferrals.set(topic.id, deepFreeze({
        topicId: topic.id,
        reasonCode: "accepted_map_deferral",
        reason: topic.deferred.reason,
        prerequisiteTopicIds: [],
      }));
      continue;
    }
    const deferredPrerequisites = topic.prerequisiteTopicIds.filter((id) => (
      deferrals.has(id)
      && prerequisiteEvidenceRefsFor(topicsById.get(id)).length === 0
    ));
    if (deferredPrerequisites.length) {
      deferrals.set(topic.id, deepFreeze({
        topicId: topic.id,
        reasonCode: "prerequisite_deferred",
        reason: "A required prerequisite is outside the accepted plan boundary, so this dependent target is deferred too.",
        prerequisiteTopicIds: deferredPrerequisites,
      }));
    }
  }
  return deferrals;
}

function buildDeferrals({
  ordered,
  mapDeferrals,
  scheduledIds,
  topicsById,
  envelopeCount,
  maximumSessions,
  deadlineLimitedAvailability,
}: {
  ordered: readonly KnowledgeMapTopic[];
  mapDeferrals: ReadonlyMap<string, NormalPlanTargetDeferral>;
  scheduledIds: ReadonlySet<string>;
  topicsById: ReadonlyMap<string, KnowledgeMapTopic>;
  envelopeCount: number;
  maximumSessions: number;
  deadlineLimitedAvailability: boolean;
}) {
  const results = new Map(mapDeferrals);
  for (const topic of ordered) {
    if (results.has(topic.id) || scheduledIds.has(topic.id)) continue;
    const deferredPrerequisites = topic.prerequisiteTopicIds.filter((id) => (
      !scheduledIds.has(id)
      && prerequisiteEvidenceRefsFor(topicsById.get(id)).length === 0
    ));
    if (deferredPrerequisites.length) {
      results.set(topic.id, deepFreeze({
        topicId: topic.id,
        reasonCode: "prerequisite_deferred",
        reason: "A prerequisite could not be scheduled in this plan, so the dependent target is deferred instead of being taught out of order.",
        prerequisiteTopicIds: deferredPrerequisites,
      }));
      continue;
    }
    const reasonCode: NormalPlanDeferralReasonCode = envelopeCount >= maximumSessions
      ? "session_cap"
      : deadlineLimitedAvailability
        ? "deadline_capacity"
        : "availability_capacity";
    results.set(topic.id, deepFreeze({
      topicId: topic.id,
      reasonCode,
      reason: reasonCode === "session_cap"
        ? "The accepted session maximum was reserved for coherent coverage and required later Practice, so this tail target is deferred."
        : reasonCode === "deadline_capacity"
          ? "The learner's remaining availability before the deadline cannot hold another coherent normal session."
          : "The searched availability horizon cannot hold another coherent normal session.",
      prerequisiteTopicIds: [],
    }));
  }
  return ordered.flatMap((topic) => {
    const deferral = results.get(topic.id);
    return deferral ? [deferral] : [];
  });
}

function adjacentCompatibleCount(
  targets: readonly Target[],
  start: number,
  first: Target,
  requireOriginalAdjacency: boolean,
) {
  let count = 0;
  let priorOrderIndex = first.orderIndex - 1;
  for (let index = start; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (
      target.taskClassification.taskType !== first.taskClassification.taskType
      || (!requireOriginalAdjacency && target.firstMode !== first.firstMode)
      || (requireOriginalAdjacency && target.orderIndex !== priorOrderIndex + 1)
    ) break;
    count += 1;
    priorOrderIndex = target.orderIndex;
  }
  return count;
}

function preferredThenLarger(preferred: number, maximum: number) {
  return Array.from(
    { length: Math.max(0, maximum - preferred + 1) },
    (_, index) => preferred + index,
  );
}

function uniqueNumber(value: number, index: number, values: number[]) {
  return values.indexOf(value) === index;
}

function prerequisiteEvidenceRefsFor(
  topic: DeepReadonly<KnowledgeMapTopic> | undefined,
) {
  if (!topic) return [];
  // A current placement gap is direct evidence that this prerequisite still
  // needs instruction. Older encounter/status fields cannot satisfy it.
  if (topic.initialEvidence?.outcome === "gap") return [];
  if (topic.initialEvidence?.outcome === "demonstrated") {
    return [`placement:${topic.id}:${topic.initialEvidence.observedAt}`];
  }
  if (topic.status === "evidenced" || topic.status === "secure") {
    return [`knowledge-map-topic:${topic.id}:status:${topic.status}`];
  }
  return [];
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

/**
 * Task routing reads only learner-authored request context and fields from the
 * accepted map. Provider-authored plan/session prose is not an input here.
 */
function authoritativeTaskText(
  request: Pick<PlanGenerationRequest, "goal" | "startingContext">,
  topic: DeepReadonly<KnowledgeMapTopic>,
) {
  return [
    request.goal,
    request.startingContext ?? "",
    topic.title,
    topic.description,
    ...topic.subtopics,
  ].join(" ");
}

/**
 * A deadline owns a capacity deferral only when removing it lets the exact
 * post-composition cursor place one additional coherent normal session inside
 * the same search horizon. Comparing raw minutes over-attributes a deadline
 * that merely lengthens an unusable sub-ten-minute tail.
 */
function deadlineRestrictsAvailability({
  request,
  now,
  searchDays,
  boundedSlots,
  cursor,
  durationContext,
  learningMode,
  taskFamily,
}: {
  request: PlanGenerationRequest;
  now: Date;
  searchDays: number;
  boundedSlots: readonly PlanAvailabilitySlot[];
  cursor: Cursor;
  durationContext: NormalPlanDurationContext;
  learningMode: SessionLearningMode;
  taskFamily: LearningTaskType;
}) {
  if (!request.deadline) return false;
  const placementInput = {
    cursor,
    request,
    durationContext,
    learningMode,
    taskFamily,
  };
  if (placeSession({ ...placementInput, slots: boundedSlots })) return false;
  const horizonSlots = canonicalizePlanAvailabilitySlots(
    enumeratePlanAvailabilitySlots({
      availability: request.availability,
      deadline: null,
      timeZone: request.timeZone,
    }, now, searchDays),
    now,
  );
  return placeSession({ ...placementInput, slots: horizonSlots }) !== null;
}

function parseRequest(value: PlanGenerationRequest) {
  const parsed = PlanGenerationRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new NormalPlanEnvelopeComposerError(
      "invalid_request",
      "Normal-plan envelope composition requires a valid plan-generation request.",
    );
  }
  return parsed.data;
}

function parseClock(value: Date) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new NormalPlanEnvelopeComposerError(
      "invalid_clock",
      "Normal-plan envelope composition requires one valid server-owned clock.",
    );
  }
  return parsed;
}

function parseSearchDays(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 366) {
    throw new NormalPlanEnvelopeComposerError(
      "invalid_search_days",
      "The normal-plan availability search must be a whole number from 1 to 366 days.",
    );
  }
  return value;
}

function parseProfileVersion(value: string) {
  const parsed = StudyRouteProvenanceSchema.shape.profileVersion.safeParse(value);
  if (!parsed.success || parsed.data === "legacy_unknown") {
    throw new NormalPlanEnvelopeComposerError(
      "invalid_profile_version",
      "Normal-plan duration routing requires an honest authorized profile version.",
    );
  }
  return parsed.data;
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

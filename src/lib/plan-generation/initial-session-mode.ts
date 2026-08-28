import type { LearningIntent, SessionLearningMode } from "@/lib/domain";
import {
  PlanKnowledgeMapSchema,
  type KnowledgeMapTopic,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import {
  StudyRouteRuleTraceEntrySchema,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";

export const INITIAL_PLAN_MODE_ROUTING_VERSION =
  "initial_plan_mode_routing_v1" as const;

export const INITIAL_PLAN_MODE_ROUTING_ERROR_CODES = [
  "invalid_knowledge_map",
  "invalid_learning_intent",
  "empty_session_set",
  "duplicate_topic_id",
  "invalid_session_key",
  "duplicate_session_key",
  "empty_session_targets",
  "duplicate_session_target",
  "unknown_session_target",
  "deferred_session_target",
  "invalid_placement_state",
  "unknown_placement_target",
  "overlapping_placement_outcome",
  "placement_evidence_mismatch",
] as const;

export type InitialPlanModeRoutingErrorCode =
  (typeof INITIAL_PLAN_MODE_ROUTING_ERROR_CODES)[number];

export class InitialPlanModeRoutingError extends Error {
  constructor(
    readonly code: InitialPlanModeRoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InitialPlanModeRoutingError";
  }
}

export type InitialPlanModeSessionInput = Readonly<{
  key: string | number;
  topicIds: readonly string[];
}>;

export type InitialPlanTargetModeBasis =
  | "placement_gap"
  | "placement_demonstrated"
  | "recorded_encounter"
  | "unobserved_learn_baseline"
  | "unobserved_practice_baseline"
  | "planned_later_attempt";

export type InitialPlanSessionModeBasis =
  | "instruction_required"
  | "instruction_with_bounded_verification"
  | "independent_attempt";

export type InitialPlanModeRuleTraceEntry = Readonly<
  Omit<StudyRouteRuleTraceEntry, "evidenceRefs"> & {
    evidenceRefs: readonly string[];
  }
>;

export type InitialPlanTargetModeDecision = Readonly<{
  topicId: string;
  learningMode: SessionLearningMode;
  basisCode: InitialPlanTargetModeBasis;
  evidenceRefs: readonly string[];
  priorSessionKey?: string | number;
}>;

export type InitialPlanSessionModeDecision = Readonly<{
  key: string | number;
  learningMode: SessionLearningMode;
  basisCode: InitialPlanSessionModeBasis;
  targetDecisions: readonly InitialPlanTargetModeDecision[];
  ruleTrace: readonly InitialPlanModeRuleTraceEntry[];
}>;

export type InitialPlanModeRoutingInput = Readonly<{
  learningIntentRecommendation: Readonly<{
    intent: LearningIntent;
    basis: string;
  }>;
  knowledgeMap: PlanKnowledgeMap;
  sessions: readonly InitialPlanModeSessionInput[];
}>;

/**
 * Decides Learn versus Practice from per-target encounter evidence and plan
 * order. Provider prose, method labels, task classification, profile traits,
 * and provider-suggested modes are deliberately absent from this boundary.
 */
export function resolveInitialPlanSessionModes(
  input: InitialPlanModeRoutingInput,
): readonly InitialPlanSessionModeDecision[] {
  const knowledgeMap = parseKnowledgeMap(input.knowledgeMap);
  const intent = input.learningIntentRecommendation?.intent;
  const intentBasis = input.learningIntentRecommendation?.basis?.trim();
  if (
    (intent !== "learn" && intent !== "study")
    || !intentBasis
    || intentBasis.length > 300
  ) {
    throw new InitialPlanModeRoutingError(
      "invalid_learning_intent",
      "Initial plan mode routing requires an explicit Learn or Practice recommendation and its basis.",
    );
  }
  if (!input.sessions.length) {
    throw new InitialPlanModeRoutingError(
      "empty_session_set",
      "Initial plan mode routing requires at least one planned session.",
    );
  }

  const topicsById = validateKnowledgeMap(knowledgeMap);
  validatePlacementState(knowledgeMap, topicsById);
  validateSessions(input.sessions, topicsById);

  const firstSessionByTopic = new Map<string, string | number>();
  const decisions = input.sessions.map((session) => {
    const targetDecisions = session.topicIds.map((topicId) => {
      const topic = topicsById.get(topicId)!;
      const priorSessionKey = firstSessionByTopic.get(topicId);
      if (priorSessionKey !== undefined) {
        return targetDecision({
          topicId,
          learningMode: "study",
          basisCode: "planned_later_attempt",
          evidenceRefs: [plannedSessionRef(priorSessionKey)],
          priorSessionKey,
        });
      }

      firstSessionByTopic.set(topicId, session.key);
      return firstTargetDecision(topic, intent);
    });
    const learningTargets = targetDecisions.filter((target) => (
      target.learningMode === "learn"
    ));
    const learningMode: SessionLearningMode = learningTargets.length > 0
      ? "learn"
      : "study";
    const basisCode: InitialPlanSessionModeBasis = learningTargets.length === 0
      ? "independent_attempt"
      : learningTargets.length === targetDecisions.length
        ? "instruction_required"
        : "instruction_with_bounded_verification";
    const evidenceRefs = unique(targetDecisions.flatMap((target) => target.evidenceRefs));
    const ruleTrace = [StudyRouteRuleTraceEntrySchema.parse({
      ruleId: INITIAL_PLAN_MODE_ROUTING_VERSION,
      result: `${learningMode}:${basisCode}`,
      reason: sessionModeReason({
        learningMode,
        basisCode,
        intent,
        intentBasis,
        targetDecisions,
      }),
      evidenceRefs,
    })];

    return deepFreeze({
      key: session.key,
      learningMode,
      basisCode,
      targetDecisions,
      ruleTrace,
    });
  });

  return deepFreeze(decisions);
}

function parseKnowledgeMap(value: PlanKnowledgeMap) {
  const parsed = PlanKnowledgeMapSchema.safeParse(value);
  if (!parsed.success) {
    throw new InitialPlanModeRoutingError(
      "invalid_knowledge_map",
      "Initial plan mode routing requires a valid knowledge map.",
    );
  }
  return parsed.data;
}

function validateKnowledgeMap(knowledgeMap: PlanKnowledgeMap) {
  const topicsById = new Map<string, KnowledgeMapTopic>();
  for (const topic of knowledgeMap.topics) {
    if (topicsById.has(topic.id)) {
      throw new InitialPlanModeRoutingError(
        "duplicate_topic_id",
        `The knowledge map repeats topic ${topic.id}.`,
      );
    }
    topicsById.set(topic.id, topic);
  }
  return topicsById;
}

function validateSessions(
  sessions: readonly InitialPlanModeSessionInput[],
  topicsById: ReadonlyMap<string, KnowledgeMapTopic>,
) {
  const sessionKeys = new Set<string>();
  for (const session of sessions) {
    validateSessionKey(session.key);
    const key = comparableKey(session.key);
    if (sessionKeys.has(key)) {
      throw new InitialPlanModeRoutingError(
        "duplicate_session_key",
        `Initial plan mode routing received duplicate session key ${String(session.key)}.`,
      );
    }
    sessionKeys.add(key);
    if (!session.topicIds.length) {
      throw new InitialPlanModeRoutingError(
        "empty_session_targets",
        `Session ${String(session.key)} has no knowledge targets.`,
      );
    }
    const targetIds = new Set<string>();
    for (const topicId of session.topicIds) {
      if (targetIds.has(topicId)) {
        throw new InitialPlanModeRoutingError(
          "duplicate_session_target",
          `Session ${String(session.key)} repeats topic ${topicId}.`,
        );
      }
      targetIds.add(topicId);
      const topic = topicsById.get(topicId);
      if (!topic) {
        throw new InitialPlanModeRoutingError(
          "unknown_session_target",
          `Session ${String(session.key)} references unknown topic ${topicId}.`,
        );
      }
      if (topic.deferred) {
        throw new InitialPlanModeRoutingError(
          "deferred_session_target",
          `Session ${String(session.key)} cannot schedule deferred topic ${topicId}.`,
        );
      }
    }
  }
}

function validatePlacementState(
  knowledgeMap: PlanKnowledgeMap,
  topicsById: ReadonlyMap<string, KnowledgeMapTopic>,
) {
  const placement = knowledgeMap.placementCheck;
  const demonstrated = uniquePlacementIds(
    placement.demonstratedTopicIds,
    "demonstrated",
  );
  const gaps = uniquePlacementIds(placement.gapTopicIds, "gap");

  for (const topicId of demonstrated) {
    if (gaps.has(topicId)) {
      throw new InitialPlanModeRoutingError(
        "overlapping_placement_outcome",
        `Placement evidence cannot mark topic ${topicId} as both demonstrated and a gap.`,
      );
    }
  }
  for (const topicId of [...demonstrated, ...gaps]) {
    if (!topicsById.has(topicId)) {
      throw new InitialPlanModeRoutingError(
        "unknown_placement_target",
        `Placement evidence references unknown topic ${topicId}.`,
      );
    }
  }

  if (placement.status !== "completed") {
    if (
      placement.completedAt !== null
      || demonstrated.size > 0
      || gaps.size > 0
      || knowledgeMap.topics.some((topic) => topic.initialEvidence !== null)
    ) {
      throw new InitialPlanModeRoutingError(
        "invalid_placement_state",
        "An available or skipped placement check cannot carry completed topic evidence.",
      );
    }
    return;
  }

  if (!placement.completedAt) {
    throw new InitialPlanModeRoutingError(
      "invalid_placement_state",
      "A completed placement check requires a completion time.",
    );
  }
  for (const topic of knowledgeMap.topics) {
    const evidence = topic.initialEvidence;
    const expectedOutcome = demonstrated.has(topic.id)
      ? "demonstrated"
      : gaps.has(topic.id)
        ? "gap"
        : null;
    if (
      (expectedOutcome === null && evidence !== null)
      || (expectedOutcome !== null && evidence?.outcome !== expectedOutcome)
      || (evidence !== null && evidence.observedAt !== placement.completedAt)
    ) {
      throw new InitialPlanModeRoutingError(
        "placement_evidence_mismatch",
        `Topic ${topic.id} does not match the completed placement-check ledger.`,
      );
    }
  }
}

function uniquePlacementIds(
  values: readonly string[],
  label: "demonstrated" | "gap",
) {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value)) {
      throw new InitialPlanModeRoutingError(
        "invalid_placement_state",
        `The placement check repeats ${label} topic ${value}.`,
      );
    }
    ids.add(value);
  }
  return ids;
}

function firstTargetDecision(
  topic: KnowledgeMapTopic,
  intent: LearningIntent,
): InitialPlanTargetModeDecision {
  const initialEvidence = topic.initialEvidence;
  if (initialEvidence?.outcome === "gap") {
    return targetDecision({
      topicId: topic.id,
      learningMode: "learn",
      basisCode: "placement_gap",
      evidenceRefs: [placementEvidenceRef(topic.id, initialEvidence.observedAt)],
    });
  }
  if (initialEvidence?.outcome === "demonstrated") {
    return targetDecision({
      topicId: topic.id,
      learningMode: "study",
      basisCode: "placement_demonstrated",
      evidenceRefs: [placementEvidenceRef(topic.id, initialEvidence.observedAt)],
    });
  }
  if (topic.status !== "not_started") {
    return targetDecision({
      topicId: topic.id,
      learningMode: "study",
      basisCode: "recorded_encounter",
      evidenceRefs: [`knowledge-map-topic:${topic.id}:status:${topic.status}`],
    });
  }
  return targetDecision({
    topicId: topic.id,
    learningMode: intent,
    basisCode: intent === "learn"
      ? "unobserved_learn_baseline"
      : "unobserved_practice_baseline",
    evidenceRefs: [],
  });
}

function targetDecision(
  value: InitialPlanTargetModeDecision,
): InitialPlanTargetModeDecision {
  return deepFreeze({
    ...value,
    evidenceRefs: unique(value.evidenceRefs),
  });
}

function sessionModeReason({
  learningMode,
  basisCode,
  intent,
  intentBasis,
  targetDecisions,
}: {
  learningMode: SessionLearningMode;
  basisCode: InitialPlanSessionModeBasis;
  intent: LearningIntent;
  intentBasis: string;
  targetDecisions: readonly InitialPlanTargetModeDecision[];
}) {
  const learnCount = targetDecisions.filter((target) => target.learningMode === "learn").length;
  const practiceCount = targetDecisions.length - learnCount;
  const learnBasis = decisionBasisSummary(targetDecisions, "learn", intent, intentBasis);
  const practiceBasis = decisionBasisSummary(targetDecisions, "study", intent, intentBasis);
  if (basisCode === "instruction_with_bounded_verification") {
    return `Learn mode governs because ${learnCount} ${pluralize(learnCount, "target requires", "targets require")} instruction (${learnBasis}); ${practiceCount} ${pluralize(practiceCount, "target receives", "targets receive")} only a bounded independent check (${practiceBasis}).`;
  }
  if (learningMode === "learn") {
    return `Every active target requires instruction because ${learnBasis}. No provider mode label entered this decision.`;
  }
  return `Every active target receives an independent attempt because ${practiceBasis}. This is a route decision, not a mastery claim.`;
}

function decisionBasisSummary(
  targetDecisions: readonly InitialPlanTargetModeDecision[],
  learningMode: SessionLearningMode,
  intent: LearningIntent,
  intentBasis: string,
) {
  const decisions = targetDecisions.filter((target) => target.learningMode === learningMode);
  const count = (basisCode: InitialPlanTargetModeBasis) => decisions.filter((target) => (
    target.basisCode === basisCode
  )).length;
  const parts: string[] = [];
  const placementGaps = count("placement_gap");
  const placementDemonstrated = count("placement_demonstrated");
  const recordedEncounters = count("recorded_encounter");
  const laterAttempts = count("planned_later_attempt");
  const unobservedLearn = count("unobserved_learn_baseline");
  const unobservedPractice = count("unobserved_practice_baseline");

  if (placementGaps) parts.push(`${placementGaps} confirmed placement ${pluralize(placementGaps, "gap", "gaps")}`);
  if (placementDemonstrated) {
    parts.push(`${placementDemonstrated} ${pluralize(placementDemonstrated, "target was", "targets were")} demonstrated in placement`);
  }
  if (recordedEncounters) {
    parts.push(`${recordedEncounters} ${pluralize(recordedEncounters, "target is", "targets are")} recorded as previously encountered`);
  }
  if (laterAttempts) {
    parts.push(`${laterAttempts} ${pluralize(laterAttempts, "target follows", "targets follow")} an earlier planned encounter`);
  }
  if (unobservedLearn || unobservedPractice) {
    const baselineCount = unobservedLearn + unobservedPractice;
    parts.push(
      `${baselineCount} unobserved ${pluralize(baselineCount, "target follows", "targets follow")} the explicit ${intent === "learn" ? "Learn" : "Practice"} starting recommendation (${intentBasis.slice(0, 160)})`,
    );
  }
  return parts.join("; ");
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function placementEvidenceRef(topicId: string, observedAt: string) {
  return `placement:${topicId}:${observedAt}`;
}

function plannedSessionRef(key: string | number) {
  return `planned-session:${typeof key}:${String(key)}`;
}

function validateSessionKey(value: string | number) {
  const valid = typeof value === "string"
    ? value.trim().length > 0 && value.length <= 120
    : Number.isSafeInteger(value);
  if (!valid) {
    throw new InitialPlanModeRoutingError(
      "invalid_session_key",
      "Initial plan mode routing requires each session key to be a bounded string or safe integer.",
    );
  }
}

function comparableKey(value: string | number) {
  return `${typeof value}:${String(value)}`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
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

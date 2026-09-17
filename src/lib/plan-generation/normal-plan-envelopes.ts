import type { SessionLearningMode } from "@/lib/domain";
import type { NormalStudyDurationMinutes } from "@/lib/study-route/duration-levels";
import type { LearningTaskType } from "@/lib/learning/method-catalog";
import type { LearningTaskClassification } from "@/lib/learning/method-router";
import type { SessionContentBudget } from "@/lib/plan-generation/content-budget";
import type { InitialPlanModeRuleTraceEntry, InitialPlanSessionModeBasis, InitialPlanTargetModeDecision } from "@/lib/plan-generation/initial-session-mode";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { NORMAL_DURATION_RECOMMENDER_VERSION, type NormalDurationOutcome, type NormalStudyDurationRecommendationInput } from "@/lib/study-route/duration-recommendation";
import type { ResolvedNormalStudyDuration } from "@/lib/study-route/duration-precedence";
import type { StudyRouteRuleTraceEntry } from "@/lib/study-route/schema";
import type { NormalPlanRevisionContext } from "@/lib/plan-generation/normal-plan-revision-context";
import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import type { TopicWorkload, TopicPlanModel } from "@/lib/plan-generation/topic-plan-contract";

export const NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION =
  "topic_plan_envelope_composer_v2" as const;
export const NORMAL_PLAN_SESSION_RESET_MINUTES = 5;

export const NORMAL_PLAN_ENVELOPE_ERROR_CODES = [
  "invalid_request",
  "not_normal_plan",
  "missing_knowledge_map",
  "invalid_clock",
  "invalid_search_days",
  "invalid_profile_version",
  "invalid_learning_intent",
  "deadline_passed",
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
  onboardingAnswers?: OnboardingAnswers;
  profile: NormalStudyDurationRecommendationInput["profile"];
  recentOutcomes: readonly NormalDurationOutcome[];
  capacityMaximumMinutes?: NormalStudyDurationMinutes;
  learnerOverrideMinutes?: NormalStudyDurationMinutes;
  /** Deterministic source-reading allowance for a reviewed attachment. */
  sourceStudyBudgetMinutes?: NormalStudyDurationMinutes;
  /** Only the closed legacy revision path preserves explicit fixed durations. */
  legacyExactDuration?: boolean;
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
  revisionContext?: NormalPlanRevisionContext;
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
  workload?: TopicWorkload;
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
  planModel?: TopicPlanModel;
  status: "complete" | "partial";
  profileVersion: string;
  envelopes: readonly NormalPlanSessionEnvelope[];
  deferrals: readonly NormalPlanTargetDeferral[];
  capacityRecovery?: Readonly<{
    stage: "shorter_sessions" | "last_teaching_practice" | "reduced_scope" | "triage";
    minimumTeachingSessions: number;
    practiceRequirement: "all" | "last_teaching" | "none";
    explanation: string;
  }>;
}>;

/** The legacy public name is retained for revisions and provider boundaries.
 * Structure is now exclusively composed by the topic model. */
export { composeTopicPlanEnvelopes as composeNormalPlanEnvelopes } from "@/lib/plan-generation/topic-plan-model";

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown) ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

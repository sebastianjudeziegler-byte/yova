export type LearningItemStatus = "active" | "paused" | "completed" | "archived";
export type PlanStatus = "draft" | "active" | "completed" | "archived";
export type SessionStatus = "ready" | "upcoming" | "complete" | "skipped";
export type SessionCompletionMode = "guided" | "unguided_practice";
export type SourceMode = "user_materials" | "yova_generated";
export type StudyMode = "inside_yova" | "outside_yova";
export type LearningIntent = "learn" | "study";
export type SessionLearningMode = "learn" | "study";
export type SessionArchitectureVersion = import("@/lib/session-generation/architecture").SessionArchitectureVersion;

export type DeadlineMilestone = {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  status: "open" | "completed";
  linkedLearningItemId: string | null;
  createdAt: string;
};
export type SessionCoverage = import("@/lib/session-generation/schema").SessionCoverage;
export type TeachingBlock = import("@/lib/session-generation/schema").TeachingBlock;

export type SessionMethodBriefing = {
  learningMode: SessionLearningMode;
  taskType: "memorization" | "conceptual_learning" | "problem_solving" | "reading_to_quiz" | "writing_argumentation" | "programming" | "mixed_assessment";
  methodId: "retrieval_practice" | "spaced_retrieval" | "self_explanation" | "worked_example_fading" | "interleaved_practice" | "read_recall_review" | "retrieval_based_outlining" | "scaffolded_coding" | "practice_test_error_repair";
  name: string;
  what: string;
  why: string;
  how: string[];
  completion: string;
  personalization: string[];
};

export type LearningMaterial = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textContent: string | null;
  processingStatus: "ready" | "staged";
  understanding?: import("@/lib/knowledge-map/schema").MaterialUnderstanding | null;
};

export type PreviewAccount = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  identityMode?: "preview" | "supabase";
  /** Auth-provider evidence for the current email; omitted by browser previews and legacy snapshots. */
  emailVerified?: boolean;
};

export type SessionResourceActivity = {
  topicId?: string | null;
  methodPhase?: import("@/lib/learning/method-fidelity").MethodPhase;
  estimatedMinutes?: number;
  requiredForCompletion?: boolean;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
  label: string;
  title: string;
  body: string;
  teaching?: import("@/lib/session-generation/schema").TeachingBlock | null;
  lessonBrief?: import("@/lib/session-generation/schema").LessonBrief | null;
  choices: string[];
  correctAnswer: string | null;
  feedback: string | null;
  practiceIntent?: import("@/lib/learning/practice-variation").PracticeIntent | null;
  /** A bounded model-derived misconception description, never the learner's answer text. */
  misconceptionSummary?: string | null;
  /** Method-specific interaction data; null keeps the generic activity rendering. */
  methodRuntime?: import("@/lib/session-generation/method-runtime").MethodRuntime | null;
};

export type SessionSourceGrounding = {
  mode: "materials_only" | "materials_plus_ai";
  summary: string;
  sourceNames: string[];
  anchors: Array<{ chunkId: string; sourceName: string; locationLabel: string; excerpt: string; usedFor: string }>;
  supplements: Array<{ topic: string; reason: string }>;
};

export type SessionResource = {
  topicIds?: string[];
  rationale: string;
  coverage?: import("@/lib/session-generation/schema").SessionCoverage;
  methodBriefing?: SessionMethodBriefing;
  routingContext?: {
    taskType: SessionMethodBriefing["taskType"];
    knowledgeStage: import("@/lib/learning/method-router").KnowledgeStage;
  };
  deliveryPolicy?: import("@/lib/personalization/session-delivery-policy").SessionDeliveryPolicy;
  deliveryInstructions?: import("@/lib/personalization/session-delivery-policy").LessonDeliveryInstructions;
  supportPlan?: import("@/lib/learning/scaffold-progression").SessionSupportPlan;
  sourceGrounding?: SessionSourceGrounding;
  activities: SessionResourceActivity[];
  generatedAt: string;
  origin: "generated" | "built_in";
};

export type SessionAdaptationNote = {
  explanation: string;
  adaptedAt: string;
};

export type LearningPlanSession = {
  id: string;
  sequence: number;
  title: string;
  objective: string;
  method: string;
  methodReason: string;
  scheduledFor: string;
  estimatedMinutes: number;
  amountLabel: string;
  learningMode: SessionLearningMode;
  topicIds?: string[];
  contentTargets?: string[];
  completionEvidence?: string[];
  /** Stable provenance for content-preserving session splits. */
  originSessionId?: string;
  /** Content minutes before per-part setup and evidence-check overhead. */
  originalContentMinutes?: number;
  segmentIndex?: number;
  segmentCount?: number;
  status: SessionStatus;
  resource?: SessionResource;
  adaptationNote?: SessionAdaptationNote;
  reviewConcept?: string;
  reviewType?: "repair_and_retrieve" | "verify" | "maintenance_transfer";
};

export type LearningPlan = {
  id: string;
  learningItemId: string;
  title: string;
  topic: string;
  kind: "test" | "topic" | "course" | "book" | "skill";
  deadline: string | null;
  status: PlanStatus;
  sourceMode: SourceMode;
  studyMode: StudyMode;
  learningIntent: LearningIntent;
  creationIntent?: "plan" | "study_now";
  /** Missing on plans created before streamed teaching and therefore treated as legacy. */
  sessionArchitectureVersion?: SessionArchitectureVersion;
  rationale: string;
  createdAt: string;
  knowledgeMap?: import("@/lib/knowledge-map/schema").PlanKnowledgeMap;
  materials?: LearningMaterial[];
  sessions: LearningPlanSession[];
};

export type ConceptEvidence = {
  topicId?: string;
  concept: string;
  outcome: "secure" | "needs_review";
  activityType: "multiple_choice" | "free_response";
  methodPhase?: import("@/lib/learning/method-fidelity").MethodPhase;
  attempt?: 1 | 2;
  /** A bounded model-derived description of a demonstrated wrong relationship, never a learner quote. */
  misconceptionSummary?: string;
};

export type ConfidenceLevel = "guessing" | "somewhat_sure" | "very_sure";

export type ConfidenceEvidence = {
  topicId?: string;
  concept: string;
  confidence: ConfidenceLevel;
  correct: boolean;
  activityType: "multiple_choice" | "free_response";
  /** A bounded model-derived description of the checked misconception, never a learner quote. */
  misconceptionSummary?: string;
};

export type SessionCompletion = {
  id: string;
  planId: string;
  planSessionId: string;
  startedAt: string;
  completedAt: string;
  plannedMinutes: number;
  actualMinutes: number;
  correctAnswers: number;
  totalAnswers: number;
  feedback: "too_easy" | "about_right" | "too_difficult";
  observedGap: string;
  /**
   * Whether this completion included YOVA-observed knowledge evidence.
   * Missing legacy values are treated as guided completions.
   */
  completionMode?: SessionCompletionMode;
  conceptEvidence: ConceptEvidence[];
  confidenceEvidence: ConfidenceEvidence[];
};

export type SessionEvidenceSnapshot = {
  correctAnswers: number;
  totalAnswers: number;
  conceptEvidence: ConceptEvidence[];
  confidenceEvidence: ConfidenceEvidence[];
  observedGap: string;
  completedImmediateRepairs: number;
};

export type SessionPendingRepair = {
  concept: string;
  title: string;
  body: string;
  correctAnswer: string;
  feedback: string | null;
  repairSupport?: import("@/lib/session-repair/schema").RuntimeRepairSupport;
};

export type SessionAdjustmentSnapshot = {
  familiarity: "as_planned" | "already_know" | "need_teaching" | "challenge_me";
  availableMinutes: number | null;
  knownTargets: string[];
  note: string;
};

export type SessionInterruption = {
  id: string;
  planId: string;
  planSessionId: string;
  startedAt: string;
  interruptedAt: string;
  plannedMinutes: number;
  actualMinutes: number;
  completedSteps: number;
  totalSteps: number;
  resumeStep?: number;
  evidence?: SessionEvidenceSnapshot;
  pendingRepair?: SessionPendingRepair;
  sessionAdjustment?: SessionAdjustmentSnapshot;
  /** Ratings-only method progress; never contains an unfinished learner answer. */
  activityProgress?: import("@/lib/learning/session-activity-progress").SessionActivityProgress;
};

export type NextSessionAdaptation = {
  planSessionId: string;
  title: string;
  objective: string;
  method: string;
  methodReason: string;
  estimatedMinutes: number;
  amountLabel: string;
  learningMode: SessionLearningMode;
  explanation: string;
};

export type YovaPreviewSnapshot = {
  version: 1;
  account: PreviewAccount | null;
  signedIn: boolean;
  onboardingAnswers: string[];
  onboardingCompleted: boolean;
  alphaEntered: boolean;
  plans: LearningPlan[];
  deadlineMilestones?: DeadlineMilestone[];
  sessionCompletions: SessionCompletion[];
  sessionInterruptions: SessionInterruption[];
  updatedAt: string;
};

export function makeId(prefix: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${randomPart}`;
}

export function makeUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (character) => {
    const value = Number(character);
    return (value ^ (Math.random() * 16 >> value / 4)).toString(16);
  });
}

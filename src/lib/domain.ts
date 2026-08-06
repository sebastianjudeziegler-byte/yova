export type LearningItemStatus = "active" | "paused" | "completed" | "archived";
export type PlanStatus = "draft" | "active" | "completed" | "archived";
export type SessionStatus = "ready" | "upcoming" | "complete" | "skipped";
export type SourceMode = "user_materials" | "yova_generated";
export type StudyMode = "inside_yova" | "outside_yova";
export type LearningIntent = "learn" | "study";
export type SessionLearningMode = "learn" | "study";

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
};

export type PreviewAccount = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  identityMode?: "preview" | "supabase";
};

export type SessionResourceActivity = {
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
  label: string;
  title: string;
  body: string;
  choices: string[];
  correctAnswer: string | null;
  feedback: string | null;
};

export type SessionSourceGrounding = {
  mode: "materials_only" | "materials_plus_ai";
  summary: string;
  sourceNames: string[];
  anchors: Array<{ sourceName: string; excerpt: string; usedFor: string }>;
  supplements: Array<{ topic: string; reason: string }>;
};

export type SessionResource = {
  rationale: string;
  methodBriefing?: SessionMethodBriefing;
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
  status: SessionStatus;
  resource?: SessionResource;
  adaptationNote?: SessionAdaptationNote;
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
  rationale: string;
  createdAt: string;
  materials?: LearningMaterial[];
  sessions: LearningPlanSession[];
};

export type ConceptEvidence = {
  concept: string;
  outcome: "secure" | "needs_review";
  activityType: "multiple_choice" | "free_response";
};

export type ConfidenceLevel = "guessing" | "somewhat_sure" | "very_sure";

export type ConfidenceEvidence = {
  concept: string;
  confidence: ConfidenceLevel;
  correct: boolean;
  activityType: "multiple_choice" | "free_response";
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
  conceptEvidence: ConceptEvidence[];
  confidenceEvidence: ConfidenceEvidence[];
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

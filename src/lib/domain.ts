export type LearningItemStatus = "active" | "paused" | "completed" | "archived";
export type PlanStatus = "draft" | "active" | "completed" | "archived";
export type SessionStatus = "ready" | "upcoming" | "complete" | "skipped";
export type SourceMode = "user_materials" | "yova_generated";
export type StudyMode = "inside_yova" | "outside_yova";

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
  status: SessionStatus;
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

export type SessionCompletion = {
  id: string;
  planId: string;
  planSessionId: string;
  completedAt: string;
  correctAnswers: number;
  totalAnswers: number;
  feedback: "too_easy" | "about_right" | "too_difficult";
  observedGap: string;
  conceptEvidence: ConceptEvidence[];
};

export type NextSessionAdaptation = {
  planSessionId: string;
  title: string;
  objective: string;
  method: string;
  methodReason: string;
  estimatedMinutes: number;
  amountLabel: string;
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

import type {
  ConfidenceEvidence,
  ConfidenceLevel,
  ConceptEvidence,
} from "@/lib/domain";

export type GuidedSessionStep = {
  methodPhase?: import("@/lib/learning/method-fidelity").MethodPhase;
  estimatedMinutes?: number;
  requiredForCompletion?: boolean;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
  label: string;
  title: string;
  body: string;
  teaching?: import("@/lib/session-generation/schema").TeachingBlock | null;
  question: string[] | null;
  correctAnswer: string | null;
  feedback: string | null;
  evidenceRole?: "assessment" | "immediate_repair";
};

export type SessionEvidenceSummary = {
  correctAnswers: number;
  totalAnswers: number;
  conceptEvidence: ConceptEvidence[];
  confidenceEvidence: ConfidenceEvidence[];
  observedGap: string;
  completedImmediateRepairs: number;
};

export type CompletionConceptSummary = {
  showingStrength: string[];
  needsAnotherCheck: string[];
};

export function summarizeCompletionConcepts(
  evidence: ConceptEvidence[],
): CompletionConceptSummary {
  const concepts = new Map<string, { label: string; needsReview: boolean }>();

  for (const item of evidence) {
    const key = item.concept.trim().toLocaleLowerCase();
    if (!key) continue;
    const current = concepts.get(key);
    concepts.set(key, {
      label: current?.label ?? item.concept.trim(),
      needsReview: current?.needsReview === true || item.outcome === "needs_review",
    });
  }

  return Array.from(concepts.values()).reduce<CompletionConceptSummary>((summary, concept) => {
    if (concept.needsReview) summary.needsAnotherCheck.push(concept.label);
    else summary.showingStrength.push(concept.label);
    return summary;
  }, { showingStrength: [], needsAnotherCheck: [] });
}

export function summarizeSessionEvidence(
  steps: GuidedSessionStep[],
  outcomes: Record<number, boolean>,
  confidence: Record<number, ConfidenceLevel>,
): SessionEvidenceSummary {
  const conceptEvidence: ConceptEvidence[] = [];
  const confidenceEvidence: ConfidenceEvidence[] = [];
  const observedGaps: string[] = [];
  let correctAnswers = 0;
  let totalAnswers = 0;
  let completedImmediateRepairs = 0;

  steps.forEach((step, index) => {
    const outcome = outcomes[index];
    if (outcome === undefined || !isKnowledgeCheck(step)) return;

    if (step.evidenceRole === "immediate_repair") {
      completedImmediateRepairs += 1;
      return;
    }

    totalAnswers += 1;
    if (outcome) correctAnswers += 1;
    else observedGaps.push(step.concept ?? step.title);

    if (!step.concept) return;
    conceptEvidence.push({
      concept: step.concept,
      outcome: outcome ? "secure" : "needs_review",
      activityType: step.type,
      methodPhase: step.methodPhase,
    });

    const confidenceLevel = confidence[index];
    if (confidenceLevel) {
      confidenceEvidence.push({
        concept: step.concept,
        confidence: confidenceLevel,
        correct: outcome,
        activityType: step.type,
      });
    }
  });

  return {
    correctAnswers,
    totalAnswers,
    conceptEvidence,
    confidenceEvidence,
    observedGap: observedGaps.join("; ") || "No major gap detected in the required check",
    completedImmediateRepairs,
  };
}

export function buildImmediateRepairSteps(
  steps: GuidedSessionStep[],
  outcomes: Record<number, boolean>,
  maximumRepairs = 2,
): GuidedSessionStep[] {
  const missedConcepts = new Set<string>();

  return steps.flatMap<GuidedSessionStep>((step, index) => {
    if (
      outcomes[index] !== false
      || !isKnowledgeCheck(step)
      || !step.concept
      || !step.correctAnswer
      || step.evidenceRole === "immediate_repair"
      || missedConcepts.has(step.concept.toLocaleLowerCase())
      || missedConcepts.size >= maximumRepairs
    ) return [];

    missedConcepts.add(step.concept.toLocaleLowerCase());
    return [{
      methodPhase: "repair",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      type: "free_response",
      concept: step.concept,
      label: "REPAIR CHECK",
      title: `Explain ${step.concept} again in your own words`,
      body: `Without looking back, state the corrected idea and why it replaces the answer you gave before. This immediate retry repairs the explanation now; YOVA will still check it again later.`,
      question: null,
      correctAnswer: step.correctAnswer,
      feedback: step.feedback
        ? `${step.feedback} Immediate success helps repair the idea, but it does not count as long-term mastery until a later retrieval check.`
        : "Compare the meaning, not the exact wording. Immediate success helps repair the idea, but YOVA will verify it again later.",
      evidenceRole: "immediate_repair",
    }];
  });
}

export function buildImmediateRepairAfterMiss(
  steps: GuidedSessionStep[],
  currentIndex: number,
  outcomes: Record<number, boolean>,
  maximumRepairs = 2,
) {
  const current = steps[currentIndex];
  if (
    !current
    || outcomes[currentIndex] !== false
    || current.evidenceRole === "immediate_repair"
    || !isKnowledgeCheck(current)
  ) return null;

  const existingRepairs = steps.filter((step) => step.evidenceRole === "immediate_repair");
  if (existingRepairs.length >= maximumRepairs) return null;
  if (existingRepairs.some((step) => step.concept?.toLocaleLowerCase() === current.concept?.toLocaleLowerCase())) {
    return null;
  }

  return buildImmediateRepairSteps([current], { 0: false }, 1)[0] ?? null;
}

function isKnowledgeCheck(step: GuidedSessionStep): step is GuidedSessionStep & {
  type: "multiple_choice" | "free_response";
} {
  return step.type === "multiple_choice" || step.type === "free_response";
}

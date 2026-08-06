import type {
  ConfidenceEvidence,
  ConfidenceLevel,
  ConceptEvidence,
} from "@/lib/domain";

export type GuidedSessionStep = {
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
  label: string;
  title: string;
  body: string;
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

function isKnowledgeCheck(step: GuidedSessionStep): step is GuidedSessionStep & {
  type: "multiple_choice" | "free_response";
} {
  return step.type === "multiple_choice" || step.type === "free_response";
}

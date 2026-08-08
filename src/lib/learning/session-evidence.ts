import type {
  ConfidenceEvidence,
  ConfidenceLevel,
  ConceptEvidence,
  SessionEvidenceSnapshot,
} from "@/lib/domain";
import type { RuntimeRepairSupport } from "@/lib/session-repair/schema";

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
  repairSupport?: RuntimeRepairSupport;
};

export type SessionEvidenceSummary = SessionEvidenceSnapshot;

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

export function mergeSessionEvidenceSummaries(
  ...summaries: Array<SessionEvidenceSummary | null | undefined>
): SessionEvidenceSummary {
  const present = summaries.filter((summary): summary is SessionEvidenceSummary => Boolean(summary));
  const conceptEvidence = present.flatMap((summary) => summary.conceptEvidence);
  const needsReview = new Map<string, string>();

  for (const item of conceptEvidence) {
    if (item.outcome !== "needs_review") continue;
    const concept = item.concept.trim();
    if (concept) needsReview.set(concept.toLocaleLowerCase(), concept);
  }

  return {
    correctAnswers: present.reduce((sum, summary) => sum + summary.correctAnswers, 0),
    totalAnswers: present.reduce((sum, summary) => sum + summary.totalAnswers, 0),
    conceptEvidence,
    confidenceEvidence: present.flatMap((summary) => summary.confidenceEvidence),
    observedGap: [...needsReview.values()].join("; ") || "No major gap detected in the required check",
    completedImmediateRepairs: present.reduce((sum, summary) => sum + summary.completedImmediateRepairs, 0),
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
      title: `Repair ${step.concept}`,
      body: "Review the correction, then explain the relationship once in your own words. YOVA will check it again later to see whether it remains available.",
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
  repairFocus: string[] = [],
  repairSupport?: RuntimeRepairSupport,
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

  const repair = buildImmediateRepairSteps([current], { 0: false }, 1)[0] ?? null;
  const focusedIdeas = repairFocus
    .map((idea) => idea.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((idea) => idea.slice(0, 80));

  if (!repair) return null;

  if (repairSupport) {
    return {
      ...repair,
      estimatedMinutes: Math.min(6, Math.max(2, repairSupport.steps.length + 2)),
      title: repairSupport.title,
      body: `${repairSupport.retryPrompt} YOVA will check it now and verify it again later.`,
      repairSupport,
    };
  }

  if (focusedIdeas.length === 0) return repair;

  return {
    ...repair,
    body: `Focus on these missing ideas: ${focusedIdeas.join("; ")}. Review the correction, then explain the relationship once in your own words. YOVA will verify it again later.`,
  };
}

function isKnowledgeCheck(step: GuidedSessionStep): step is GuidedSessionStep & {
  type: "multiple_choice" | "free_response";
} {
  return step.type === "multiple_choice" || step.type === "free_response";
}

import type {
  ConfidenceEvidence,
  ConfidenceLevel,
  ConceptEvidence,
  SessionEvidenceSnapshot,
} from "@/lib/domain";
import type { RuntimeRepairSupport } from "@/lib/session-repair/schema";
import {
  conceptEvidenceMayUpdateLearningState,
  learningStateConceptEvidence,
} from "@/lib/learning/concept-evidence";

export type GuidedSessionStep = {
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
  question: string[] | null;
  correctAnswer: string | null;
  feedback: string | null;
  evidenceRole?: "assessment" | "immediate_repair";
  repairSupport?: RuntimeRepairSupport;
  practiceIntent?: import("@/lib/learning/practice-variation").PracticeIntent | null;
  misconceptionSummary?: string;
  /** Method-specific interaction data; null keeps the generic step rendering. */
  methodRuntime?: import("@/lib/session-generation/method-runtime").MethodRuntime | null;
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
    if (!conceptEvidenceMayUpdateLearningState(item)) continue;
    const key = item.concept.trim().toLocaleLowerCase();
    if (!key) continue;
    concepts.set(key, {
      label: concepts.get(key)?.label ?? item.concept.trim(),
      needsReview: item.outcome === "needs_review",
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
  attempts: Record<number, boolean[]> = {},
): SessionEvidenceSummary {
  const conceptEvidence: ConceptEvidence[] = [];
  const confidenceEvidence: ConfidenceEvidence[] = [];
  let correctAnswers = 0;
  let totalAnswers = 0;
  let completedImmediateRepairs = 0;

  steps.forEach((step, index) => {
    const outcome = outcomes[index];
    const recordedAttempts = attempts[index]?.slice(0, 2) ?? [];
    const attemptOutcomes = recordedAttempts.length > 0
      ? recordedAttempts
      : outcome === undefined ? [] : [outcome];
    if (attemptOutcomes.length === 0 || !isKnowledgeCheck(step)) return;
    // Pretesting exposes a prediction before instruction. It is required
    // method work, but neither a correct guess nor a miss may become mastery,
    // gap, calibration, or method-outcome evidence.
    if (step.methodPhase === "pretest") return;
    const finalOutcome = attemptOutcomes.at(-1)!;

    if (step.evidenceRole === "immediate_repair") {
      completedImmediateRepairs += 1;
      if (step.concept) {
        conceptEvidence.push({
          ...(step.topicId ? { topicId: step.topicId } : {}),
          concept: step.concept,
          outcome: finalOutcome ? "secure" : "needs_review",
          activityType: step.type,
          methodPhase: step.methodPhase,
          ...(step.misconceptionSummary ? { misconceptionSummary: step.misconceptionSummary } : {}),
        });
      }
      return;
    }

    totalAnswers += 1;
    if (finalOutcome) correctAnswers += 1;
    if (!step.concept) return;
    attemptOutcomes.forEach((attemptOutcome, attemptIndex) => {
      conceptEvidence.push({
        ...(step.topicId ? { topicId: step.topicId } : {}),
        concept: step.concept!,
        outcome: attemptOutcome ? "secure" : "needs_review",
        activityType: step.type,
        methodPhase: step.methodPhase,
        ...(attemptOutcomes.length > 1 ? { attempt: (attemptIndex + 1) as 1 | 2 } : {}),
        ...(!attemptOutcome && step.misconceptionSummary
          ? { misconceptionSummary: step.misconceptionSummary }
          : {}),
      });
    });

    const confidenceLevel = confidence[index];
    if (confidenceLevel) {
      confidenceEvidence.push({
        ...(step.topicId ? { topicId: step.topicId } : {}),
        concept: step.concept,
        confidence: confidenceLevel,
        correct: attemptOutcomes[0]!,
        activityType: step.type,
        ...(!attemptOutcomes[0] && step.misconceptionSummary
          ? { misconceptionSummary: step.misconceptionSummary }
          : {}),
      });
    }
  });

  return {
    correctAnswers,
    totalAnswers,
    conceptEvidence,
    confidenceEvidence,
    observedGap: latestNeedsReviewConcepts(conceptEvidence).join("; ") || "No major gap detected in the required check",
    completedImmediateRepairs,
  };
}

export function mergeSessionEvidenceSummaries(
  ...summaries: Array<SessionEvidenceSummary | null | undefined>
): SessionEvidenceSummary {
  const present = summaries.filter((summary): summary is SessionEvidenceSummary => Boolean(summary));
  const conceptEvidence = learningStateConceptEvidence(
    present.flatMap((summary) => summary.conceptEvidence),
  );
  return {
    correctAnswers: present.reduce((sum, summary) => sum + summary.correctAnswers, 0),
    totalAnswers: present.reduce((sum, summary) => sum + summary.totalAnswers, 0),
    conceptEvidence,
    confidenceEvidence: present.flatMap((summary) => summary.confidenceEvidence),
    observedGap: latestNeedsReviewConcepts(conceptEvidence).join("; ") || "No major gap detected in the required check",
    completedImmediateRepairs: present.reduce((sum, summary) => sum + summary.completedImmediateRepairs, 0),
  };
}

function latestNeedsReviewConcepts(evidence: ConceptEvidence[]) {
  const latest = new Map<string, { label: string; needsReview: boolean }>();
  for (const item of evidence) {
    const concept = item.concept.trim();
    if (!concept) continue;
    const key = concept.toLocaleLowerCase();
    latest.set(key, {
      label: latest.get(key)?.label ?? concept,
      needsReview: item.outcome === "needs_review",
    });
  }
  return [...latest.values()].filter((item) => item.needsReview).map((item) => item.label);
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
      || step.methodPhase === "pretest"
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
      body: "The previous check exposed this exact gap. Review the bounded correction, then explain the relationship once in your own words.",
      question: null,
      correctAnswer: step.correctAnswer,
      feedback: step.feedback
        ? `${step.feedback} Compare the meaning rather than copying the wording.`
        : "Compare the meaning, not the exact wording. This required recheck records whether the repaired concept now holds.",
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
    || current.methodPhase === "pretest"
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
      body: `The previous check exposed this exact gap. ${repairSupport.retryPrompt}`,
      repairSupport,
    };
  }

  if (focusedIdeas.length === 0) return repair;

  return {
    ...repair,
    body: `The previous check exposed this exact gap. Focus on: ${focusedIdeas.join("; ")}. Review the correction, then explain the relationship once in your own words.`,
  };
}

export function hasCompletedImmediateRepair(
  conceptEvidence: ConceptEvidence[],
  concept: string,
) {
  const target = normalizeConcept(concept);
  if (!target) return false;
  return conceptEvidence.some((item) => (
    item.methodPhase === "repair"
    && item.outcome === "secure"
    && conceptsMatch(normalizeConcept(item.concept), target)
  ));
}

export function unrepairedObservedGaps(
  observedGap: string,
  conceptEvidence: ConceptEvidence[],
) {
  return observedGap
    .split(";")
    .map((gap) => gap.trim())
    .filter((gap) => gap && !/^no major gap/i.test(gap))
    .filter((gap) => !hasCompletedImmediateRepair(conceptEvidence, gap));
}

function normalizeConcept(value: string) {
  return value.trim().toLocaleLowerCase();
}

function conceptsMatch(left: string, right: string) {
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function isKnowledgeCheck(step: GuidedSessionStep): step is GuidedSessionStep & {
  type: "multiple_choice" | "free_response";
} {
  return step.type === "multiple_choice" || step.type === "free_response";
}

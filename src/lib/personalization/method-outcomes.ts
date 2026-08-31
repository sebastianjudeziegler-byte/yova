import {
  CORE_METHOD_CATALOG,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import type { KnowledgeStage } from "@/lib/learning/method-router";
import {
  METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS,
  METHOD_EVIDENCE_MINIMUM_SESSIONS,
  methodEvidenceMeetsMinimum,
} from "@/lib/study-route/method-evidence-policy";

export type MethodOutcomeStatus =
  | "early_signal"
  | "promising"
  | "mixed"
  | "needs_more_support";

export type MethodOutcomeAttempt = {
  methodId: CoreMethodId | null;
  taskType?: LearningTaskType | null;
  knowledgeStage?: KnowledgeStage | null;
  correctAnswers: number | null;
  totalAnswers: number | null;
  feedback: "too_easy" | "about_right" | "too_difficult" | null;
};

export type MethodOutcomeSignal = {
  methodId: CoreMethodId;
  methodName: string;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  comparisonLabel: string;
  sessions: number;
  checkedAnswers: number;
  accuracyPercent: number | null;
  difficultRatings: number;
  status: MethodOutcomeStatus;
  evidence: string;
  deliveryGuidance: string;
};

// Compatibility exports. The one canonical threshold now lives with the
// comparability policy used by the server-authorized evidence adapter.
export const METHOD_OUTCOME_MINIMUM_SESSIONS = METHOD_EVIDENCE_MINIMUM_SESSIONS;
export const METHOD_OUTCOME_MINIMUM_CHECKED_ANSWERS =
  METHOD_EVIDENCE_MINIMUM_CHECKED_ANSWERS;

/**
 * A positive observational signal may rank one already-eligible method only
 * after the frozen v1 evidence floor. It is still not a causal or permanent
 * "best method" claim; the canonical selector preserves that distinction in
 * its learner-facing explanation.
 */
export function methodOutcomeSupportsMethodRanking(signal: MethodOutcomeSignal) {
  return signal.status === "promising"
    && methodEvidenceMeetsMinimum({
      sessions: signal.sessions,
      checkedAnswers: signal.checkedAnswers,
    })
    && signal.accuracyPercent !== null
    && signal.accuracyPercent >= 80
    && signal.difficultRatings <= signal.sessions / 2;
}

export function buildMethodOutcomeSignals(
  attempts: MethodOutcomeAttempt[],
  comparison: {
    taskType: LearningTaskType;
    knowledgeStage: KnowledgeStage;
  },
): MethodOutcomeSignal[] {
  const grouped = new Map<CoreMethodId, {
    sessions: number;
    correctAnswers: number;
    checkedAnswers: number;
    difficultRatings: number;
  }>();

  for (const attempt of attempts) {
    if (
      !attempt.methodId
      || attempt.taskType !== comparison.taskType
      || attempt.knowledgeStage !== comparison.knowledgeStage
    ) continue;
    const current = grouped.get(attempt.methodId) ?? {
      sessions: 0,
      correctAnswers: 0,
      checkedAnswers: 0,
      difficultRatings: 0,
    };
    current.sessions += 1;
    if (
      attempt.correctAnswers !== null
      && attempt.totalAnswers !== null
      && attempt.totalAnswers > 0
    ) {
      current.checkedAnswers += attempt.totalAnswers;
      current.correctAnswers += Math.max(
        0,
        Math.min(attempt.correctAnswers, attempt.totalAnswers),
      );
    }
    if (attempt.feedback === "too_difficult") current.difficultRatings += 1;
    grouped.set(attempt.methodId, current);
  }

  return [...grouped.entries()]
    .map(([methodId, result]): MethodOutcomeSignal => {
      const accuracyPercent = result.checkedAnswers > 0
        ? Math.round((result.correctAnswers / result.checkedAnswers) * 100)
        : null;
      const enoughEvidence = methodEvidenceMeetsMinimum({
        sessions: result.sessions,
        checkedAnswers: result.checkedAnswers,
      })
        && accuracyPercent !== null;
      const status: MethodOutcomeStatus = !enoughEvidence
        ? "early_signal"
        : accuracyPercent < 55 || result.difficultRatings > result.sessions / 2
          ? "needs_more_support"
          : accuracyPercent >= 80 && result.difficultRatings <= result.sessions / 2
            ? "promising"
            : "mixed";
      const methodName = CORE_METHOD_CATALOG[methodId].name;
      const comparisonLabel = `${taskLabel(comparison.taskType)} at the ${stageLabel(comparison.knowledgeStage)} stage`;

      return {
        methodId,
        methodName,
        taskType: comparison.taskType,
        knowledgeStage: comparison.knowledgeStage,
        comparisonLabel,
        sessions: result.sessions,
        checkedAnswers: result.checkedAnswers,
        accuracyPercent,
        difficultRatings: result.difficultRatings,
        status,
        evidence: evidenceStatement({
          methodName,
          comparisonLabel,
          sessions: result.sessions,
          checkedAnswers: result.checkedAnswers,
          accuracyPercent,
          difficultRatings: result.difficultRatings,
          status,
        }),
        deliveryGuidance: deliveryGuidance(status),
      };
    })
    .sort((left, right) => right.sessions - left.sessions || left.methodName.localeCompare(right.methodName));
}

export function validateMethodOutcomeAdaptation({
  methodId,
  personalization,
  signals,
}: {
  methodId: CoreMethodId;
  personalization: string[];
  signals: MethodOutcomeSignal[];
}) {
  const explanation = personalization.join(" ").toLowerCase();
  if (/learns? best|best method|learning style|proves? (?:that )?(?:this|the) method|brain type/.test(explanation)) {
    return "Method personalization overclaimed what observational session evidence can prove.";
  }

  const signal = signals.find((candidate) => candidate.methodId === methodId);
  if (!signal || signal.status === "early_signal" || signal.status === "mixed") return null;

  if (
    signal.status === "needs_more_support"
    && !/support|guid|model|example|smaller|scaffold|step/.test(explanation)
  ) {
    return `The selected ${signal.methodName} outcome needs a concrete support adjustment in methodBriefing.personalization.`;
  }
  if (
    signal.status === "promising"
    && !/independent|fade|challenge|transfer|less support|reduc(?:e|ing) support/.test(explanation)
  ) {
    return `The selected ${signal.methodName} outcome needs a cautious independence or transfer adjustment in methodBriefing.personalization.`;
  }

  return null;
}

function evidenceStatement({
  methodName,
  comparisonLabel,
  sessions,
  checkedAnswers,
  accuracyPercent,
  difficultRatings,
  status,
}: {
  methodName: string;
  comparisonLabel: string;
  sessions: number;
  checkedAnswers: number;
  accuracyPercent: number | null;
  difficultRatings: number;
  status: MethodOutcomeStatus;
}) {
  if (status === "early_signal") {
    return `${methodName} has only ${sessions} comparable ${sessions === 1 ? "session" : "sessions"} and ${checkedAnswers} checked answers for ${comparisonLabel}. That is not enough evidence to change the learning method confidently.`;
  }
  if (status === "needs_more_support") {
    return `${methodName} currently has ${accuracyPercent}% check accuracy across ${sessions} comparable sessions for ${comparisonLabel}${difficultRatings ? ` and ${difficultRatings} difficult ${difficultRatings === 1 ? "rating" : "ratings"}` : ""}. This suggests the execution needs more support, not that the evidence-backed method is inherently wrong for the learner.`;
  }
  if (status === "promising") {
    return `${methodName} currently has ${accuracyPercent}% check accuracy across ${sessions} comparable sessions for ${comparisonLabel}. This is a promising plan-specific observation, not proof that the learner has a fixed best method.`;
  }
  return `${methodName} currently has ${accuracyPercent}% check accuracy across ${sessions} comparable sessions for ${comparisonLabel}. The evidence is mixed, so preserve task fit and make only cautious delivery changes.`;
}

function taskLabel(taskType: LearningTaskType) {
  const labels: Record<LearningTaskType, string> = {
    memorization: "memorization",
    conceptual_learning: "concept learning",
    problem_solving: "problem solving",
    reading_to_quiz: "reading and recall",
    writing_argumentation: "writing and argumentation",
    programming: "programming",
    mixed_assessment: "mixed assessment",
  };
  return labels[taskType];
}

function stageLabel(knowledgeStage: KnowledgeStage) {
  if (knowledgeStage === "novice") return "initial-learning";
  if (knowledgeStage === "retrieval_ready") return "independent-retrieval";
  return "developing-knowledge";
}

function deliveryGuidance(status: MethodOutcomeStatus) {
  if (status === "needs_more_support") {
    return "Keep the method when it still fits the task, but add a clearer model, smaller first step, or more guided practice before independent performance.";
  }
  if (status === "promising") {
    return "Keep the task-appropriate method and cautiously fade support or increase transfer difficulty; do not call it the learner's best method.";
  }
  if (status === "mixed") {
    return "Keep the task-appropriate method and change at most one delivery variable so the next result remains interpretable.";
  }
  return "Do not adapt the method from this signal yet; use the normal task-first learning-science route and collect another comparable result.";
}

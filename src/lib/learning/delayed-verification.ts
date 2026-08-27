import {
  makeUuid,
  type LearningPlanSession,
  type SessionCompletion,
} from "@/lib/domain";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { unrepairedObservedGaps } from "@/lib/learning/session-evidence";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";
import { canonicalStudyRouteSessionScalars } from "@/lib/study-route/scalar-contract";

export function buildDelayedVerificationSession(
  completedSession: LearningPlanSession,
  completion: SessionCompletion,
): LearningPlanSession | null {
  if (completion.totalAnswers === 0 || completion.correctAnswers >= completion.totalAnswers) return null;

  const unrepairedGaps = unrepairedObservedGaps(completion.observedGap, completion.conceptEvidence);
  if (unrepairedGaps.length === 0) return null;
  const gap = conciseGap(unrepairedGaps[0]!);
  const calibration = summarizeConfidenceCalibration(completion.confidenceEvidence);
  const needsMisconceptionRepair = calibration.pattern === "possible_misconception" || calibration.pattern === "mixed";
  const scheduledFor = new Date(completion.completedAt);
  scheduledFor.setDate(scheduledFor.getDate() + 1);
  const explanation = needsMisconceptionRepair
    ? `YOVA scheduled a delayed check because ${gap} included a high-confidence miss. The next attempt will rebuild the idea briefly, then use a different application.`
    : `YOVA scheduled a delayed retrieval check for ${gap}. The original miss remains review evidence until it holds up after time has passed.`;
  const sourceContext = reviewSourceContext(completedSession, gap);
  const contextDirection = sourceContext
    ? ` New self-contained question context: ${sourceContext}`
    : " Every new question must restate all facts, values, or definitions the learner needs.";
  const topicIds = delayedReviewTopicIds(completedSession, completion, gap);

  return canonicalStudyRouteSessionScalars<LearningPlanSession>({
    id: makeUuid(),
    sequence: completedSession.sequence + 1,
    title: needsMisconceptionRepair
      ? `Repair and verify ${gap}`
      : `Verify ${gap} after a delay`,
    objective: needsMisconceptionRepair
      ? `Rebuild the idea behind ${gap}, distinguish it from the tempting wrong model, and verify it with a different application.`
      : `Answer three self-contained questions about ${gap} after time has passed, then repair any part that no longer holds.`,
    method: needsMisconceptionRepair
      ? "Misconception repair and delayed transfer"
      : "Spaced retrieval and error repair",
    methodReason: `${explanation}${contextDirection}`,
    scheduledFor: scheduledFor.toISOString(),
    estimatedMinutes: 10,
    amountLabel: "Delayed verification · about 10 min",
    learningMode: "study",
    topicIds,
    contentTargets: [gap],
    completionEvidence: [
      `Answer three self-contained questions about ${gap} without using the prior answers.`,
    ],
    adaptationNote: createSessionAdaptationNote(explanation, completion.completedAt),
    reviewConcept: gap,
    reviewType: needsMisconceptionRepair ? "repair_and_retrieve" : "verify",
    status: "ready",
  });
}

function delayedReviewTopicIds(
  completedSession: LearningPlanSession,
  completion: SessionCompletion,
  gap: string,
) {
  const normalizedGap = normalizeConcept(gap);
  const evidenceIds = completion.conceptEvidence.flatMap((evidence) => (
    evidence.outcome === "needs_review"
    && normalizeConcept(evidence.concept) === normalizedGap
    && evidence.topicId
    && UUID_PATTERN.test(evidence.topicId)
      ? [evidence.topicId]
      : []
  ));
  if (evidenceIds.length > 0) return [...new Set(evidenceIds)].slice(0, 6);

  // A routed session's target IDs are the authoritative fallback. Preserve
  // the bounded target superset instead of guessing a semantic index.
  const routeTargetIds = completedSession.studyRoute?.target.targetStates
    .map((target) => target.targetId)
    .filter((targetId) => UUID_PATTERN.test(targetId)) ?? [];
  if (routeTargetIds.length > 0) return [...new Set(routeTargetIds)].slice(0, 6);

  return [...new Set((completedSession.topicIds ?? []).filter((topicId) => (
    UUID_PATTERN.test(topicId)
  )))].slice(0, 6);
}

function normalizeConcept(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function reviewSourceContext(session: LearningPlanSession, gap: string) {
  const questions = session.resource?.activities.filter((activity) => (
    activity.type === "multiple_choice" || activity.type === "free_response"
  )) ?? [];
  const normalizedGap = gap.toLocaleLowerCase();
  const matchingQuestion = questions.find((activity) => {
    const concept = activity.concept?.trim().toLocaleLowerCase();
    return concept && (
      concept === normalizedGap
      || concept.includes(normalizedGap)
      || normalizedGap.includes(concept)
    );
  }) ?? questions[0];
  if (!matchingQuestion) return null;

  return `${matchingQuestion.title}. ${matchingQuestion.body}`.replace(/\s+/g, " ").trim().slice(0, 420);
}

function conciseGap(value: string) {
  const firstGap = value.split(";")[0]?.trim();
  if (!firstGap || /^no major gap/i.test(firstGap)) return "the missed concept";
  return firstGap.slice(0, 100);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

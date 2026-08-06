import {
  makeUuid,
  type LearningPlanSession,
  type SessionCompletion,
} from "@/lib/domain";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";

export function buildDelayedVerificationSession(
  completedSession: LearningPlanSession,
  completion: SessionCompletion,
): LearningPlanSession | null {
  if (completion.totalAnswers === 0 || completion.correctAnswers >= completion.totalAnswers) return null;

  const gap = conciseGap(completion.observedGap);
  const calibration = summarizeConfidenceCalibration(completion.confidenceEvidence);
  const needsMisconceptionRepair = calibration.pattern === "possible_misconception" || calibration.pattern === "mixed";
  const scheduledFor = new Date(completion.completedAt);
  scheduledFor.setDate(scheduledFor.getDate() + 1);
  const explanation = needsMisconceptionRepair
    ? `YOVA scheduled a delayed check because ${gap} included a high-confidence miss. The next attempt will rebuild the idea briefly, then use a different application.`
    : `YOVA scheduled a delayed retrieval check for ${gap}. The original miss remains review evidence until it holds up after time has passed.`;

  return {
    id: makeUuid(),
    sequence: completedSession.sequence + 1,
    title: needsMisconceptionRepair
      ? `Repair and verify ${gap}`
      : `Verify ${gap} after a delay`,
    objective: needsMisconceptionRepair
      ? `Rebuild the idea behind ${gap}, distinguish it from the tempting wrong model, and verify it with a different application.`
      : `Retrieve ${gap} without reopening the prior answer, then apply it once in a new context.`,
    method: needsMisconceptionRepair
      ? "Misconception repair and delayed transfer"
      : "Spaced retrieval and error repair",
    methodReason: explanation,
    scheduledFor: scheduledFor.toISOString(),
    estimatedMinutes: 10,
    amountLabel: "Delayed verification · about 10 min",
    learningMode: needsMisconceptionRepair ? "learn" : "study",
    adaptationNote: createSessionAdaptationNote(explanation, completion.completedAt),
    status: "ready",
  };
}

function conciseGap(value: string) {
  const firstGap = value.split(";")[0]?.trim();
  if (!firstGap || /^no major gap/i.test(firstGap)) return "the missed concept";
  return firstGap.slice(0, 100);
}

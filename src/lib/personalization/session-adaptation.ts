import type {
  LearningPlanSession,
  NextSessionAdaptation,
  SessionCompletion,
} from "@/lib/domain";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";

export function buildNextSessionAdaptation(
  nextSession: LearningPlanSession | null,
  completion: SessionCompletion,
): NextSessionAdaptation | null {
  if (!nextSession) return null;

  const hasKnowledgeCheck = completion.totalAnswers > 0;
  const accuracy = hasKnowledgeCheck
    ? completion.correctAnswers / completion.totalAnswers
    : null;
  const gap = conciseGap(completion.observedGap);
  const needsRepair = accuracy !== null && accuracy < 0.8;
  const calibration = summarizeConfidenceCalibration(completion.confidenceEvidence);

  if (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed") {
    const explanation = `YOVA found a high-confidence miss involving ${gap}. The next session will challenge the idea with a concise explanation and a different application so a possible misconception is repaired, not merely repeated.`;
    return {
      planSessionId: nextSession.id,
      title: `Rebuild ${gap}, then ${lowercaseFirst(nextSession.title)}`,
      objective: `Repair the possible misconception about ${gap} with a concise explanation and a different application, then continue into: ${nextSession.objective}`,
      method: "Misconception repair and transfer practice",
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Concept repair + transfer check · about ${nextSession.estimatedMinutes} min`,
      learningMode: "learn",
      explanation,
    };
  }

  if (calibration.pattern === "underestimated_knowledge" && accuracy !== null && accuracy >= 0.8) {
    const explanation = "You answered correctly while feeling unsure. YOVA will use another independent application to build evidence-based confidence without reteaching material you already demonstrated.";
    return {
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: `Confirm the demonstrated knowledge with a new independent application, then continue into: ${nextSession.objective}`,
      method: "Independent confirmation, then planned practice",
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Confidence check + planned work · about ${nextSession.estimatedMinutes} min`,
      learningMode: "study",
      explanation,
    };
  }

  if (needsRepair) {
    const needsMoreSupport = accuracy < 0.5 || completion.feedback === "too_difficult";
    const method = needsMoreSupport
      ? "Guided repair, then retrieval"
      : "Targeted retrieval and error review";
    const explanation = needsMoreSupport
      ? `YOVA added a guided repair step for ${gap} because the last check showed a meaningful gap${completion.feedback === "too_difficult" ? " and the session felt too difficult" : ""}.`
      : `YOVA will bring back ${gap} before new material because it was missed in the last knowledge check.`;

    return {
      planSessionId: nextSession.id,
      title: `Repair gaps, then ${lowercaseFirst(nextSession.title)}`,
      objective: `Repair ${gap} with ${needsMoreSupport ? "a concise example and " : ""}closed-note retrieval, then continue into the planned objective: ${nextSession.objective}`,
      method,
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Targeted repair + planned work · about ${nextSession.estimatedMinutes} min`,
      learningMode: needsMoreSupport ? "learn" : "study",
      explanation,
    };
  }

  if (completion.feedback === "too_difficult") {
    const explanation = "You completed the check, but the session felt too difficult. YOVA will begin the next session with one guided example before independent work.";
    return {
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: `Begin with one guided example, then continue into the planned objective: ${nextSession.objective}`,
      method: `Guided example, then ${lowercaseFirst(nextSession.method)}`,
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `One guided example + planned work · about ${nextSession.estimatedMinutes} min`,
      learningMode: "learn",
      explanation,
    };
  }

  if (completion.feedback === "too_easy" && accuracy !== null && accuracy >= 0.8) {
    const explanation = `You answered ${completion.correctAnswers} of ${completion.totalAnswers} checks correctly and marked the session too easy. YOVA will use more independent application next.`;
    return {
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: `Move quickly through recall, then apply the ideas independently: ${nextSession.objective}`,
      method: "Independent application and mixed practice",
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Higher-challenge practice · about ${nextSession.estimatedMinutes} min`,
      learningMode: "study",
      explanation,
    };
  }

  return null;
}

function conciseGap(value: string) {
  const firstGap = value.split(";")[0]?.trim();
  if (!firstGap || /^no major gap/i.test(firstGap)) return "the missed details";
  return firstGap.slice(0, 100);
}

function lowercaseFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

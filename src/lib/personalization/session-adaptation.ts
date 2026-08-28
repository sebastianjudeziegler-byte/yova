import type {
  LearningPlanSession,
  NextSessionAdaptation,
  SessionCompletion,
} from "@/lib/domain";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { unrepairedObservedGaps } from "@/lib/learning/session-evidence";
import { canonicalStudyRouteSessionScalars } from "@/lib/study-route/scalar-contract";

export function buildNextSessionAdaptation(
  nextSession: LearningPlanSession | null,
  completion: SessionCompletion,
): NextSessionAdaptation | null {
  if (!nextSession) return null;

  const hasKnowledgeCheck = completion.totalAnswers > 0;
  const accuracy = hasKnowledgeCheck
    ? completion.correctAnswers / completion.totalAnswers
    : null;
  const unrepairedGaps = unrepairedObservedGaps(completion.observedGap, completion.conceptEvidence);
  const gap = conciseGap(unrepairedGaps[0] ?? completion.observedGap);
  const needsRepair = accuracy !== null && accuracy < 0.8;
  const allObservedGapsRepaired = completion.observedGap.split(";").some((item) => !/^\s*no major gap/i.test(item) && item.trim())
    && unrepairedGaps.length === 0;
  const calibration = summarizeConfidenceCalibration(completion.confidenceEvidence);
  const adjustedMinutes = nextSession.estimatedMinutes;
  const difficultyAdjustment = completion.feedback === "too_difficult"
    ? " The planned target and time stay intact, but YOVA will make the first step smaller and restore support before asking for independent work."
    : "";

  if (!allObservedGapsRepaired && (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed")) {
    const explanation = `YOVA found a high-confidence miss involving ${gap}. The next session will begin with a bounded misconception repair before continuing its original target. The later targets stay in place.${difficultyAdjustment}`;
    return canonicalStudyRouteSessionScalars<NextSessionAdaptation>({
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: `Misconception repair, then ${lowercaseFirst(nextSession.method)}`,
      methodReason: explanation,
      estimatedMinutes: adjustedMinutes,
      amountLabel: `Bounded repair + planned target · about ${adjustedMinutes} min`,
      learningMode: "learn",
      explanation,
    });
  }

  if (calibration.pattern === "underestimated_knowledge" && accuracy !== null && accuracy >= 0.8) {
    const explanation = `You answered correctly while feeling unsure. YOVA will begin the next target with one independent confirmation, then continue without reteaching what you already demonstrated.${difficultyAdjustment}`;
    return canonicalStudyRouteSessionScalars<NextSessionAdaptation>({
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: "Independent confirmation, then planned practice",
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Confidence check + planned work · about ${nextSession.estimatedMinutes} min`,
      learningMode: "study",
      explanation,
    });
  }

  if (needsRepair && !allObservedGapsRepaired) {
    const needsMoreSupport = accuracy < 0.5 || completion.feedback === "too_difficult";
    const method = needsMoreSupport
      ? "Guided repair, then retrieval"
      : "Targeted retrieval and error review";
    const explanation = needsMoreSupport
      ? `YOVA will begin the next session with a short guided repair for ${gap} because the last check showed a meaningful gap. The original next target stays intact.${difficultyAdjustment}`
      : `YOVA will begin with a short retrieval repair for ${gap}, then continue the original next target. The later plan stays intact.`;

    return canonicalStudyRouteSessionScalars<NextSessionAdaptation>({
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: `${method}, then ${lowercaseFirst(nextSession.method)}`,
      methodReason: explanation,
      estimatedMinutes: adjustedMinutes,
      amountLabel: `Short repair + planned target · about ${adjustedMinutes} min`,
      learningMode: needsMoreSupport ? "learn" : "study",
      explanation,
    });
  }

  if (completion.feedback === "too_difficult") {
    const explanation = `You completed the check, but the session felt too difficult.${difficultyAdjustment}`;
    return canonicalStudyRouteSessionScalars<NextSessionAdaptation>({
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: `Guided example, then ${lowercaseFirst(nextSession.method)}`,
      methodReason: explanation,
      estimatedMinutes: adjustedMinutes,
      amountLabel: `One guided example + planned work · about ${adjustedMinutes} min`,
      learningMode: "learn",
      explanation,
    });
  }

  if (completion.feedback === "too_easy" && accuracy !== null && accuracy >= 0.8) {
    const explanation = `You answered ${completion.correctAnswers} of ${completion.totalAnswers} checks correctly and marked the session too easy. YOVA will use more independent application next.`;
    return canonicalStudyRouteSessionScalars<NextSessionAdaptation>({
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: "Independent application and mixed practice",
      methodReason: explanation,
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: `Higher-challenge practice · about ${nextSession.estimatedMinutes} min`,
      learningMode: "study",
      explanation,
    });
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

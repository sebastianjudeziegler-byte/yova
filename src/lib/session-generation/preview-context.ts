import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import { summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { methodIdFromText } from "@/lib/learning/method-router";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import type { PreviewSessionGenerationContext } from "@/lib/session-generation/schema";

export function buildPreviewSessionContext({
  plan,
  session,
  onboardingAnswers,
  completions,
  interruptions,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  onboardingAnswers: string[];
  completions: SessionCompletion[];
  interruptions: SessionInterruption[];
}): PreviewSessionGenerationContext {
  const recentCompletions = completions
    .filter((completion) => completion.planId === plan.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  const recentInterruptions = interruptions
    .filter((interruption) => interruption.planId === plan.id)
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt));

  return {
    learningGoal: {
      title: plan.title,
      topic: plan.topic,
      kind: plan.kind,
      deadline: plan.deadline,
      sourceMode: plan.sourceMode,
      studyMode: plan.studyMode,
      learningIntent: plan.learningIntent,
    },
    planRationale: plan.rationale,
    session: {
      title: session.title,
      objective: session.objective,
      method: session.method,
      methodReason: session.methodReason,
      estimatedMinutes: session.estimatedMinutes,
      learningMode: session.learningMode,
    },
    learnerProfile: {
      commonBlocker: onboardingAnswers[0] || null,
      guidancePreference: onboardingAnswers[1] || null,
      explanationPreference: onboardingAnswers[3] || null,
      focusFrequency: onboardingAnswers[4] || null,
      startingPattern: onboardingAnswers[5] || null,
      primaryImprovementGoal: onboardingAnswers[7] || null,
    },
    recentResults: recentCompletions.slice(0, 8).map((completion) => {
      const completedSession = plan.sessions.find((candidate) => candidate.id === completion.planSessionId);
      return {
        methodId: completedSession?.resource?.methodBriefing?.methodId
          ?? (completedSession ? methodIdFromText(completedSession.method) : null),
        correctAnswers: completion.correctAnswers,
        totalAnswers: completion.totalAnswers,
        feedback: completion.feedback,
        observedGap: completion.observedGap || null,
        plannedMinutes: completion.plannedMinutes,
        actualMinutes: completion.actualMinutes,
        calibrationPattern: summarizeConfidenceCalibration(completion.confidenceEvidence).pattern,
      };
    }),
    recentInterruptions: recentInterruptions.slice(0, 4).map((interruption) => ({
      occurredAt: interruption.interruptedAt,
      plannedMinutes: interruption.plannedMinutes,
      actualMinutes: interruption.actualMinutes,
      completedSteps: interruption.completedSteps,
      totalSteps: interruption.totalSteps,
    })),
    conceptSignals: summarizeConceptEvidence(recentCompletions).slice(0, 20),
    scaffoldSignals: buildScaffoldProgressionSignals(recentCompletions).slice(0, 20),
  };
}

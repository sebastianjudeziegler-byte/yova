import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import { summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import {
  buildTopicCalibrationSignals,
  summarizeConfidenceCalibration,
} from "@/lib/learning/confidence-calibration";
import {
  inferKnowledgeStage,
  inferLearningTaskType,
  methodIdFromText,
  type KnowledgeStage,
} from "@/lib/learning/method-router";
import {
  resolveEffectiveSessionLearningMode,
  teachingFirstSessionCopy,
} from "@/lib/learning/learning-intent";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import {
  expandedLearnerContextFromAnswers,
  personalizationSignalAllowsRuntimeInference,
  statedOnboardingAnswerForRuntime,
} from "@/lib/personalization/learner-profile";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";
import type { PreviewSessionGenerationContext } from "@/lib/session-generation/schema";
import type { SessionAdjustment } from "@/lib/session-generation/schema";
import {
  resolveSessionArchitectureVersion,
  sessionArchitectureForGeneration,
} from "@/lib/session-generation/architecture";

export function buildPreviewSessionContext({
  plan,
  session,
  onboardingAnswers,
  completions,
  interruptions,
  sessionAdjustment = null,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  onboardingAnswers: string[];
  completions: SessionCompletion[];
  interruptions: SessionInterruption[];
  sessionAdjustment?: SessionAdjustment | null;
}): PreviewSessionGenerationContext {
  const recentCompletions = completions
    .filter((completion) => completion.planId === plan.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  const recentInterruptions = interruptions
    .filter((interruption) => interruption.planId === plan.id)
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt));
  const expandedProfile = expandedLearnerContextFromAnswers(onboardingAnswers);
  const personalizationState = readPersonalizationStateFromAnswers(onboardingAnswers);
  const statedAnswer = (index: number) => (
    statedOnboardingAnswerForRuntime(onboardingAnswers, index, personalizationState)
  );
  const useObservedPacing = personalizationState.controls.behavior
    && personalizationSignalAllowsRuntimeInference(personalizationState, "starting_friction")
    && personalizationSignalAllowsRuntimeInference(personalizationState, "cognitive_stamina");
  const useObservedCalibration = personalizationState.controls.behavior
    && personalizationSignalAllowsRuntimeInference(personalizationState, "calibration_risk");
  const personalizationInterruptions = recentInterruptions.filter((interruption) => (
    !personalizationState.excludedEvidenceRefs.includes(interruption.id)
  ));
  const effectiveLearningMode = resolveEffectiveSessionLearningMode({
    planLearningIntent: plan.learningIntent,
    plannedMode: session.learningMode,
    completedSessionCount: recentCompletions.length,
    familiarity: sessionAdjustment?.familiarity ?? null,
  });
  const repairedTeachingStart = effectiveLearningMode === "learn" && session.learningMode !== "learn"
    ? teachingFirstSessionCopy(plan.topic)
    : null;
  const mappedTopics = plan.knowledgeMap?.topics.filter((topic) => session.topicIds?.includes(topic.id)) ?? [];
  const sessionTopics = mappedTopics.length > 0
    ? mappedTopics
    : [{
      id: session.id,
      title: session.title,
      description: session.objective,
      subtopics: session.contentTargets ?? [],
      prerequisiteTopicIds: [],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
      curriculumReference: null,
    }];

  return {
    sessionArchitectureVersion: sessionArchitectureForGeneration({
      storedVersion: resolveSessionArchitectureVersion(plan, plan.knowledgeMap),
      learningMode: effectiveLearningMode,
      studyMode: plan.studyMode,
      reviewType: session.reviewType ?? null,
    }),
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
    knowledgeTopics: sessionTopics,
    journey: {
      currentSequence: session.sequence,
      totalSessions: plan.sessions.length,
      previousSessions: plan.sessions
        .filter((candidate) => candidate.sequence < session.sequence)
        .map((candidate) => ({
          sequence: candidate.sequence,
          title: candidate.title,
          objective: candidate.objective,
          status: candidate.status,
          contentTargets: candidate.contentTargets ?? [],
        })),
      nextSessions: plan.sessions
        .filter((candidate) => candidate.sequence > session.sequence)
        .map((candidate) => ({
          sequence: candidate.sequence,
          title: candidate.title,
          objective: candidate.objective,
          contentTargets: candidate.contentTargets ?? [],
        })),
    },
    session: {
      title: session.title,
      objective: repairedTeachingStart?.objective ?? session.objective,
      method: repairedTeachingStart?.method ?? session.method,
      methodReason: repairedTeachingStart?.methodReason ?? session.methodReason,
      estimatedMinutes: session.estimatedMinutes,
      learningMode: effectiveLearningMode,
      topicIds: sessionTopics.map((topic) => topic.id),
      contentTargets: session.contentTargets ?? [],
      completionEvidence: session.completionEvidence ?? [],
      reviewConcept: session.reviewConcept?.trim() || null,
      reviewType: session.reviewType ?? null,
    },
    learnerProfile: {
      commonBlocker: statedAnswer(0),
      guidancePreference: statedAnswer(1),
      explanationPreference: statedAnswer(3),
      focusFrequency: statedAnswer(4),
      startingPattern: statedAnswer(5),
      primaryImprovementGoal: statedAnswer(7),
      ...expandedProfile,
    },
    recentResults: recentCompletions.slice(0, 8).map((completion) => {
      const completedSession = plan.sessions.find((candidate) => candidate.id === completion.planSessionId);
      const comparisonContext = completedSession
        ? completedSessionComparisonContext(plan, completedSession)
        : null;
      return {
        methodId: completedSession?.resource?.methodBriefing?.methodId
          ?? (completedSession ? methodIdFromText(completedSession.method) : null),
        taskType: comparisonContext?.taskType ?? null,
        knowledgeStage: comparisonContext?.knowledgeStage ?? null,
        correctAnswers: completion.correctAnswers,
        totalAnswers: completion.totalAnswers,
        feedback: completion.feedback,
        observedGap: completion.observedGap || null,
        plannedMinutes: useObservedPacing ? completion.plannedMinutes : null,
        actualMinutes: useObservedPacing ? completion.actualMinutes : null,
        calibrationPattern: useObservedCalibration
          ? summarizeConfidenceCalibration(completion.confidenceEvidence).pattern
          : "insufficient",
      };
    }),
    recentInterruptions: (useObservedPacing ? personalizationInterruptions : []).slice(0, 4).map((interruption) => ({
      occurredAt: interruption.interruptedAt,
      plannedMinutes: interruption.plannedMinutes,
      actualMinutes: interruption.actualMinutes,
      completedSteps: interruption.completedSteps,
      totalSteps: interruption.totalSteps,
    })),
    conceptSignals: summarizeConceptEvidence(recentCompletions).slice(0, 20),
    scaffoldSignals: buildScaffoldProgressionSignals(recentCompletions).slice(0, 20),
    topicCalibrationSignals: buildTopicCalibrationSignals(
      recentCompletions.flatMap((completion) => completion.confidenceEvidence),
    ).slice(0, 20),
  };
}

function completedSessionComparisonContext(
  plan: LearningPlan,
  session: LearningPlanSession,
): {
  taskType: NonNullable<PreviewSessionGenerationContext["recentResults"][number]["taskType"]>;
  knowledgeStage: KnowledgeStage;
} {
  const comparisonText = [
    plan.title,
    plan.topic,
    session.title,
    session.objective,
    session.method,
  ].join(" ");
  return {
    taskType: session.resource?.routingContext?.taskType
      ?? session.resource?.methodBriefing?.taskType
      ?? inferLearningTaskType(comparisonText),
    knowledgeStage: session.resource?.routingContext?.knowledgeStage
      ?? (session.learningMode === "learn"
        ? "novice"
        : inferKnowledgeStage([], comparisonText)),
  };
}

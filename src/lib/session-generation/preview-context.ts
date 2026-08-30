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
import {
  learningModeForScheduledRetrieval,
} from "@/lib/learning/scheduled-retrieval";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import {
  expandedLearnerContextFromAnswers,
  personalizationSignalAllowsRuntimeInference,
  statedOnboardingAnswerForRuntime,
} from "@/lib/personalization/learner-profile";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";
import { resolvePersonalizationForGeneration } from "@/lib/personalization/personalization-generation";
import type { PreviewSessionGenerationContext } from "@/lib/session-generation/schema";
import type { SessionAdjustment } from "@/lib/session-generation/schema";
import {
  resolveSessionArchitectureVersion,
  sessionArchitectureForGeneration,
} from "@/lib/session-generation/architecture";
import { resolvePlannedStudyRoute } from "@/lib/study-route/selectors";
import {
  buildNormalPlanJourneyGenerationCopy,
  isNormalPlanEnvelopeGenerationRoute,
  resolveNormalPlanGenerationCopy,
} from "@/lib/study-route/normal-plan-generation-copy";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

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
  const routeResolution = resolvePlannedStudyRoute(plan, session);
  const plannedStudyRoute = routeResolution.source === "stored"
    ? routeResolution.route
    : null;
  const studyRoute = plannedStudyRoute?.identity.lifecycleStatus === "committed"
    ? plannedStudyRoute
    : null;
  const normalPlanEnvelopeRoute = isNormalPlanEnvelopeGenerationRoute(plannedStudyRoute);
  const recentCompletions = completions
    .filter((completion) => completion.planId === plan.id)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  const recentInterruptions = interruptions
    .filter((interruption) => interruption.planId === plan.id)
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt));
  const expandedProfile = expandedLearnerContextFromAnswers(onboardingAnswers);
  const personalizationState = readPersonalizationStateFromAnswers(onboardingAnswers);
  const personalization = resolvePersonalizationForGeneration({
    answers: onboardingAnswers,
    completions,
    interruptions,
    plans: [],
  });
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
  const requestedLearningMode = studyRoute
    ? studyRoute.approach.mode === "learn" ? "learn" : "study"
    : resolveEffectiveSessionLearningMode({
      planLearningIntent: plan.learningIntent,
      plannedMode: session.learningMode,
      completedSessionCount: recentCompletions.length,
      familiarity: sessionAdjustment?.familiarity ?? null,
    });
  const effectiveLearningMode = learningModeForScheduledRetrieval(session, requestedLearningMode);
  const repairedTeachingStart = !studyRoute
    && effectiveLearningMode === "learn" && session.learningMode !== "learn"
    ? teachingFirstSessionCopy(plan.topic)
    : null;
  const routeTopicIds = studyRoute ? activeStudyRouteTargetIds(studyRoute) : undefined;
  const plannedRouteTopicIds = plannedStudyRoute
    ? activeStudyRouteTargetIds(plannedStudyRoute)
    : undefined;
  const mappedTopics = plan.knowledgeMap?.topics.filter((topic) => (
    (normalPlanEnvelopeRoute ? plannedRouteTopicIds : routeTopicIds ?? session.topicIds)?.includes(topic.id)
  )) ?? [];
  const normalPlanTopics = normalPlanEnvelopeRoute
    ? (plannedRouteTopicIds?.length ? plannedRouteTopicIds : [session.id]).map((topicId, index) => (
        mappedTopics.find((topic) => topic.id === topicId) ?? {
          id: topicId,
          title: (session.contentTargets?.[index] ?? "Assigned learning target").slice(0, 140),
          description: "The accepted learning target assigned to this guided session.",
          subtopics: [],
          prerequisiteTopicIds: [],
          status: "not_started" as const,
          initialEvidence: null,
          sourceReferences: [],
          origin: "ai_generated" as const,
          deferred: null,
          curriculumReference: null,
        }
      ))
    : null;
  const sessionTopics = normalPlanTopics ?? (mappedTopics.length > 0
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
    }]);
  const normalPlanGenerationCopy = resolveNormalPlanGenerationCopy({
    route: plannedStudyRoute,
    selectedTopics: sessionTopics,
    contentTargets: session.contentTargets ?? [],
  });

  return {
    ...(studyRoute ? { studyRoute } : {}),
    sessionArchitectureVersion: sessionArchitectureForGeneration({
      storedVersion: resolveSessionArchitectureVersion(plan, plan.knowledgeMap),
      learningMode: effectiveLearningMode,
      studyMode: studyRoute?.approach.executionEnvironment ?? plan.studyMode,
      reviewType: session.reviewType ?? null,
      selectedMethodId: studyRoute?.approach.primaryMethodId,
    }),
    learningGoal: {
      title: normalPlanGenerationCopy?.learningGoalTitle ?? plan.title,
      topic: normalPlanGenerationCopy?.learningGoalTopic ?? plan.topic,
      kind: plan.kind,
      deadline: plan.deadline,
      sourceMode: plan.sourceMode,
      studyMode: studyRoute?.approach.executionEnvironment ?? plan.studyMode,
      learningIntent: plan.learningIntent,
    },
    planRationale: normalPlanGenerationCopy?.planRationale ?? plan.rationale,
    knowledgeTopics: sessionTopics,
    journey: {
      currentSequence: session.sequence,
      totalSessions: plan.sessions.length,
      previousSessions: plan.sessions
        .filter((candidate) => candidate.sequence < session.sequence)
        .map((candidate) => {
          const generationCopy = normalPlanGenerationCopy
            ? buildNormalPlanJourneyGenerationCopy({
                sequence: candidate.sequence,
                contentTargets: candidate.contentTargets ?? [],
              })
            : null;
          return {
            sequence: candidate.sequence,
            title: generationCopy?.title ?? candidate.title,
            objective: generationCopy?.objective ?? candidate.objective,
            status: candidate.status,
            contentTargets: candidate.contentTargets ?? [],
          };
        }),
      nextSessions: plan.sessions
        .filter((candidate) => candidate.sequence > session.sequence)
        .map((candidate) => {
          const generationCopy = normalPlanGenerationCopy
            ? buildNormalPlanJourneyGenerationCopy({
                sequence: candidate.sequence,
                contentTargets: candidate.contentTargets ?? [],
              })
            : null;
          return {
            sequence: candidate.sequence,
            title: generationCopy?.title ?? candidate.title,
            objective: generationCopy?.objective ?? candidate.objective,
            contentTargets: candidate.contentTargets ?? [],
          };
        }),
    },
    session: {
      title: normalPlanGenerationCopy?.sessionTitle ?? session.title,
      objective: normalPlanGenerationCopy
        ? plannedStudyRoute?.target.desiredOutcome ?? "Complete the assigned learning targets."
        : studyRoute?.target.desiredOutcome ?? repairedTeachingStart?.objective ?? session.objective,
      method: studyRoute?.approach.visibleMethodName ?? repairedTeachingStart?.method ?? session.method,
      methodReason: studyRoute?.explanation.shortReason ?? repairedTeachingStart?.methodReason ?? session.methodReason,
      estimatedMinutes: studyRoute?.timing.activeMinutes ?? session.estimatedMinutes,
      learningMode: effectiveLearningMode,
      topicIds: normalPlanGenerationCopy
        ? plannedRouteTopicIds ?? sessionTopics.map((topic) => topic.id)
        : routeTopicIds ?? sessionTopics.map((topic) => topic.id),
      contentTargets: session.contentTargets ?? [],
      completionEvidence: normalPlanGenerationCopy
        ? plannedStudyRoute?.execution.completionEvidence.map((evidence) => evidence.description) ?? []
        : studyRoute
          ? studyRoute.execution.completionEvidence.map((evidence) => evidence.description)
          : session.completionEvidence ?? [],
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
    personalization,
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

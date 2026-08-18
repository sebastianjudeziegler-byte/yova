import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion, SessionInterruption } from "@/lib/domain";
import {
  defaultPersonalizationState,
  setPersonalizationEvidenceRefExcluded,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";

const plan: LearningPlan = {
  id: "00000000-0000-4000-8000-000000000001",
  learningItemId: "00000000-0000-4000-8000-000000000002",
  title: "Photosynthesis foundations",
  topic: "Photosynthesis",
  kind: "topic",
  deadline: null,
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "inside_yova",
  learningIntent: "learn",
  rationale: "Begin with an example, then use retrieval and practice to expose gaps.",
  createdAt: "2026-08-05T16:00:00.000Z",
  sessions: [{
    id: "00000000-0000-4000-8000-000000000003",
    sequence: 1,
    title: "Follow carbon through photosynthesis",
    objective: "Explain where carbon enters and leaves the process.",
    method: "Example, retrieval, then application",
    methodReason: "The learner prefers an example before independent work.",
    scheduledFor: "2026-08-05T16:00:00.000Z",
    estimatedMinutes: 25,
    amountLabel: "Focused session · about 25 min",
    learningMode: "learn",
    status: "ready",
  }],
};

const completion: SessionCompletion = {
  id: "00000000-0000-4000-8000-000000000004",
  planId: plan.id,
  planSessionId: plan.sessions[0].id,
  startedAt: "2026-08-04T16:00:00.000Z",
  completedAt: "2026-08-04T16:25:00.000Z",
  plannedMinutes: 25,
  actualMinutes: 22,
  correctAnswers: 1,
  totalAnswers: 2,
  feedback: "about_right",
  observedGap: "Calvin cycle",
  conceptEvidence: [{
    concept: "Calvin cycle",
    outcome: "needs_review",
    activityType: "free_response",
    methodPhase: "independent_practice",
  }],
  confidenceEvidence: [{
    concept: "Calvin cycle",
    confidence: "very_sure",
    correct: false,
    activityType: "free_response",
  }],
};

const interruption: SessionInterruption = {
  id: "00000000-0000-4000-8000-000000000005",
  planId: plan.id,
  planSessionId: plan.sessions[0].id,
  startedAt: "2026-08-03T16:00:00.000Z",
  interruptedAt: "2026-08-03T16:08:00.000Z",
  plannedMinutes: 25,
  actualMinutes: 8,
  completedSteps: 1,
  totalSteps: 5,
};

const mappedTopicId = "00000000-0000-4000-8000-000000000021";
const knowledgeMap: NonNullable<LearningPlan["knowledgeMap"]> = {
  version: 1,
  scopeJudgment: {
    band: "focused_skill",
    label: "Focused skill",
    minimumSessions: 1,
    recommendedSessions: 2,
    maximumSessions: 3,
    minimumTeachingSessions: 1,
    explanation: "A focused prerequisite sequence that can be taught and checked in a few sessions.",
  },
  topics: [{
    id: mappedTopicId,
    title: "Carbon movement",
    description: "Trace how carbon enters and moves through the photosynthesis process.",
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    curriculumReference: null,
  }],
  placementCheck: {
    status: "available",
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
  curriculum: null,
};

describe("buildPreviewSessionContext", () => {
  it("honors a current request to teach a planned study session first", () => {
    const studySession = {
      ...plan.sessions[0],
      learningMode: "study" as const,
      method: "Closed-note retrieval",
    };
    const result = buildPreviewSessionContext({
      plan: { ...plan, learningIntent: "study", sessions: [studySession] },
      session: studySession,
      onboardingAnswers: [],
      completions: [],
      interruptions: [],
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: null,
        knownTargets: [],
        note: "Teach this first.",
      },
    });

    expect(result.session.learningMode).toBe("learn");
    expect(result.session.method).toBe("Guided explanation and self-explanation");
  });

  it("uses streamed teaching for an older mapped preview plan without a saved architecture stamp", () => {
    const mappedSession = { ...plan.sessions[0], topicIds: [mappedTopicId] };
    const result = buildPreviewSessionContext({
      plan: {
        ...plan,
        sessionArchitectureVersion: undefined,
        knowledgeMap,
        sessions: [mappedSession],
      },
      session: mappedSession,
      onboardingAnswers: [],
      completions: [],
      interruptions: [],
    });

    expect(result.sessionArchitectureVersion).toBe("streamed_teaching_v1");
    expect(result.knowledgeTopics).toHaveLength(1);
    expect(result.knowledgeTopics[0].id).toBe(mappedTopicId);
  });

  it("tells the generator exactly where the session sits in the learning journey", () => {
    const secondSession = {
      ...plan.sessions[0],
      id: "00000000-0000-4000-8000-000000000013",
      sequence: 2,
      title: "Connect light reactions to the Calvin cycle",
      objective: "Explain how the products of the light reactions support carbon fixation.",
      contentTargets: ["The relationship between ATP, NADPH, and carbon fixation"],
      status: "upcoming" as const,
    };
    const thirdSession = {
      ...plan.sessions[0],
      id: "00000000-0000-4000-8000-000000000014",
      sequence: 3,
      title: "Apply the complete photosynthesis model",
      objective: "Predict how changing light or carbon dioxide affects the process.",
      contentTargets: ["Transfer the complete model to a new condition"],
      status: "upcoming" as const,
    };
    const result = buildPreviewSessionContext({
      plan: { ...plan, sessions: [{ ...plan.sessions[0], contentTargets: ["Carbon movement through photosynthesis"], status: "complete" }, secondSession, thirdSession] },
      session: secondSession,
      onboardingAnswers: [],
      completions: [],
      interruptions: [],
    });

    expect(result.journey).toMatchObject({ currentSequence: 2, totalSessions: 3 });
    expect(result.journey.previousSessions[0]).toMatchObject({ sequence: 1, status: "complete" });
    expect(result.journey.nextSessions[0]).toMatchObject({
      sequence: 3,
      contentTargets: ["Transfer the complete model to a new condition"],
    });
  });

  it("passes only useful personalization and learning evidence to the server", () => {
    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: [
        "I struggle to start",
        "Give me clear structure with flexibility",
        "20 to 30 minutes",
        "A concrete example first",
        "Sometimes",
        "I intend to begin but often delay",
        "Afternoon",
        "A combination",
        "ADHD",
        "I need examples before I feel ready",
      ],
      completions: [completion],
      interruptions: [interruption],
    });

    expect(result.learnerProfile).toMatchObject({
      commonBlocker: "I struggle to start",
      explanationPreference: "A concrete example first",
    });
    expect(JSON.stringify(result)).not.toContain("ADHD");
    expect(result.recentResults[0]).toMatchObject({
      methodId: "retrieval_practice",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      feedback: "about_right",
      observedGap: "Calvin cycle",
      calibrationPattern: "possible_misconception",
    });
    expect(result.recentInterruptions[0]).toMatchObject({ completedSteps: 1, totalSteps: 5 });
    expect(result.conceptSignals[0]).toMatchObject({
      concept: "Calvin cycle",
      status: "needs_review",
    });
    expect(result.scaffoldSignals[0]).toMatchObject({
      concept: "Calvin cycle",
      status: "restore_support",
    });
  });

  it("does not send stated onboarding preferences when self-report personalization is off", () => {
    const answers = writePersonalizationStateToAnswers([
      "I struggle to start",
      "Tell me exactly what to do",
      "20 to 30 minutes",
      "A concrete example first",
      "Often",
      "I intend to begin but often delay",
      "Afternoon",
      "Help me begin",
      "Less text and more visual structure",
      "I need examples before I feel ready",
      "A concrete example before the rule",
    ], {
      ...defaultPersonalizationState(),
      controls: {
        ...defaultPersonalizationState().controls,
        selfReport: false,
      },
    });
    answers[15] = "The interruption happened because class ended.";

    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: answers,
      completions: [],
      interruptions: [],
    });

    expect(result.learnerProfile).toMatchObject({
      commonBlocker: null,
      guidancePreference: null,
      explanationPreference: null,
      focusFrequency: null,
      startingPattern: null,
      primaryImprovementGoal: null,
      functionalSupportNeed: null,
      processingPreference: null,
      freeformContext: null,
      observationCorrection: "The interruption happened because class ended.",
    });
  });

  it("keeps correctness evidence but removes behavior-based pacing when that control is off", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...defaults,
      controls: { ...defaults.controls, behavior: false },
    });

    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: answers,
      completions: [completion, { ...completion, id: "00000000-0000-4000-8000-000000000014" }],
      interruptions: [interruption, { ...interruption, id: "00000000-0000-4000-8000-000000000015" }],
    });

    expect(result.recentResults[0]).toMatchObject({
      correctAnswers: completion.correctAnswers,
      totalAnswers: completion.totalAnswers,
      plannedMinutes: null,
      actualMinutes: null,
      calibrationPattern: "insufficient",
    });
    expect(result.recentInterruptions).toEqual([]);
    expect(result.conceptSignals[0]).toMatchObject({ concept: "Calvin cycle" });
    expect(result.personalization?.decisions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ setting: "knowledge_check" }),
      expect.objectContaining({ setting: "first_action" }),
    ]));
    expect(result.personalization?.methodTie.signals).toEqual([]);
  });

  it("projects allowed repeated behavior into generation decisions", () => {
    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: writePersonalizationStateToAnswers([], defaultPersonalizationState()),
      completions: [
        completion,
        { ...completion, id: "00000000-0000-4000-8000-000000000024" },
      ],
      interruptions: [
        interruption,
        { ...interruption, id: "00000000-0000-4000-8000-000000000025" },
      ],
    });

    expect(result.personalization?.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ setting: "knowledge_check", value: "closed_note_first" }),
      expect.objectContaining({ setting: "first_action", value: "small_active_start" }),
    ]));
  });

  it("does not send an app-problem interruption as pacing evidence", () => {
    const state = setPersonalizationEvidenceRefExcluded(
      defaultPersonalizationState(),
      interruption.id,
      true,
    );
    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: writePersonalizationStateToAnswers([], state),
      completions: [],
      interruptions: [interruption],
    });

    expect(result.recentInterruptions).toEqual([]);
  });

  it("removes calibration delivery signals when that inference is paused or stopped", () => {
    const defaults = defaultPersonalizationState();
    const pausedAnswers = writePersonalizationStateToAnswers([], {
      ...defaults,
      pausedSignalIds: ["signal:calibration_risk"],
    });
    const stoppedAnswers = writePersonalizationStateToAnswers([], {
      ...defaults,
      corrections: [{
        signalId: "signal:calibration_risk",
        correctedValue: null,
        note: "Do not use confidence as a personalization signal.",
        doNotInfer: true,
        updatedAt: "2026-08-14T19:00:00.000Z",
      }],
    });

    for (const onboardingAnswers of [pausedAnswers, stoppedAnswers]) {
      const result = buildPreviewSessionContext({
        plan,
        session: plan.sessions[0],
        onboardingAnswers,
        completions: [completion],
        interruptions: [],
      });
      expect(result.recentResults[0]?.calibrationPattern).toBe("insufficient");
    }
  });

  it("keeps calibration evidence active when a correction is context-only", () => {
    const defaults = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...defaults,
      corrections: [{
        signalId: "signal:calibration_risk",
        correctedValue: null,
        note: "That check happened at the end of a long class.",
        doNotInfer: false,
        updatedAt: "2026-08-14T19:00:00.000Z",
      }],
    });
    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: answers,
      completions: [completion],
      interruptions: [],
    });

    expect(result.recentResults[0]?.calibrationPattern).toBe("possible_misconception");
  });

  it("carries a completed gap into later session generation without losing future targets", () => {
    const completedSession = {
      ...plan.sessions[0],
      status: "complete" as const,
      contentTargets: ["Carbon movement through photosynthesis"],
    };
    const nextSession = {
      ...plan.sessions[0],
      id: "00000000-0000-4000-8000-000000000015",
      sequence: 2,
      title: "Connect light reactions to carbon fixation",
      objective: "Explain how ATP and NADPH support carbon fixation.",
      contentTargets: ["ATP and NADPH support carbon fixation"],
      completionEvidence: ["Explain the relationship in a new example"],
      status: "ready" as const,
    };
    const laterSession = {
      ...plan.sessions[0],
      id: "00000000-0000-4000-8000-000000000016",
      sequence: 3,
      title: "Transfer the full photosynthesis model",
      objective: "Predict how changing light affects the full process.",
      contentTargets: ["Transfer the full model to a new condition"],
      status: "upcoming" as const,
    };
    const result = buildPreviewSessionContext({
      plan: { ...plan, sessions: [completedSession, nextSession, laterSession] },
      session: nextSession,
      onboardingAnswers: [],
      completions: [completion],
      interruptions: [],
    });

    expect(result.session).toMatchObject({
      title: nextSession.title,
      objective: nextSession.objective,
      contentTargets: nextSession.contentTargets,
      completionEvidence: nextSession.completionEvidence,
    });
    expect(result.recentResults[0].observedGap).toBe("Calvin cycle");
    expect(result.conceptSignals[0]).toMatchObject({ concept: "Calvin cycle", status: "needs_review" });
    expect(result.scaffoldSignals[0]).toMatchObject({ concept: "Calvin cycle", status: "restore_support" });
    expect(result.journey.nextSessions[0]).toMatchObject({
      title: laterSession.title,
      contentTargets: laterSession.contentTargets,
    });
  });

  it("does not leak evidence from a different learning plan", () => {
    const result = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0],
      onboardingAnswers: [],
      completions: [{ ...completion, planId: "00000000-0000-4000-8000-000000000099" }],
      interruptions: [{ ...interruption, planId: "00000000-0000-4000-8000-000000000099" }],
    });

    expect(result.recentResults).toEqual([]);
    expect(result.recentInterruptions).toEqual([]);
    expect(result.conceptSignals).toEqual([]);
    expect(result.scaffoldSignals).toEqual([]);
  });

  it("preserves the scheduled-review contract when building generation context", () => {
    const reviewSession = {
      ...plan.sessions[0],
      learningMode: "study" as const,
      reviewConcept: "Calvin cycle",
      reviewType: "verify" as const,
    };
    const result = buildPreviewSessionContext({
      plan: { ...plan, sessions: [reviewSession] },
      session: reviewSession,
      onboardingAnswers: [],
      completions: [completion],
      interruptions: [],
    });

    expect(result.session).toMatchObject({
      learningMode: "study",
      reviewConcept: "Calvin cycle",
      reviewType: "verify",
    });
  });

  it("repairs an old practice-first first session when the plan says the learner needs teaching", () => {
    const staleSession = {
      ...plan.sessions[0],
      learningMode: "study" as const,
      method: "Retrieval practice",
      objective: "Recall the causes of World War I without notes.",
    };
    const result = buildPreviewSessionContext({
      plan: { ...plan, topic: "World War I", sessions: [staleSession] },
      session: staleSession,
      onboardingAnswers: [],
      completions: [],
      interruptions: [],
    });

    expect(result.session.learningMode).toBe("learn");
    expect(result.session.method).toMatch(/explanation/i);
    expect(result.session.objective).toMatch(/first mental model/i);
  });
});

import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion, SessionInterruption } from "@/lib/domain";
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

describe("buildPreviewSessionContext", () => {
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

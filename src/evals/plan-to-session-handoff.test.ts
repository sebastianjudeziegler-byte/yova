import { describe, expect, it } from "vitest";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";

const request: PlanGenerationRequest = {
  intent: "plan",
  learningIntent: "learn",
  goal: "I have a World War I test in two weeks and I am starting from zero.",
  startingContext: "I know almost nothing yet. Start with the story and big picture.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: "2026-08-22T23:00:00.000Z",
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [{
    question: "Where are you starting?",
    answer: "Completely new",
    evaluation: "self_report",
  }],
  availability: [{ day: "Monday", window: "Evening", minutes: 15 }],
  profileSummary: "The learner wants the big picture first, one visible step at a time, and a small hint before the answer.",
  knowledgeMap: {
    version: 1,
    scopeJudgment: { band: "unit_or_exam", label: "Test unit", minimumSessions: 2, recommendedSessions: 2, maximumSessions: 4, minimumTeachingSessions: 1, explanation: "This test requires a connected causal foundation and a delayed evidence check." },
    topics: [{ id: "11111111-1111-4111-8111-111111111111", title: "Outbreak of World War I", description: "How the assassination, alliances, mobilization, and declarations widened the conflict.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null }],
    placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  },
};

const draft: GeneratedPlanDraft = {
  title: "World War I Test Preparation",
  topic: "World War I causes, escalation, major fronts, and consequences",
  kind: "test",
  deadline: request.deadline,
  rationale: "Build a causal model first, then retrieve and apply the important ideas across later sessions.",
  deferredTopics: [],
  sessions: [{
    title: "Build the outbreak chain",
    objective: "Explain how one assassination triggered alliances, mobilization, and declarations of war.",
    method: "Self-explanation with a causal model",
    methodReason: "The learner is new to the topic and asked for the big picture before details.",
    scheduledFor: "2026-08-10T02:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "One causal model and one explain-back, about 15 minutes",
    learningMode: "learn",
    topicIds: ["11111111-1111-4111-8111-111111111111"],
    contentTargets: ["The causal chain from assassination to wider European war"],
    completionEvidence: ["Explain the outbreak chain in order without reopening the model"],
  }, {
    title: "Retrieve the outbreak chain",
    objective: "Recall and apply the outbreak chain after a delay.",
    method: "Retrieval practice",
    methodReason: "A delayed attempt checks whether the causal chain remains available without the model.",
    scheduledFor: "2026-08-12T02:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "A short delayed retrieval, about 15 minutes",
    learningMode: "study",
    topicIds: ["11111111-1111-4111-8111-111111111111"],
    contentTargets: ["The causal chain from assassination to wider European war"],
    completionEvidence: ["Recall and apply the outbreak chain without notes"],
  }],
};

describe("plan to session handoff", () => {
  it("preserves the learning target, time, approach, and delivery preferences", () => {
    const plan = materializePlanDraft(draft, request);
    const answers = Array.from({ length: 16 }, () => "");
    answers[0] = "Large amounts of new information feel overwhelming";
    answers[1] = "Give me clear structure";
    answers[3] = "One concrete example first";
    answers[4] = "I use short sessions";
    answers[5] = "I start more consistently with a small first action";
    answers[7] = "Understand first, then retain it";
    answers[10] = "The big picture before the details";
    answers[11] = "I forget it after a few days";
    answers[12] = "Give me a small hint first";
    answers[13] = "Show one step at a time";
    answers[14] = "For history, help me follow the story before memorizing names and dates.";

    const context = buildPreviewSessionContext({
      plan,
      session: plan.sessions[0]!,
      onboardingAnswers: answers,
      completions: [],
      interruptions: [],
    });

    expect(context.learningGoal).toMatchObject({
      topic: draft.topic,
      learningIntent: "learn",
      studyMode: "inside_yova",
    });
    expect(context.journey).toMatchObject({ currentSequence: 1, totalSessions: 2 });
    expect(context.session).toMatchObject({
      learningMode: "learn",
      estimatedMinutes: 15,
      contentTargets: draft.sessions[0]!.contentTargets,
      completionEvidence: draft.sessions[0]!.completionEvidence,
    });
    expect(context.learnerProfile).toMatchObject({
      explanationPreference: "One concrete example first",
      processingPreference: "The big picture before the details",
      memoryChallenge: "I forget it after a few days",
      supportPreference: "Give me a small hint first",
      workspacePreference: "Show one step at a time",
      freeformContext: "For history, help me follow the story before memorizing names and dates.",
    });
    expect(context.journey?.nextSessions[0]).toMatchObject({
      title: "Retrieve the outbreak chain",
      contentTargets: draft.sessions[1]!.contentTargets,
    });
  });
});

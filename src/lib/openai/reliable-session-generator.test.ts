import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ model: "gpt-yova-test" }),
}));

const lesson = {
  concept: "Melatonin as a darkness signal",
  focus: "How darkness leads to melatonin release and marks biological night",
  essentialIdea: "Darkness prompts a circadian signal that increases melatonin and marks biological night.",
  keyIdea: "Melatonin signals biological night rather than directly forcing sleep.",
  explanation: "When light input falls, the brain's circadian clock interprets the change as night and signals the pineal gland to release melatonin. The rising hormone helps coordinate internal timing and makes sleep more likely, but it does not act as a sedative switch.",
  example: {
    setup: "A person enters a dark room in the evening.",
    steps: [
      "Less light reaches the circadian system.",
      "The circadian clock signals the pineal gland.",
      "The pineal gland releases more melatonin.",
    ],
    takeaway: "Melatonin communicates that biological night has begun.",
  },
  commonMistake: {
    mistake: "Melatonin directly knocks a person unconscious.",
    correction: "Melatonin is mainly a timing signal and does not work like a sedative.",
  },
  check: {
    title: "What is melatonin's main role?",
    prompt: "Choose the statement that best describes melatonin in the circadian system.",
    choices: [
      "It directly forces sleep.",
      "It marks biological night.",
      "It creates daylight signals.",
      "It replaces the circadian clock.",
    ],
    correctChoiceIndex: 1,
    feedback: "Melatonin rises in darkness and helps communicate biological night to the body.",
  },
  explainBack: {
    title: "Explain the darkness signal",
    prompt: "Explain how darkness, the circadian clock, the pineal gland, and melatonin connect.",
    modelAnswer: "Reduced light is interpreted by the circadian clock as night. The clock signals the pineal gland to release melatonin, and melatonin helps coordinate biological night without directly forcing sleep.",
    feedback: "The explanation should preserve the causal order and distinguish a timing signal from direct sedation.",
  },
};

function providerResponse(outputParsed: unknown) {
  return {
    id: "response-reliable",
    model: "gpt-yova-test",
    status: "completed",
    output: [],
    output_parsed: outputParsed,
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 250,
    },
  };
}

function context(learningMode: "learn" | "study" = "learn"): SessionGenerationContext {
  return {
    learningGoal: {
      title: "Melatonin: The Body's Darkness Signal",
      topic: "How darkness, circadian timing, the pineal gland, and melatonin relate",
      kind: "topic",
      deadline: null,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: learningMode,
    },
    planRationale: "Build a causal model before checking whether the learner can explain it.",
    materials: [],
    session: {
      title: "Build a basic model of melatonin",
      objective: "Explain how darkness leads to melatonin release and how melatonin signals biological night.",
      method: learningMode === "learn" ? "Self-explanation" : "Retrieval practice",
      methodReason: "The task requires a connected causal explanation.",
      estimatedMinutes: 15,
      learningMode,
      contentTargets: ["Darkness and circadian timing", "Pineal melatonin release"],
      completionEvidence: ["Explain the complete causal relationship in your own words"],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: {
      commonBlocker: "Getting started",
      guidancePreference: "Clear structure",
      explanationPreference: "Big picture first",
      focusFrequency: null,
      startingPattern: "A small first action helps",
      primaryImprovementGoal: "Understand topics deeply",
      processingPreference: "Big picture before details",
      memoryChallenge: "I forget after a few days",
      supportPreference: "Show a different example when stuck",
      workspacePreference: "One step at a time",
      freeformContext: null,
      observationCorrection: null,
    },
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
  };
}

describe("reliable OpenAI session generation", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it("turns an arbitrary clear topic into a concrete teaching session in one compact request", async () => {
    parseResponse.mockResolvedValueOnce(providerResponse(lesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");

    const result = await generateReliableSessionWithOpenAI(context());

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[1]).toEqual({ maxRetries: 0, timeout: 14_000 });
    expect(result.draft.activities[0]?.teaching?.explanation).toContain("circadian clock");
    expect(result.draft.activities.find((activity) => activity.type === "free_response")?.correctAnswer)
      .toContain("pineal gland");
    expect(result.draft.methodBriefing.personalization).toContain(
      "You asked for the big picture first, so YOVA will establish the overall model before the details.",
    );
    expect(result.draft.activities.at(-1)?.methodPhase).toBe("schedule_return");
  });

  it("starts a study session with retrieval before showing the corrective model", async () => {
    parseResponse.mockResolvedValueOnce(providerResponse(lesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");

    const result = await generateReliableSessionWithOpenAI(context("study"));

    expect(result.draft.activities[0]?.type).toBe("multiple_choice");
    expect(result.draft.activities[0]?.methodPhase).toBe("retrieve");
    expect(result.draft.activities[1]?.teaching?.keyIdea).toContain("biological night");
  });

  it("uses the compact path only when its activity shape can execute the routed method", async () => {
    const { canGenerateReliableSession } = await import("@/lib/openai/reliable-session-generator");

    expect(canGenerateReliableSession(context("learn"))).toBe(true);
    expect(canGenerateReliableSession(context("study"))).toBe(true);

    const readingContext = context("learn");
    readingContext.learningGoal = {
      ...readingContext.learningGoal,
      title: "Read a history chapter",
      topic: "Read a World War I chapter for a quiz and recall the causal sequence",
      kind: "test",
    };
    readingContext.session = {
      ...readingContext.session,
      title: "Read and recall the alliance system",
      objective: "Read the assigned section, recall the causal sequence closed-source, and repair gaps from the text.",
      method: "Read, recall, review",
      methodReason: "The learner must remember and explain a bounded reading for a quiz.",
    };

    expect(canGenerateReliableSession(readingContext)).toBe(false);
  });

  it("reserves the full adaptive engine for longer, external, or evidence-rich sessions", async () => {
    const { canGenerateReliableSession } = await import("@/lib/openai/reliable-session-generator");

    const longSession = context("learn");
    longSession.session.estimatedMinutes = 45;
    expect(canGenerateReliableSession(longSession)).toBe(false);

    const outsideSession = context("learn");
    outsideSession.learningGoal.studyMode = "outside_yova";
    expect(canGenerateReliableSession(outsideSession)).toBe(false);

    const evidenceRichSession = context("study");
    evidenceRichSession.recentResults = [{
      methodId: "retrieval_practice",
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      correctAnswers: 1,
      totalAnswers: 3,
      feedback: "too_difficult",
      observedGap: "Melatonin is a timing signal rather than a sedative",
      plannedMinutes: 15,
      actualMinutes: 15,
      calibrationPattern: "possible_misconception",
    }];
    expect(canGenerateReliableSession(evidenceRichSession)).toBe(false);
  });
});

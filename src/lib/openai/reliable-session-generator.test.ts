import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());
const TEST_TOPIC_ID = "11111111-1111-4111-8111-111111111111";

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
    knowledgeTopics: [{
      id: TEST_TOPIC_ID,
      title: "Melatonin as a darkness signal",
      description: "How darkness, circadian timing, the pineal gland, and melatonin relate.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    session: {
      title: "Build a basic model of melatonin",
      objective: "Explain how darkness leads to melatonin release and how melatonin signals biological night.",
      method: learningMode === "learn" ? "Self-explanation" : "Retrieval practice",
      methodReason: "The task requires a connected causal explanation.",
      estimatedMinutes: 15,
      learningMode,
      topicIds: [TEST_TOPIC_ID],
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
    expect(parseResponse.mock.calls[0]?.[1]).toEqual({ maxRetries: 0, timeout: 28_000 });
    expect(result.draft.activities[0]?.teaching?.explanation).toContain("circadian clock");
    const expectedTarget = context().session.contentTargets?.[0];
    expect(expectedTarget).toBeDefined();
    expect(result.draft.activities[0]?.teaching?.keyIdea).toBe(expectedTarget);
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

  it("repairs a coherent-looking lesson when its actual content misses the target", async () => {
    const unrelatedLesson = {
      ...lesson,
      concept: "Plant photosynthesis",
      focus: "How chlorophyll captures light energy in a plant leaf",
      essentialIdea: "Chlorophyll helps plants capture light energy for photosynthesis.",
      keyIdea: "Photosynthesis stores captured light energy in glucose.",
      explanation: "Chlorophyll in plant cells absorbs light energy. Photosynthesis uses that energy to combine carbon dioxide and water into glucose, storing part of the captured energy in chemical bonds while releasing oxygen.",
      example: {
        setup: "A green leaf receives sunlight during the day.",
        steps: [
          "Chlorophyll absorbs some of the incoming light.",
          "The plant uses that energy to build glucose.",
        ],
        takeaway: "The leaf converts light energy into stored chemical energy.",
      },
      commonMistake: {
        mistake: "Plants obtain all of their stored energy directly from soil.",
        correction: "Plants capture light energy and store it in glucose through photosynthesis.",
      },
      check: {
        title: "What does chlorophyll help capture?",
        prompt: "In photosynthesis, what form of energy does chlorophyll help a plant capture?",
        choices: ["Light energy", "Sound energy", "Motion energy", "Nuclear energy"],
        correctChoiceIndex: 0,
        feedback: "Chlorophyll absorbs light that supplies energy for photosynthesis.",
      },
      explainBack: {
        title: "Explain the energy change",
        prompt: "Explain how a plant changes light energy into stored chemical energy.",
        modelAnswer: "Chlorophyll absorbs light, and photosynthesis uses that energy to build glucose that stores chemical energy.",
        feedback: "The explanation should connect absorbed light with glucose production.",
      },
    };
    parseResponse
      .mockResolvedValueOnce(providerResponse(unrelatedLesson))
      .mockResolvedValueOnce(providerResponse(lesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");

    const result = await generateReliableSessionWithOpenAI(context());

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls[1]?.[0]?.instructions).toContain("failed validation");
    expect(result.generationStats.firstAttemptPassed).toBe(false);
    expect(result.generationStats.repairSucceeded).toBe(true);
    expect(result.draft.activities[0]?.teaching?.explanation).toContain("circadian clock");
  });

  it("uses the compact path only when its activity shape can execute the routed method", async () => {
    const { canGenerateReliableSession } = await import("@/lib/openai/reliable-session-generator");

    const boundedLearnContext = context("learn");
    boundedLearnContext.session.contentTargets = ["How darkness influences melatonin timing"];
    expect(canGenerateReliableSession(boundedLearnContext)).toBe(true);

    const boundedStudyContext = context("study");
    boundedStudyContext.session.contentTargets = ["Recall the biological-night relationship"];
    expect(canGenerateReliableSession(boundedStudyContext)).toBe(true);

    const multiTargetContext = context("learn");
    expect(canGenerateReliableSession(multiTargetContext)).toBe(false);

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

  it("turns one observed calculus gap into a model-first repair session", async () => {
    const repairLesson = {
      concept: "Quotient rule",
      focus: "Set up the quotient rule correctly for derivatives of fractions",
      essentialIdea: "The quotient rule differentiates the numerator and denominator in a specific crossed order over the denominator squared.",
      keyIdea: "For $f/g$, use $(f'g-fg')/g^2$, preserving the crossed order and squaring the original denominator.",
      explanation: "The quotient rule measures how a ratio changes when both its numerator and denominator can change. Differentiate the numerator while keeping the denominator, subtract the numerator times the derivative of the denominator, then divide by the original denominator squared.",
      example: {
        setup: "Differentiate $h(x)=x^2/(x+1)$ using the quotient rule.",
        steps: [
          "Let $f=x^2$, $g=x+1$, $f'=2x$, and $g'=1$.",
          "Substitute into $(f'g-fg')/g^2$ to get $[2x(x+1)-x^2]/(x+1)^2$.",
          "Simplify the numerator to get $(x^2+2x)/(x+1)^2$.",
        ],
        takeaway: "Keep the crossed numerator order and square the unchanged denominator.",
      },
      commonMistake: {
        mistake: "Differentiate the numerator and denominator separately and divide the results.",
        correction: "Use the full quotient-rule numerator and divide by the original denominator squared.",
      },
      check: {
        title: "Choose the quotient-rule setup",
        prompt: "Which expression correctly begins the derivative of $h(x)=x^2/(x+1)$?",
        choices: [
          "$2x/1$",
          "$[2x(x+1)-x^2]/(x+1)^2$",
          "$[x^2-2x(x+1)]/(x+1)$",
          "$[2x+x^2]/(x+1)^2$",
        ],
        correctChoiceIndex: 1,
        feedback: "The correct setup follows $(f'g-fg')/g^2$ and keeps the original denominator squared.",
      },
      explainBack: {
        title: "Explain the quotient-rule setup",
        prompt: "Explain the order of the two numerator terms and what belongs in the denominator.",
        modelAnswer: "Multiply the derivative of the numerator by the original denominator, subtract the original numerator times the derivative of the denominator, and divide by the original denominator squared.",
        feedback: "A correct explanation preserves the crossed order, subtraction, and squared original denominator.",
      },
    };
    parseResponse.mockResolvedValueOnce(providerResponse(repairLesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");
    const repairContext = context("study");
    repairContext.learningGoal = {
      ...repairContext.learningGoal,
      title: "Derivative rules",
      topic: "Product rule and quotient rule",
      kind: "skill",
    };
    repairContext.session = {
      ...repairContext.session,
      title: "Repair the quotient rule",
      objective: "Use a worked example to repair the quotient-rule setup, then solve a similar derivative independently.",
      method: "Worked example fading, then retrieval",
      methodReason: "The previous check showed repeated setup errors on the quotient rule.",
      estimatedMinutes: 25,
      contentTargets: [],
    };
    repairContext.recentResults = [{
      methodId: "worked_example_fading",
      taskType: "problem_solving",
      knowledgeStage: "novice",
      correctAnswers: 1,
      totalAnswers: 4,
      feedback: "too_difficult",
      observedGap: "Quotient rule setup and denominator squaring",
      plannedMinutes: 25,
      actualMinutes: 25,
      calibrationPattern: "possible_misconception",
    }];
    repairContext.conceptSignals = [{
      concept: "Quotient rule",
      attempts: 2,
      secureAttempts: 0,
      needsReviewAttempts: 2,
      lastOutcome: "needs_review",
      lastObservedAt: "2026-08-05T18:00:00.000Z",
      status: "needs_review",
    }];

    const result = await generateReliableSessionWithOpenAI(repairContext);

    expect(result.draft.methodBriefing.methodId).toBe("worked_example_fading");
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "model",
      "guided_practice",
      "independent_practice",
      "schedule_return",
    ]);
    expect(result.draft.activities[1]?.concept).toBe("Quotient rule");
    expect(result.draft.activities[0]?.teaching?.example?.steps).toHaveLength(3);
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

    const boundedWorkedRepair = context("study");
    boundedWorkedRepair.learningGoal = {
      ...boundedWorkedRepair.learningGoal,
      title: "Derivative rules",
      topic: "Product rule and quotient rule",
      kind: "skill",
    };
    boundedWorkedRepair.session = {
      ...boundedWorkedRepair.session,
      title: "Repair the quotient rule",
      objective: "Use a worked example to repair the quotient-rule setup, then solve a similar derivative independently.",
      method: "Worked example fading, then retrieval",
      methodReason: "The previous check showed repeated setup errors on the quotient rule.",
      estimatedMinutes: 25,
      contentTargets: [],
    };
    boundedWorkedRepair.recentResults = [{
      methodId: "worked_example_fading",
      taskType: "problem_solving",
      knowledgeStage: "novice",
      correctAnswers: 1,
      totalAnswers: 4,
      feedback: "too_difficult",
      observedGap: "Quotient rule setup and denominator squaring",
      plannedMinutes: 25,
      actualMinutes: 25,
      calibrationPattern: "possible_misconception",
    }];
    boundedWorkedRepair.conceptSignals = [{
      concept: "Quotient rule",
      attempts: 2,
      secureAttempts: 0,
      needsReviewAttempts: 2,
      lastOutcome: "needs_review",
      lastObservedAt: "2026-08-05T18:00:00.000Z",
      status: "needs_review",
    }];
    expect(canGenerateReliableSession(boundedWorkedRepair)).toBe(true);
  });
});

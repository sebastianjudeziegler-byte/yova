import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildImmediateRepairAfterMiss } from "@/lib/learning/session-evidence";
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
    expect(parseResponse.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      maxRetries: 0,
      timeout: 28_000,
      signal: expect.any(AbortSignal),
    }));
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
  }, 15_000);

  it("stops a reliable provider call at the shared route deadline", async () => {
    const startedAt = new Date("2026-08-21T14:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse.mockImplementationOnce((_, options: { signal: AbortSignal }) => (
      new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      })
    ));

    try {
      const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");
      const generation = generateReliableSessionWithOpenAI(context(), {
        deadlineAt: startedAt.getTime() + 30_000,
        settlementReserveMs: 12_000,
      });
      const rejection = expect(generation).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 1,
          failedValidator: "session_provider_request",
        },
      });

      await vi.advanceTimersByTimeAsync(18_000);
      await rejection;
      expect(parseResponse).toHaveBeenCalledTimes(1);
      expect(parseResponse.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        maxRetries: 0,
        timeout: 18_000,
        signal: expect.any(AbortSignal),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends teaching decisions through the delivery policy but keeps CSS decisions out", async () => {
    parseResponse.mockResolvedValueOnce(providerResponse(lesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");
    const personalizedContext = context();
    personalizedContext.personalization = {
      decisions: [
        {
          id: "decision:method_delivery:activity_cadence:short_active_rounds",
          artifact: "method_delivery",
          setting: "activity_cadence",
          value: "short_active_rounds",
          title: "Controlled activity changes",
          explanation: "Use short active rounds and change activities only at planned checkpoints.",
          signalIds: ["signal:attention_variability"],
          evidenceLabel: "You told YOVA",
          methodCandidates: [],
          experimental: false,
        },
        {
          id: "decision:support:attempt_safety:private_revisable_attempt",
          artifact: "support",
          setting: "attempt_safety",
          value: "private_revisable_attempt",
          title: "A low-stakes first attempt",
          explanation: "Make the first answer private and revisable before using feedback as information.",
          signalIds: ["signal:mistake_sensitivity"],
          evidenceLabel: "You told YOVA",
          methodCandidates: [],
          experimental: false,
        },
        {
          id: "decision:workspace:text_density:reduced",
          artifact: "workspace",
          setting: "text_density",
          value: "reduced",
          title: "Less text on screen",
          explanation: "Keep the interface concise and reveal extra interface detail on request.",
          signalIds: ["signal:workspace_settings"],
          evidenceLabel: "You told YOVA",
          methodCandidates: [],
          experimental: false,
        },
      ],
      methodTie: {
        state: {
          controls: { experiments: false },
          activeExperiment: null,
          experimentHistory: [],
        },
        signals: [],
      },
    };

    await generateReliableSessionWithOpenAI(personalizedContext);

    const prompt = String(parseResponse.mock.calls[0]?.[0]?.input);
    expect(prompt).toContain('"activityCadence":{"mode":"short_active_rounds"');
    expect(prompt).toContain('"attemptSafety":{"mode":"private_revisable_attempt"');
    expect(prompt).not.toContain("text_density");
    expect(prompt).not.toContain("Less text on screen");
  });

  it("normalizes readable legacy material excerpts that lack chunk metadata", async () => {
    parseResponse.mockResolvedValueOnce(providerResponse(lesson));
    const { generateReliableSessionWithOpenAI } = await import("@/lib/openai/reliable-session-generator");
    const legacyMaterialContext = context();
    legacyMaterialContext.learningGoal.sourceMode = "user_materials";
    legacyMaterialContext.session.contentTargets = [
      "Darkness increases melatonin as a signal of biological night.",
    ];
    legacyMaterialContext.materials = [{
      name: "Melatonin study guide.pdf",
      text: "Study guide scope: darkness, circadian timing, pineal melatonin release, and biological night.",
      truncated: false,
      role: "scope_outline",
    }];

    const result = await generateReliableSessionWithOpenAI(legacyMaterialContext);

    expect(result.draft.sourceGrounding?.mode).toBe("materials_plus_ai");
    expect(result.draft.sourceGrounding?.anchors[0]).toMatchObject({
      sourceName: "Melatonin study guide.pdf",
      locationLabel: "Uploaded material",
    });
    expect(result.draft.sourceGrounding?.anchors[0]?.chunkId)
      .toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
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

    const personalizedToUnsupportedCompactMethod = context("learn");
    personalizedToUnsupportedCompactMethod.session.contentTargets = [
      "How darkness influences melatonin timing",
    ];
    personalizedToUnsupportedCompactMethod.personalization = {
      decisions: [],
      methodTie: {
        state: {
          controls: { experiments: true },
          activeExperiment: {
            id: "method-tie-test",
            variable: "method_tie",
            variantA: "self_explanation",
            variantB: "read_recall_review",
            taskType: "conceptual_learning",
            knowledgeStage: "novice",
            nextVariant: "b",
          },
          experimentHistory: [],
        },
        signals: [],
      },
    };
    // Hidden experiments no longer have routing authority.
    expect(canGenerateReliableSession(personalizedToUnsupportedCompactMethod)).toBe(true);

    const unsupportedCompactMethod = context("learn");
    unsupportedCompactMethod.learningGoal.title = "Read a chapter for a quiz";
    unsupportedCompactMethod.learningGoal.topic = "Question-led reading and closed-source recall";
    unsupportedCompactMethod.session.title = "Read, recall, and review the chapter";
    unsupportedCompactMethod.session.objective = "Read a bounded section, recall it closed-source, and repair gaps.";
    unsupportedCompactMethod.session.method = "Read-recall-review";
    unsupportedCompactMethod.session.contentTargets = [
      "Recall the chapter's central claim after reading one bounded section",
    ];
    expect(canGenerateReliableSession(unsupportedCompactMethod)).toBe(false);

    const boundedStudyContext = context("study");
    boundedStudyContext.session.contentTargets = ["Recall the biological-night relationship"];
    expect(canGenerateReliableSession(boundedStudyContext)).toBe(true);

    const multiTargetContext = context("learn");
    expect(canGenerateReliableSession(multiTargetContext)).toBe(false);

    const mixedContext = context("learn");
    const aiTopicId = "22222222-2222-4222-8222-222222222222";
    const materialId = "33333333-3333-4333-8333-333333333333";
    const chunkId = "44444444-4444-4444-8444-444444444444";
    mixedContext.learningGoal.sourceMode = "user_materials";
    mixedContext.materials = [{
      materialId,
      chunkId,
      chunkIndex: 0,
      name: "melatonin-notes.txt",
      text: "Darkness is interpreted by the circadian clock, which signals increased melatonin release.",
      truncated: false,
      locationLabel: "Darkness signal",
      role: "content_source",
    }];
    mixedContext.knowledgeTopics = [{
      ...mixedContext.knowledgeTopics[0]!,
      origin: "material",
      sourceReferences: [{
        materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: 90,
        locationLabel: "Darkness signal", sectionRole: "content_source",
      }],
    }, {
      ...mixedContext.knowledgeTopics[0]!,
      id: aiTopicId,
      title: "Melatonin receptor signalling",
      description: "How receptor signalling carries the biological-night signal.",
      sourceReferences: [],
      origin: "ai_generated",
    }];
    mixedContext.session.topicIds = [TEST_TOPIC_ID, aiTopicId];
    mixedContext.session.contentTargets = ["How darkness influences melatonin timing"];
    expect(canGenerateReliableSession(mixedContext)).toBe(false);

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

  it("turns one observed calculus gap into attempt-first Practice Problems", async () => {
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
        title: "Transfer the quotient rule",
        prompt: "For $q(x)=(x+1)/(x^2+1)$, use the crossed numerator order and original denominator squared to write the quotient-rule setup before simplifying.",
        modelAnswer: "Differentiate the numerator times the original denominator, subtract the numerator times the derivative of the denominator, and square the original denominator: $[(1)(x^2+1)-(x+1)(2x)]/(x^2+1)^2$.",
        feedback: "The changed-context setup should preserve the crossed numerator order and square the original denominator.",
      },
    };
    parseResponse.mockResolvedValueOnce(providerResponse(repairLesson));
    const {
      canGenerateReliableSession,
      generateReliableSessionWithOpenAI,
    } = await import("@/lib/openai/reliable-session-generator");
    const repairContext = context("study");
    repairContext.learningGoal = {
      ...repairContext.learningGoal,
      title: "Derivative rules",
      topic: "Product rule and quotient rule",
      kind: "skill",
    };
    repairContext.session = {
      ...repairContext.session,
      title: "Practice the quotient rule",
      objective: "Attempt one quotient-rule setup independently, then solve a changed-context derivative problem.",
      method: "Practice Problems",
      methodReason: "The previous check exposed a quotient-rule setup gap, so begin with an unsupported attempt and repair only an observed miss.",
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

    expect(canGenerateReliableSession(repairContext)).toBe(true);
    const result = await generateReliableSessionWithOpenAI(repairContext);

    expect(result.draft.methodBriefing.methodId).toBe("practice_problems");
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "independent_practice",
      "transfer",
      "reflect",
      "schedule_return",
    ]);
    const attempt = result.draft.activities[0]!;
    expect(attempt).toMatchObject({
      type: "multiple_choice",
      concept: "Quotient rule",
      teaching: null,
    });
    expect(result.draft.activities.some((activity) => (
      activity.methodPhase === "model" || activity.methodPhase === "repair"
    ))).toBe(false);
    expect(result.draft.activities[1]?.body).toContain("q(x)");
    expect(result.draft.activities[2]).toMatchObject({
      type: "reflection",
      requiredForCompletion: false,
      teaching: null,
    });
    expect(result.draft.activities
      .filter((activity) => activity.requiredForCompletion)
      .reduce((total, activity) => total + activity.estimatedMinutes, 0)).toBe(25);
    expect(buildImmediateRepairAfterMiss([{
      topicId: attempt.topicId,
      methodPhase: attempt.methodPhase,
      estimatedMinutes: attempt.estimatedMinutes,
      requiredForCompletion: attempt.requiredForCompletion,
      type: attempt.type,
      concept: attempt.concept,
      label: attempt.label,
      title: attempt.title,
      body: attempt.body,
      teaching: attempt.teaching,
      question: attempt.type === "multiple_choice" ? attempt.choices : null,
      correctAnswer: attempt.correctAnswer,
      feedback: attempt.feedback,
    }], 0, { 0: false })).toMatchObject({
      methodPhase: "repair",
      evidenceRole: "immediate_repair",
      concept: "Quotient rule",
    });
    const providerInput = JSON.parse(
      (parseResponse.mock.calls[0]?.[0]?.input as string).split("\n").slice(1).join("\n"),
    );
    expect(providerInput.generationMethod).toEqual({
      methodId: "practice_problems",
      learningMode: "study",
    });
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).toMatch(/changed-context problem/i);
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

    const boundedAttemptFirstPractice = context("study");
    boundedAttemptFirstPractice.learningGoal = {
      ...boundedAttemptFirstPractice.learningGoal,
      title: "Derivative rules",
      topic: "Product rule and quotient rule",
      kind: "skill",
    };
    boundedAttemptFirstPractice.session = {
      ...boundedAttemptFirstPractice.session,
      title: "Practice the quotient rule",
      objective: "Attempt one quotient-rule setup independently, then solve a changed-context derivative problem.",
      method: "Practice Problems",
      methodReason: "The previous check exposed a quotient-rule setup gap, so begin with an unsupported attempt and repair only an observed miss.",
      estimatedMinutes: 25,
      contentTargets: [],
    };
    boundedAttemptFirstPractice.recentResults = [{
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
    boundedAttemptFirstPractice.conceptSignals = [{
      concept: "Quotient rule",
      attempts: 2,
      secureAttempts: 0,
      needsReviewAttempts: 2,
      lastOutcome: "needs_review",
      lastObservedAt: "2026-08-05T18:00:00.000Z",
      status: "needs_review",
    }];
    expect(canGenerateReliableSession(boundedAttemptFirstPractice)).toBe(true);
  });
});

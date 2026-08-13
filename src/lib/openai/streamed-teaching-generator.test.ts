import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_ID = "33333333-3333-4333-8333-333333333333";

function contextWithMaterials(
  materials: SessionGenerationContext["materials"],
): SessionGenerationContext {
  return {
    sessionArchitectureVersion: "streamed_teaching_v1",
    learningGoal: {
      title: "World War I Test Prep",
      topic: "World War I",
      kind: "test",
      deadline: null,
      sourceMode: "user_materials",
      studyMode: "inside_yova",
      learningIntent: "learn",
    },
    planRationale: "Teach the mapped causes before asking for evidence.",
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    materials,
    knowledgeTopics: [{
      id: TOPIC_ID,
      title: "Causes of World War I",
      description: "How long-term tensions and alliance commitments widened the conflict.",
      subtopics: ["Militarism", "Alliance systems", "The July Crisis"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "material",
      deferred: null,
    }],
    session: {
      title: "Connect the causes of World War I",
      objective: "Explain how alliances widened a local crisis.",
      method: "Self-explanation",
      methodReason: "Build the causal model before checking it.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TOPIC_ID],
      contentTargets: ["Alliances widened a local crisis"],
      completionEvidence: ["Explain the relationship without notes"],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: null,
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

describe("bounded streamed-skeleton repair policy", () => {
  it("reports a raw provider rejection as a structured generation failure", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(generateStreamedTeachingSkeletonWithOpenAI(contextWithMaterials([]))).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        failedValidator: "session_provider_request",
        repairAttempted: false,
      },
    });
  });

  it("allows the third call to be the successful scope-only repair", async () => {
    const {
      streamedSkeletonRepairAttemptCopy,
      streamedSkeletonRequestTimeoutMs,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 10_000;
    const simulatedOutcomes = [
      "streamed_lesson_scope",
      "streamed_lesson_scope",
      null,
    ] as const;
    const requestTimes = [startedAt, startedAt + 9_000, startedAt + 18_000];
    let previousFailedValidator: "streamed_lesson_scope" | null = null;
    let successfulAttempt = 0;

    simulatedOutcomes.forEach((outcome, attemptIndex) => {
      const timeout = streamedSkeletonRequestTimeoutMs({
        attemptIndex,
        generationStartedAt: startedAt,
        now: requestTimes[attemptIndex]!,
        previousFailedValidator,
      });
      expect(timeout).not.toBeNull();
      if (outcome === null) successfulAttempt = attemptIndex + 1;
      previousFailedValidator = outcome;
    });

    expect(successfulAttempt).toBe(3);
    expect(streamedSkeletonRepairAttemptCopy(successfulAttempt)).toBe("2 repair attempts");
  });

  it("keeps ordinary non-scope failures at the existing two provider calls", async () => {
    const { streamedSkeletonRequestTimeoutMs } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 20_000;

    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 0,
      generationStartedAt: startedAt,
      now: startedAt,
      previousFailedValidator: null,
    })).toBe(35_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 1,
      generationStartedAt: startedAt,
      now: startedAt + 8_000,
      previousFailedValidator: "session_structure",
    })).toBe(35_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 16_000,
      previousFailedValidator: "session_structure",
    })).toBeNull();
  });

  it("uses only the remaining total budget and refuses an unviable third call", async () => {
    const { streamedSkeletonRequestTimeoutMs } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 30_000;

    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 40_000,
      previousFailedValidator: "streamed_lesson_scope",
    })).toBe(18_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 54_001,
      previousFailedValidator: "streamed_lesson_scope",
    })).toBeNull();
  });

  it("turns a later-attempt SDK Zod failure into a controlled session failure", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const malformed = z.object({ required: z.string() }).safeParse({});
    if (malformed.success) throw new Error("Expected the test fixture to fail Zod parsing.");

    parseResponse.mockReset();
    parseResponse
      .mockRejectedValueOnce(malformed.error)
      .mockRejectedValueOnce(malformed.error);

    const generation = generateStreamedTeachingSkeletonWithOpenAI(contextWithMaterials([{
      name: "World War I study guide.pdf",
      text: "Alliances and mobilization widened the July Crisis into a European war.",
      truncated: false,
      role: "scope_outline",
    }]));

    await expect(generation).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        failedValidator: "session_structure",
        repairAttempted: true,
        repairSucceeded: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });
});

describe("streamed lesson-brief placement normalization", () => {
  it("removes misplaced lesson briefs from multiple choice, free response, and reflection", async () => {
    const {
      normalizeStreamedLessonBriefPlacement,
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const essentialIdea = "Alliance commitments increased the chance that a local crisis would widen.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: [essentialIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const output = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach one bounded causal relationship before requiring an explanation from memory.",
      coverage: {
        focus: "Explain how alliance commitments increased escalation risk.",
        essentialIdeas: [essentialIdea],
        completionEvidence: ["Explain the alliance relationship without reopening the model"],
        evidenceMap: [{
          essentialIdea,
          activityConcept: "Alliance escalation risk",
        }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a concise causal model and then explain the relationship from memory.",
        why: "Producing the causal relationship reveals whether the learner understood the model.",
        how: ["Study the model once.", "Explain the relationship without reopening it."],
        completion: "Explain how alliance commitments increased escalation risk without notes.",
        personalization: ["The bounded model keeps the first learning action focused and concrete."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId: TOPIC_ID,
          methodPhase: "model",
          estimatedMinutes: 5,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the alliance model",
          body: "Study the bounded causal relationship before trying to explain it.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "guided_practice",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          label: "Check",
          title: "Choose the escalation link",
          body: "Choose the statement that best explains the active relationship.",
          teaching: null,
          lessonBrief,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "multiple_choice",
          concept: "Alliance escalation recognition",
          choices: [
            "Alliance commitments could draw additional states into a local crisis.",
            "Alliance commitments guaranteed that every dispute stayed local.",
            "Alliance commitments ended all military planning before the crisis.",
          ],
          correctAnswer: "Alliance commitments could draw additional states into a local crisis.",
          feedback: "Existing commitments increased the chance that several states would enter a local conflict.",
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the escalation risk",
          body: "Explain the active relationship from memory in one or two sentences.",
          teaching: null,
          lessonBrief,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: "Alliance escalation risk",
          choices: [],
          correctAnswer: essentialIdea,
          feedback: "Connect preexisting alliance commitments directly to the risk of wider state involvement.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check the relationship later",
          body: "YOVA will bring this same active relationship back after a delay.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => StreamedGeneratedSessionDraftSchema.parse(output)).toThrow(/only instruction activities/i);

    const normalized = normalizeStreamedLessonBriefPlacement(output);
    expect(normalized.activities.map((activity) => activity.lessonBrief !== null)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(normalized)).not.toThrow();
  });
});

describe("authoritative streamed-session source grounding", () => {
  it("creates a verifiable synthetic anchor when legacy excerpts lack chunk metadata", async () => {
    const { authoritativeSourceGrounding, legacyMaterialChunkId } = await import("@/lib/openai/streamed-teaching-generator");
    const context = contextWithMaterials([{
      name: "World War I study guide.pdf",
      text: "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
      truncated: false,
      role: "scope_outline",
    }]);

    expect(authoritativeSourceGrounding(context)).toMatchObject({
      mode: "materials_plus_ai",
      sourceNames: ["World War I study guide.pdf"],
      anchors: [{
        chunkId: legacyMaterialChunkId(
          "World War I study guide.pdf",
          "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
        ),
        locationLabel: "Uploaded material",
      }],
    });
  });

  it("keeps verified mapped chunks as authoritative anchors", async () => {
    const { authoritativeSourceGrounding } = await import("@/lib/openai/streamed-teaching-generator");
    const context = contextWithMaterials([{
      materialId: MATERIAL_ID,
      chunkId: CHUNK_ID,
      chunkIndex: 0,
      name: "World War I study guide.pdf",
      text: "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
      truncated: false,
      locationLabel: "Page 1, Long-term causes",
      role: "scope_outline",
    }]);

    expect(authoritativeSourceGrounding(context)).toMatchObject({
      mode: "materials_plus_ai",
      sourceNames: ["World War I study guide.pdf"],
      anchors: [{
        chunkId: CHUNK_ID,
        locationLabel: "Page 1, Long-term causes",
      }],
    });
  });
});

describe("streamed-session activity compaction", () => {
  it("keeps the final interleaved first action inside the delivery-policy cap", async () => {
    const {
      allocateStreamedTeachingMinutes,
      interleaveStreamedTeachingCycles,
      validateStreamedTeachingPacing,
    } = await import("@/lib/session-generation/streamed-pacing");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      buildStatedPreferenceLessonDelivery,
      validateSessionDeliveryPolicy,
    } = await import("@/lib/personalization/session-delivery-policy");
    const {
      melatoninStreamedEvaluationContext,
    } = await import("@/evals/melatonin-session-case");
    const context = melatoninStreamedEvaluationContext();
    const firstIdea = "Darkness changes the circadian signal that controls biological timing.";
    const secondIdea = "The pineal gland releases melatonin as a signal of biological night.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: [firstIdea, secondIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const question = (concept: string, idea: string) => ({
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      label: "Explain",
      title: `Explain ${concept}`,
      body: `Explain ${concept} without reopening the lesson.`,
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept,
      choices: [],
      correctAnswer: idea,
      feedback: `Compare your explanation with this relationship: ${idea}`,
    });
    const delivery = buildStatedPreferenceLessonDelivery({
      learnerProfile: context.learnerProfile,
      estimatedMinutes: 15,
      taskType: "conceptual_learning",
    });
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach the two connected melatonin relationships before requiring explanation from memory.",
      coverage: {
        focus: "Connect darkness, circadian timing, pineal release, and melatonin.",
        essentialIdeas: [firstIdea, secondIdea],
        completionEvidence: ["Explain both connected relationships without notes"],
        evidenceMap: [
          { essentialIdea: firstIdea, activityConcept: "Darkness and circadian timing" },
          { essentialIdea: secondIdea, activityConcept: "Pineal melatonin release" },
        ],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study the causal model, then explain each relationship from memory.",
        why: "Explaining each link reveals whether the causal model is understood.",
        how: ["Study one relationship.", "Explain it before continuing."],
        completion: "Explain both relationships without reopening the lesson.",
        personalization: delivery.policy.learnerFacingReasons.slice(0, 3),
      },
      sourceGrounding: null,
      activities: [{
        topicId: TOPIC_ID,
        methodPhase: "model",
        estimatedMinutes: 5,
        requiredForCompletion: true,
        label: "Learn",
        title: "Build the melatonin model",
        body: "Study the connected model before explaining each relationship.",
        teaching: null,
        lessonBrief,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "instruction",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }, question("Darkness and circadian timing", firstIdea), question("Pineal melatonin release", secondIdea), {
        topicId: null,
        methodPhase: "reflect",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        label: "Reflect",
        title: "Name the central relationship",
        body: "Name the relationship that now feels most important in the model.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "reflection",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }, {
        topicId: null,
        methodPhase: "schedule_return",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        label: "Return",
        title: "Check the model again later",
        body: "YOVA will bring this model back after a delay for unsupported retrieval.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "reflection",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
    });

    const maximumFirstActionMinutes = Math.max(5, delivery.policy.pacing.firstActionMinutes + 2);
    expect(delivery.policy.pacing.firstActionMinutes).toBe(2);
    expect(maximumFirstActionMinutes).toBe(5);
    const interleaved = interleaveStreamedTeachingCycles({
      draft,
      availableMinutes: 15,
      maximumFocusedActivities: delivery.policy.pacing.maximumActivities,
      maximumFirstActionMinutes,
    });
    const finalized = {
      ...interleaved,
      activities: allocateStreamedTeachingMinutes({
        activities: interleaved.activities,
        availableMinutes: 15,
        maximumFirstActionMinutes,
      }),
    };

    expect(finalized.activities.map((activity) => activity.methodPhase)).toEqual([
      "model", "explain", "model", "explain", "schedule_return",
    ]);
    expect(finalized.activities[0]?.estimatedMinutes).toBeLessThanOrEqual(5);
    expect(validateStreamedTeachingPacing({
      draft: finalized,
      availableMinutes: 15,
      maximumFocusedActivities: delivery.policy.pacing.maximumActivities,
    })).toBeNull();
    expect(validateSessionDeliveryPolicy({
      policy: delivery.policy,
      learningMode: "learn",
      activities: finalized.activities,
    })).toBeNull();
  });

  it("keeps produced recall when only one guided check can fit", async () => {
    const { retainBoundedQuestionMix } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const questionBase = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      body: "Answer this bounded World War I check.",
      teaching: null,
      lessonBrief: null,
      choices: [] as string[],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const questions = [
      {
        ...questionBase,
        type: "multiple_choice" as const,
        methodPhase: "guided_practice" as const,
        concept: "July Crisis trigger",
        label: "Check",
        title: "Choose the trigger",
        choices: ["Sarajevo assassination", "U.S. entry", "Armistice"],
        correctAnswer: "Sarajevo assassination",
        feedback: "The assassination triggered the July Crisis.",
      },
      {
        ...questionBase,
        type: "free_response" as const,
        methodPhase: "explain" as const,
        concept: "July Crisis escalation",
        label: "Explain",
        title: "Explain the escalation",
        correctAnswer: "Alliance commitments and mobilization widened the July Crisis into war.",
        feedback: "Connect commitments and mobilization directly to escalation.",
      },
    ];

    expect(retainBoundedQuestionMix(questions, 1).map((activity) => activity.type))
      .toEqual(["free_response"]);
    expect(retainBoundedQuestionMix(questions, 2).map((activity) => activity.type))
      .toEqual(["multiple_choice", "free_response"]);
  });

  it("keeps teaching, method phases, and both question types inside a 15-minute session", async () => {
    const { compactStreamedActivities } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const base = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      body: "Complete this focused World War I learning action.",
      teaching: null,
      lessonBrief: null,
      choices: [] as string[],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const activities = [
      { ...base, type: "instruction" as const, methodPhase: "model" as const, concept: null, label: "Learn", title: "Build the model" },
      { ...base, type: "multiple_choice" as const, methodPhase: "guided_practice" as const, concept: "Alliances", label: "Try", title: "Choose the link", choices: ["A", "B", "C"], correctAnswer: "A", feedback: "Alliance commitments widened the conflict." },
      { ...base, type: "instruction" as const, methodPhase: "orient" as const, concept: null, label: "Pause", title: "Review the timeline" },
      { ...base, type: "free_response" as const, methodPhase: "explain" as const, concept: "Mobilization", label: "Explain", title: "Explain the escalation", correctAnswer: "Mobilization made the crisis difficult to contain.", feedback: "Connect mobilization directly to escalation." },
      { ...base, type: "reflection" as const, topicId: null, methodPhase: "reflect" as const, concept: null, label: "Reflect", title: "Name the key link" },
      { ...base, type: "reflection" as const, topicId: null, methodPhase: "schedule_return" as const, concept: null, label: "Return", title: "Return later" },
    ];

    const compacted = compactStreamedActivities({
      activities,
      estimatedMinutes: 15,
      requiredPhases: ["model", "explain"],
    });

    expect(compacted.filter((activity) => activity.methodPhase !== "schedule_return")).toHaveLength(4);
    expect(compacted.some((activity) => activity.methodPhase === "model")).toBe(true);
    expect(compacted.some((activity) => activity.methodPhase === "explain")).toBe(true);
    expect(compacted.some((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(compacted.some((activity) => activity.type === "free_response")).toBe(true);
    expect(compacted.some((activity) => activity.methodPhase === "schedule_return")).toBe(true);
  });

  it("bounds the first activity to the learner delivery policy instead of regenerating the skeleton", async () => {
    const { alignFirstActionPacing } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const activities = [{
      topicId,
      methodPhase: "model" as const,
      estimatedMinutes: 9,
      requiredForCompletion: true,
      label: "Learn",
      title: "Build the World War I cause map",
      body: "Study the connected cause map before explaining it.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
      type: "instruction" as const,
      concept: null,
      choices: [],
      correctAnswer: null,
      feedback: null,
    }];

    expect(alignFirstActionPacing({ activities, maximumMinutes: 5 })[0]?.estimatedMinutes).toBe(5);
  });
});

describe("runtime session-window scoping", () => {
  it("uses cycle-compatible teaching methods for conceptual and programming lessons", async () => {
    const { streamedTeachingCycleRouting } = await import("@/lib/openai/streamed-teaching-generator");
    const { learningModeContract } = await import("@/lib/learning/learning-intent");
    const baseRouting = {
      learningIntent: "learn" as const,
      sessionLearningMode: "learn" as const,
      knowledgeStage: "novice" as const,
      methods: [],
      deliveryModifiers: [],
      decisionBasis: [],
      guardrails: [],
      executionContract: learningModeContract("learn"),
    };

    expect(streamedTeachingCycleRouting({
      ...baseRouting,
      taskType: "conceptual_learning",
      suggestedPrimaryMethodId: "read_recall_review",
      allowedMethodIds: ["read_recall_review", "self_explanation", "retrieval_practice"],
    }).allowedMethodIds).toEqual(["self_explanation"]);
    expect(streamedTeachingCycleRouting({
      ...baseRouting,
      taskType: "programming",
      suggestedPrimaryMethodId: "scaffolded_coding",
      allowedMethodIds: ["scaffolded_coding", "worked_example_fading"],
    }).allowedMethodIds).toEqual(["worked_example_fading"]);
  });

  it("keeps a Bioenergetics claim mapped to its concise ATP target", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
      StreamedSkeletonProviderOutputSchema,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const { streamedTeachingPacingContract } = await import("@/lib/session-generation/streamed-pacing");
    const { lessonIdeaMatchesTarget } = await import("@/lib/session-generation/lesson-brief");
    const target = "Energy coupling and ATP";
    const ideas = [
      "Cells couple ATP hydrolysis to energy-requiring reactions.",
      "ATP energy coupling through phosphorylation transfers energy to cellular reactants.",
    ];
    const concepts = ["ATP energy coupling", "ATP phosphorylation"];
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach how ATP couples energy-releasing reactions to cellular work before checking recall.",
      coverage: {
        focus: "Connect ATP hydrolysis to energy-requiring cellular reactions.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Explain ATP energy coupling without reopening the model",
          "Explain how phosphorylation transfers usable energy",
        ],
        evidenceMap: ideas.map((idea, index) => ({
          essentialIdea: idea,
          activityConcept: concepts[index]!,
        })),
        // Coverage alignment can conservatively preserve a concise target
        // label when the explanatory claim is longer. Current-window scoping
        // must remove that label once the target has a taught, checked claim.
        deferredContent: [target],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study one connected energy model and explain the relationship from memory.",
        why: "Producing the ATP relationship reveals whether the mechanism is understood.",
        how: ["Read the model once.", "Explain the relationship without reopening it."],
        completion: "Explain how ATP hydrolysis supports energy-requiring cellular work.",
        personalization: ["The session begins with a concrete mechanism before the question."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId: TOPIC_ID,
          methodPhase: "model",
          estimatedMinutes: 9,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the ATP coupling model",
          body: "Read the focused mechanism before explaining it from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "explain",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain ATP energy coupling",
          body: "Explain how ATP hydrolysis can support an energy-requiring cellular reaction.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: concepts[0],
          choices: [],
          correctAnswer: ideas[0],
          feedback: "Connect energy released by ATP hydrolysis to the energy-requiring cellular work.",
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "transfer",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Apply",
          title: "Explain ATP phosphorylation",
          body: "Explain how ATP can transfer usable energy by phosphorylating a cellular reactant.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "independent_transfer",
          misconceptionSummary: null,
          type: "free_response",
          concept: concepts[1],
          choices: [],
          correctAnswer: ideas[1],
          feedback: "Connect phosphate transfer to the reactant's changed energy and reactivity.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check ATP coupling later",
          body: "YOVA will bring this relationship back after a delay.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: [target],
      estimatedMinutes: 25,
      learnerDirection: null,
      targetAssignments: ideas.map((essentialIdea) => ({
        essentialIdea,
        targetId: "target_1" as const,
      })),
    });
    expect(scoped.coverage.essentialIdeas).toEqual(ideas);
    expect(scoped.coverage.deferredContent).toEqual([]);

    const providerOutput = StreamedSkeletonProviderOutputSchema.parse({
      ...draft,
      targetAssignments: ideas.map((essentialIdea) => ({ essentialIdea, targetId: "target_1" })),
    });
    const cacheableDraft = StreamedGeneratedSessionDraftOutputSchema.parse(providerOutput);
    expect(providerOutput.targetAssignments).toHaveLength(2);
    expect("targetAssignments" in cacheableDraft).toBe(false);

    const deferredNeighbor = "Energy coupling and ATP during long-term exercise";
    const longActiveIdea = "Cells use ATP hydrolysis to transfer energy into reactions that require cellular work.";
    expect(lessonIdeaMatchesTarget(longActiveIdea, target)).toBe(false);
    const sharedParentDraft = StreamedGeneratedSessionDraftSchema.parse({
      ...draft,
      coverage: {
        ...draft.coverage,
        essentialIdeas: [longActiveIdea],
        completionEvidence: [draft.coverage.completionEvidence[0]!],
        evidenceMap: [{
          essentialIdea: longActiveIdea,
          activityConcept: concepts[0]!,
        }],
        deferredContent: [deferredNeighbor],
      },
      activities: [
        {
          ...draft.activities[0]!,
          estimatedMinutes: 5,
          lessonBrief: {
            ...draft.activities[0]!.lessonBrief!,
            essentialIdeas: [longActiveIdea],
          },
        },
        {
          ...draft.activities[1]!,
          correctAnswer: longActiveIdea,
        },
        draft.activities[3]!,
      ],
    });
    const shortened = scopeStreamedSkeletonToCurrentWindow({
      draft: sharedParentDraft,
      plannedTargets: [target, deferredNeighbor],
      estimatedMinutes: 15,
      learnerDirection: null,
      pacingContract: streamedTeachingPacingContract({
        availableMinutes: 15,
        activeIdeaCount: 2,
        maximumActiveIdeas: 1,
      }),
      targetAssignments: [{ essentialIdea: longActiveIdea, targetId: "target_1" }],
    });
    expect(shortened.coverage.essentialIdeas).toEqual([longActiveIdea]);
    expect(shortened.coverage.deferredContent).toContain(deferredNeighbor);

    const contaminatedIdea = "ATP and energy coupling during long-term exercise changes how cells supply usable energy.";
    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: StreamedGeneratedSessionDraftSchema.parse({
        ...sharedParentDraft,
        coverage: {
          ...sharedParentDraft.coverage,
          essentialIdeas: [contaminatedIdea],
          evidenceMap: [{
            essentialIdea: contaminatedIdea,
            activityConcept: concepts[0]!,
          }],
        },
        activities: sharedParentDraft.activities.map((activity) => (
          activity.type === "instruction" && activity.lessonBrief
            ? {
                ...activity,
                lessonBrief: { ...activity.lessonBrief, essentialIdeas: [contaminatedIdea] },
              }
            : activity.type === "free_response"
              ? { ...activity, correctAnswer: contaminatedIdea }
              : activity
        )),
      }),
      plannedTargets: [target, deferredNeighbor],
      estimatedMinutes: 15,
      learnerDirection: null,
      pacingContract: streamedTeachingPacingContract({
        availableMinutes: 15,
        activeIdeaCount: 2,
        maximumActiveIdeas: 1,
      }),
      targetAssignments: [{ essentialIdea: contaminatedIdea, targetId: "target_1" }],
    })).toThrow(/deferred(?:-session substance| content remained)/i);
  });

  it("defines the 15-minute World War I window before generation", async () => {
    const {
      buildStreamedCurrentSessionScope,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const plannedTargets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];

    expect(buildStreamedCurrentSessionScope({
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis first and leave later-war topics for later sessions.",
    })).toEqual({
      activeTargets: plannedTargets.slice(0, 2),
      deferredTargets: plannedTargets.slice(2),
    });
  });

  it("uses stable target ids for a legitimate WWI paraphrase that strict prose matching cannot identify", async () => {
    const {
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      lessonIdeaMatchesTarget,
    } = await import("@/lib/session-generation/lesson-brief");
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "Before 1914, European alliances divided powers into rival armed blocs whose commitments increased the danger that a regional dispute would spread among major states.",
      "The Sarajevo assassination triggered a sequence that turned a local crisis into declarations of war.",
      "Basic chronology from 1914 to 1918 runs from the outbreak through U.S. entry to the armistice.",
    ];
    expect(lessonIdeaMatchesTarget(ideas[0]!, targets[0]!)).toBe(false);

    const resolved = validateStreamedTargetAssignments({
      essentialIdeas: ideas,
      targetAssignments: ideas.map((essentialIdea, index) => ({
        essentialIdea,
        targetId: `target_${index + 1}` as "target_1" | "target_2" | "target_3",
      })),
      currentSessionScope: { activeTargets: targets, deferredTargets: [] },
    });

    expect(resolved.map((assignment) => assignment.target)).toEqual(targets);
  });

  it("rejects missing, inactive, and unrelated stable target assignments", async () => {
    const {
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "European alliances divided major powers into rival blocs before 1914.",
      "Rival European alliances made a local diplomatic crisis harder to contain.",
      "Basic chronology from 1914 to 1918 runs from the outbreak through the armistice.",
    ];
    const scope = { activeTargets: targets, deferredTargets: [] };

    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: ideas,
      targetAssignments: ideas.slice(0, 2).map((essentialIdea) => ({
        essentialIdea,
        targetId: "target_1",
      })),
      currentSessionScope: scope,
    })).toThrow(/exactly one stable target assignment/i);

    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [ideas[0]!],
      targetAssignments: [{ essentialIdea: ideas[0]!, targetId: "target_4" }],
      currentSessionScope: {
        activeTargets: [targets[0]!],
        deferredTargets: targets.slice(1),
      },
    })).toThrow(/target id target_4 is not active/i);

    const unrelatedIdea = "European photosynthesis research captures light energy and stores it in chemical bonds.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [unrelatedIdea],
      targetAssignments: [{ essentialIdea: unrelatedIdea, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [targets[0]!],
        deferredTargets: targets.slice(1),
      },
    })).toThrow(/does not preserve that target's subject terms/i);

    const boundedPhotosynthesisIdea = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [boundedPhotosynthesisIdea],
      targetAssignments: [{ essentialIdea: boundedPhotosynthesisIdea, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Photosynthesis"], deferredTargets: [] },
    })).toHaveLength(1);

    const broadPhotosynthesisSurvey = "Photosynthesis and cellular respiration exchange gases while ecosystems recycle matter and energy.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [broadPhotosynthesisSurvey],
      targetAssignments: [{ essentialIdea: broadPhotosynthesisSurvey, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Photosynthesis"], deferredTargets: [] },
    })).toThrow(/does not preserve that target's subject terms/i);

    const lightTarget = "Light reactions of photosynthesis";
    const lightParaphrase = "In photosynthesis, light-absorbing pigments transfer excited electrons through carriers to make ATP and NADPH.";
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [lightParaphrase],
      targetAssignments: [{ essentialIdea: lightParaphrase, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toHaveLength(1);

    const calvinLeak = "Photosynthesis light enables the Calvin cycle.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [calvinLeak],
      targetAssignments: [{ essentialIdea: calvinLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toThrow(/deferred-session substance/i);

    const singleDistinctiveCalvinLeak = "Light reactions supply energy to the Calvin process.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [singleDistinctiveCalvinLeak],
      targetAssignments: [{ essentialIdea: singleDistinctiveCalvinLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toThrow(/deferred-session substance/i);

    const timeBoundaryLeak = "European alliances before and after the war shaped military commitments.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [timeBoundaryLeak],
      targetAssignments: [{ essentialIdea: timeBoundaryLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: ["European alliances before the war"],
        deferredTargets: ["European alliances after the war"],
      },
    })).toThrow(/deferred-session substance/i);
  });

  it("accepts an output-valid typed knowledge check before strict final parsing", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const target = "Prewar European alliances and tensions";
    const idea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const concept = "Prewar alliance pressure";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [idea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const outputParsed = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Teach one bounded prewar relationship and require the learner to explain it from memory.",
      coverage: {
        focus: "Explain why prewar alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [idea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: idea, activityConcept: concept }],
        deferredContent: ["Basic chronology from 1914 to 1918"],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Producing the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested the July Crisis first, so later chronology remains deferred."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 8,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before explaining the active relationship from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the prewar pressure",
          body: "Explain how prewar alliances made the July Crisis more likely to widen across Europe.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept,
          choices: [],
          correctAnswer: "Alliance commitments connected several powers, so a local crisis could draw in multiple states.",
          feedback: "Connect the existing alliance commitments directly to the risk that a local crisis would widen.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check this relationship again",
          body: "YOVA will bring this relationship back later for a short retrieval check without reopening the lesson.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(outputParsed.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(outputParsed.activities.some((activity) => activity.type === "free_response")).toBe(true);

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft: outputParsed,
      plannedTargets: [target],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });

    expect(scoped.activities.filter((activity) => activity.type === "free_response")).toHaveLength(1);
    expect(scoped.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();

    const secondTarget = "Sequence from the Sarajevo assassination to declarations of war";
    const secondIdea = "The Sarajevo assassination triggered a crisis that escalated into declarations of war.";
    const secondConcept = "Sarajevo escalation sequence";
    const multiBlockDraft = StreamedGeneratedSessionDraftOutputSchema.parse({
      ...outputParsed,
      coverage: {
        ...outputParsed.coverage,
        essentialIdeas: [idea, secondIdea],
        completionEvidence: [
          ...outputParsed.coverage.completionEvidence,
          "Explain how the assassination escalated into declarations of war",
        ],
        evidenceMap: [
          ...outputParsed.coverage.evidenceMap,
          { essentialIdea: secondIdea, activityConcept: secondConcept },
        ],
      },
      activities: [
        {
          ...outputParsed.activities[0],
          estimatedMinutes: 4,
          title: "Build the prewar pressure model",
          body: "Connect alliance pressure to the risk that a local crisis would spread.",
        },
        {
          ...outputParsed.activities[0],
          estimatedMinutes: 4,
          title: "Trace the Sarajevo escalation",
          body: "Follow the crisis from the assassination to the declarations of war.",
          lessonBrief: { ...lessonBrief, essentialIdeas: [secondIdea] },
        },
        {
          ...outputParsed.activities[1],
          estimatedMinutes: 2,
        },
        {
          ...outputParsed.activities[1],
          estimatedMinutes: 2,
          concept: secondConcept,
          title: "Explain the Sarajevo escalation",
          body: "Explain how the assassination escalated into declarations of war.",
          correctAnswer: secondIdea,
          feedback: "Connect the assassination, escalation, and declarations in order.",
        },
        outputParsed.activities[2],
      ],
    });
    const scopedMultiBlock = scopeStreamedSkeletonToCurrentWindow({
      draft: multiBlockDraft,
      plannedTargets: [target, secondTarget, "Basic chronology from 1914 to 1918"],
      estimatedMinutes: 15,
      learnerDirection: null,
    });
    const teachingSurfaces = scopedMultiBlock.activities
      .filter((activity) => activity.type === "instruction")
      .map((activity) => `${activity.title} ${activity.body}`);

    expect(teachingSurfaces).toEqual([
      `Learn ${idea} Focus on this relationship: ${idea}`,
      `Learn ${secondIdea} Focus on this relationship: ${secondIdea}`,
    ]);
    expect(new Set(teachingSurfaces).size).toBe(teachingSurfaces.length);
  });

  it("keeps a truly questionless intermediate skeleton invalid after scoping", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const idea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [idea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const outputParsed = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "This malformed provider shape has teaching but no learner knowledge-producing attempt.",
      coverage: {
        focus: "Explain why alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [idea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: idea, activityConcept: "Prewar alliance pressure" }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Producing the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested the July Crisis first."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 8,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before explaining the active relationship from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: null,
          methodPhase: "reflect",
          estimatedMinutes: 2,
          requiredForCompletion: false,
          label: "Reflect",
          title: "Notice the relationship",
          body: "Notice which alliance commitment makes the local crisis more likely to involve another power.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check this relationship again",
          body: "YOVA will bring this relationship back later for a short retrieval check without reopening the lesson.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: outputParsed,
      plannedTargets: ["Prewar European alliances and tensions"],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first.",
    })).toThrow(/did not map any required knowledge check to an active essential idea/i);
  });

  it("replaces the sole active recognition check with bounded typed recall", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const activeTarget = "Prewar European alliances and tensions";
    const activeIdea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const laterTargets = [
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const activeBody = "Which condition made a local diplomatic crisis more likely to involve several powers?";
    const activeAnswer = "Alliance commitments";
    const activeFeedback = "Alliance commitments connected several powers before the assassination triggered the immediate crisis.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [activeIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [topicId],
      rationale: "Teach only today's active relationships within the available time window.",
      coverage: {
        focus: "Explain why prewar alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [activeIdea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: activeIdea, activityConcept: "Prewar alliance pressure" }],
        deferredContent: laterTargets,
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Explaining the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested a bounded opening focus; remaining plan content stays scheduled."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 8,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before completing the active check that follows.",
          lessonBrief,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: "Prewar alliance pressure",
          label: "Check",
          title: "Identify the prewar pressure",
          body: activeBody,
          choices: [activeAnswer, "A completed peace treaty", "A neutral trade agreement"],
          correctAnswer: activeAnswer,
          feedback: activeFeedback,
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "free_response",
          concept: "Later-war chronology",
          label: "Explain",
          title: "Explain the later-war chronology",
          body: "Explain how U.S. entry in 1917 relates to the armistice in 1918.",
          choices: [],
          correctAnswer: "U.S. entry strengthened the Allies before the 1918 armistice ended the fighting.",
          feedback: "Connect U.S. entry to the later Allied position and the armistice.",
        },
        {
          ...activityBase,
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          type: "reflection",
          concept: null,
          label: "Return",
          title: "Check the prewar relationship later",
          body: "YOVA will bring the active relationship back after a delay for a short retrieval check.",
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: [activeTarget, ...laterTargets],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    const retainedChecks = scoped.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    ));

    expect(retainedChecks).toHaveLength(1);
    expect(retainedChecks[0]).toMatchObject({
      type: "free_response",
      methodPhase: "guided_practice",
      concept: "Prewar alliance pressure",
      choices: [],
      estimatedMinutes: 3,
    });
    expect(retainedChecks[0]?.body).toBe(
      "Without notes, explain Prewar alliance pressure in one or two sentences.",
    );
    expect(retainedChecks[0]?.correctAnswer).toContain(activeIdea);
    expect(retainedChecks[0]?.feedback).toContain(activeIdea);
    expect(retainedChecks[0]?.feedback).not.toBe(activeFeedback);
    expect(retainedChecks.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(scoped.activities
      .filter((activity) => activity.requiredForCompletion)
      .reduce((total, activity) => total + activity.estimatedMinutes, 0))
      .toBeLessThanOrEqual(15);
    expect(scoped.coverage.essentialIdeas).toEqual([activeIdea]);
    expect(scoped.coverage.deferredContent).toEqual(expect.arrayContaining(laterTargets));
    expect(JSON.stringify(scoped.activities)).not.toMatch(/U\.S\. entry|later-war chronology|armistice in 1918/i);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();

    const scopedAgain = scopeStreamedSkeletonToCurrentWindow({
      draft: scoped,
      plannedTargets: [activeTarget, ...laterTargets],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    expect(scopedAgain.activities).toEqual(scoped.activities);
  });

  it("keeps a shortened World War I lesson inside 15 minutes without losing later plan targets", async () => {
    const {
      coverageTargetsMatch,
      validateSessionCoverageFidelity,
    } = await import("@/lib/openai/session-generator");
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      enrichStreamedLessonBriefs,
      validateStreamedLessonScope,
    } = await import("@/lib/session-generation/lesson-brief");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      buildStatedPreferenceLessonDelivery,
    } = await import("@/lib/personalization/session-delivery-policy");
    const {
      buildSessionEvaluationCases,
    } = await import("@/evals/session-cases");

    const learnerDirection = "Teach the July Crisis cause chain first. Keep this session within 15 minutes and leave later-war topics for later sessions.";
    const evaluationCase = buildSessionEvaluationCases().find((candidate) => (
      candidate.id === "world_war_one_mapped_45_min"
    ));
    expect(evaluationCase).toBeDefined();
    const originalContext = evaluationCase!.context;
    const adjustedContext: SessionGenerationContext = {
      ...originalContext,
      session: {
        ...originalContext.session,
        estimatedMinutes: 15,
      },
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 15,
        knownTargets: [],
        note: learnerDirection,
      },
    };
    const topicId = adjustedContext.session.topicIds[0]!;
    const plannedTargets = adjustedContext.session.contentTargets ?? [];
    expect(plannedTargets).toEqual([
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ]);
    // Put the later chronology first to reproduce the provider ordering that
    // previously overrode the learner's explicit July-Crisis-first direction.
    const ideas = [
      "World War I moved through a basic chronology from 1914 to the 1918 armistice",
      "Prewar alliance tensions made the July Crisis easier to widen",
      "The Sarajevo assassination triggered alliance commitments, mobilization, and declarations of war",
    ];
    const concepts = ["1914 to 1918 chronology", "Prewar alliance tensions", "July Crisis sequence"];
    expect(coverageTargetsMatch(ideas[0]!, learnerDirection)).toBe(false);
    expect(coverageTargetsMatch(ideas[1]!, learnerDirection)).toBe(true);
    expect(coverageTargetsMatch(ideas[2]!, learnerDirection)).toBe(false);
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [topicId],
      rationale: "Teach only today's bounded causal chain within the available time window.",
      coverage: {
        focus: "Build the prewar pressure and opening July Crisis cause chain.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Identify how prewar alliances increased escalation risk",
          "Explain the sequence from Sarajevo through declarations of war",
          "Place the major war years in chronological order",
        ],
        evidenceMap: ideas.map((essentialIdea, index) => ({
          essentialIdea,
          activityConcept: concepts[index]!,
        })),
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain why each event led to the next.",
        why: "Reconstructing the bounded causal chain checks current understanding.",
        how: ["Study the short model once.", "Explain the causal chain without reopening it."],
        completion: "Identify the escalation mechanism and explain the July Crisis sequence without notes.",
        personalization: ["The learner requested a bounded opening focus; remaining plan content stays scheduled."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 8,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the July Crisis cause chain",
          body: "Study the bounded opening-war model before answering the two checks that follow.",
          lessonBrief,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: concepts[1],
          label: "Check",
          title: "Identify the prewar pressure",
          body: "Which condition made a local diplomatic crisis more likely to involve several powers?",
          choices: ["Alliance commitments", "A completed peace treaty", "The 1918 armistice"],
          correctAnswer: "Alliance commitments",
          feedback: "Alliance commitments connected several powers before the assassination triggered the immediate crisis.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          estimatedMinutes: 3,
          type: "free_response",
          concept: concepts[2],
          label: "Explain",
          title: "Explain the July Crisis sequence",
          body: "Explain how the Sarajevo assassination led through alliance commitments and mobilization to declarations of war.",
          choices: [],
          correctAnswer: "The assassination triggered an ultimatum and alliance commitments, while mobilization escalated the crisis into declarations of war.",
          feedback: "A complete explanation connects the assassination, alliance commitments, mobilization, and declarations of war in order.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "multiple_choice",
          concept: concepts[0],
          label: "Later",
          title: "Check the later-war chronology",
          body: "Which event marked the end of fighting in 1918?",
          choices: ["The armistice", "The Sarajevo assassination", "The July ultimatum"],
          correctAnswer: "The armistice",
          feedback: "The November 1918 armistice ended the fighting and belongs in a later-war session.",
        },
      ],
    });

    // This is the exact paid-evaluation regression: the provider emitted only
    // whole-war chronology, even though today's authoritative 15-minute scope
    // is the prewar pressure and July Crisis sequence. Never accept it as the
    // active lesson. The repair attempt must receive both exact lists.
    const chronologyOnlyDraft = {
      ...draft,
      coverage: {
        ...draft.coverage,
        essentialIdeas: [ideas[0]!],
        completionEvidence: ["Place the major war years in chronological order"],
        evidenceMap: [{
          essentialIdea: ideas[0]!,
          activityConcept: concepts[0]!,
        }],
        deferredContent: [],
      },
      activities: draft.activities.filter((activity) => (
        activity.type === "instruction" || activity.concept === concepts[0]
      )),
    };

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: chronologyOnlyDraft,
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection,
    })).toThrow(new RegExp(
      "Active targets that must be taught and checked now:.*Prewar European alliances and tensions.*Sequence from the Sarajevo assassination to declarations of war.*Later targets that must remain exact entries in deferredContent:.*Basic chronology from 1914 to 1918",
      "i",
    ));

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection,
    });
    const delivery = buildStatedPreferenceLessonDelivery({
      learnerProfile: null,
      estimatedMinutes: 15,
      taskType: "conceptual_learning",
    });
    const finalized = enrichStreamedLessonBriefs(scoped, {
      sessionTopicIds: [topicId],
      materials: [],
      knowledgeTopics: adjustedContext.knowledgeTopics,
      conceptSignals: [],
      taskType: "conceptual_learning",
      deliveryInstructions: delivery.instructions,
    });
    const session = {
      ...adjustedContext.session,
      completionEvidence: adjustedContext.session.completionEvidence,
    };

    expect(finalized.coverage.essentialIdeas).toHaveLength(2);
    expect(finalized.coverage.essentialIdeas.join(" ")).toMatch(/Sarajevo|July Crisis/i);
    expect(finalized.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    )).length).toBeLessThanOrEqual(2);
    expect(finalized.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(finalized.activities.some((activity) => activity.type === "free_response")).toBe(true);
    expect(finalized.activities
      .filter((activity) => activity.requiredForCompletion)
      .reduce((total, activity) => total + activity.estimatedMinutes, 0))
      .toBeLessThanOrEqual(15);
    for (const target of plannedTargets) {
      expect([
        ...finalized.coverage.essentialIdeas,
        ...finalized.coverage.deferredContent,
      ].some((item) => coverageTargetsMatch(item, target))).toBe(true);
    }
    expect(finalized.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
    expect(finalized.coverage.completionEvidence.join(" ")).not.toMatch(/1914 to 1918|later-war|armistice/i);
    expect(JSON.stringify(finalized.activities)).not.toMatch(/later-war chronology|1914 to 1918 chronology|end of fighting in 1918/i);
    expect(validateSessionCoverageFidelity(finalized, session)).toBeNull();
    expect(validateStreamedLessonScope(finalized, {
      sessionTopicIds: [topicId],
      sessionObjective: session.objective,
      sessionContentTargets: plannedTargets,
      sessionEstimatedMinutes: 15,
      learnerDirection,
    })).toBeNull();
  });

  it("canonicalizes deferred World War I facts out of metadata, choices, and the scheduled return", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      validateSessionCompletionContract,
    } = await import("@/lib/session-generation/completion-contract");
    const {
      validateStreamedLessonScope,
    } = await import("@/lib/session-generation/lesson-brief");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "Prewar European alliances and tensions made a local crisis more dangerous.",
      "The Sarajevo assassination triggered mobilization and declarations of war.",
      "U.S. entry in 1917 preceded the 1918 armistice in the full World War I chronology.",
    ];
    const concepts = ["Prewar escalation pressure", "July Crisis sequence", "Later-war chronology"];
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Survey the full chronology through U.S. entry and the 1918 armistice before checking the whole war.",
      coverage: {
        focus: "Explain the prewar pressure, U.S. entry, and the 1918 armistice in one whole-war chronology.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Explain prewar escalation pressure without notes",
          "Explain the July Crisis sequence, then add one 1914 to 1918 landmark from memory",
        ],
        evidenceMap: ideas.map((essentialIdea, index) => ({
          essentialIdea,
          activityConcept: concepts[index]!,
        })),
        deferredContent: [targets[2]],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Whole-war self-explanation",
        what: "Study the full World War I chronology through U.S. entry and the armistice.",
        why: "Explaining the later-war chronology checks understanding of U.S. entry and the armistice.",
        how: ["Review U.S. entry in 1917.", "Explain how the 1918 armistice ended the later war."],
        completion: "Explain U.S. entry, the armistice, and the full 1914 to 1918 chronology.",
        personalization: ["The session surveys U.S. entry and the armistice before returning to the July Crisis."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 7,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the World War I opening map",
          body: "Study the bounded opening-war model before answering the two checks that follow.",
          lessonBrief,
          practiceIntent: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: concepts[0],
          label: "Check",
          title: "Identify the prewar pressure",
          body: "Which condition made a local crisis more likely to involve several powers?",
          choices: ["Imperial competition", "Armistice", "Sarajevo assassination", "Mobilization"],
          correctAnswer: "Imperial competition",
          feedback: "Competition and alliance commitments increased pressure before the immediate crisis.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "multiple_choice",
          concept: concepts[1],
          label: "Check",
          title: "Identify the immediate trigger",
          body: "Which event triggered the July Crisis?",
          choices: ["Sarajevo assassination", "U.S. entry", "Armistice", "Ultimatum crisis"],
          correctAnswer: "Sarajevo assassination",
          feedback: "The assassination triggered the ultimatum crisis and the escalation that followed.",
        },
        {
          ...activityBase,
          methodPhase: "independent_practice",
          type: "multiple_choice",
          concept: concepts[2],
          label: "Later",
          title: "Identify the later-war ending",
          body: "Which event ended the fighting in 1918 after U.S. entry?",
          choices: ["The armistice", "The Battle of the Somme", "The Treaty of Brest-Litovsk"],
          correctAnswer: "The armistice",
          feedback: "The 1918 armistice ended the fighting after U.S. entry in 1917.",
        },
        {
          ...activityBase,
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          type: "reflection",
          concept: null,
          label: "Return",
          title: "Return to the timeline",
          body: "Then add one 1914 to 1918 landmark from memory.",
          practiceIntent: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: targets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    const activeSurface = JSON.stringify({
      activities: scoped.activities,
      completionEvidence: scoped.coverage.completionEvidence,
    });

    expect(scoped.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    )).every((activity) => activity.type === "free_response")).toBe(true);
    expect(activeSurface).not.toMatch(/U\.S\. entry|armistice|1914 to 1918 landmark/i);
    expect(scoped.activities.find((activity) => activity.methodPhase === "schedule_return")?.body)
      .toBe("YOVA will bring today's active ideas back after a delay for a short retrieval check.");
    expect(scoped.coverage.completionEvidence).toEqual([
      "Demonstrate Prewar escalation pressure",
      "Demonstrate July Crisis sequence",
    ]);
    expect(scoped.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
    expect(scoped.rationale).toContain("Prewar European alliances and tensions");
    expect(scoped.rationale).toContain("Sequence from the Sarajevo assassination to declarations of war");
    expect(scoped.rationale).toContain("Later plan topics remain deferred");
    expect(scoped.methodBriefing.name).toBe("Self-explanation");
    expect(JSON.stringify({
      rationale: scoped.rationale,
      focus: scoped.coverage.focus,
      methodBriefing: scoped.methodBriefing,
    })).not.toMatch(/U\.S\. entry|armistice|full (?:World War I|1914 to 1918) chronology/i);
    expect(validateSessionCompletionContract({
      essentialIdeas: scoped.coverage.essentialIdeas,
      evidenceMap: scoped.coverage.evidenceMap,
      activities: scoped.activities,
    })).toBeNull();
    expect(validateStreamedLessonScope(scoped, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliances and mobilization widened the July Crisis.",
      sessionContentTargets: targets,
      sessionEstimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis first and leave later-war topics for later sessions.",
    })).toBeNull();
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();
  });

  it("rejects an active idea contaminated by facts fingerprinted from removed content", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const contaminatedActiveIdea = "Prewar alliances and tensions shaped U.S. entry and the armistice.";
    const removedDeferredIdea = "U.S. entry in 1917 preceded the 1918 armistice in the later war.";
    const activeConcept = "Prewar escalation pressure";
    const deferredConcept = "Later-war turning points";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [contaminatedActiveIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const draft = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Teach and check only the bounded current-session relationship.",
      coverage: {
        focus: "Explain the prewar escalation pressure.",
        essentialIdeas: [contaminatedActiveIdea, removedDeferredIdea],
        completionEvidence: ["Explain prewar escalation pressure"],
        evidenceMap: [
          { essentialIdea: contaminatedActiveIdea, activityConcept: activeConcept },
          { essentialIdea: removedDeferredIdea, activityConcept: deferredConcept },
        ],
        deferredContent: [targets[2]],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study one bounded relationship and explain it without notes.",
        why: "Producing the relationship makes current understanding visible.",
        how: ["Study the short model once.", "Explain the active relationship from memory."],
        completion: "Explain the active relationship accurately without notes.",
        personalization: ["The session keeps the current work bounded to the available time."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the active relationship",
          body: "Study the bounded explanation before completing the active check.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the prewar pressure",
          body: "Explain the active relationship from memory in one or two sentences.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: activeConcept,
          choices: [],
          correctAnswer: contaminatedActiveIdea,
          feedback: `Connect your response to this relationship: ${contaminatedActiveIdea}`,
        },
        {
          topicId,
          methodPhase: "independent_practice",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          label: "Check",
          title: "Explain the later turning points",
          body: "Explain how entry in 1917 relates to the end of fighting in 1918.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "independent_transfer",
          misconceptionSummary: null,
          type: "free_response",
          concept: deferredConcept,
          choices: [],
          correctAnswer: removedDeferredIdea,
          feedback: "Connect the 1917 entry to the later end of fighting in 1918.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check today's idea later",
          body: "YOVA will bring today's active relationship back after a delay.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: targets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the opening cause chain first and keep later content for later sessions.",
    })).toThrow(/deferred content remained in active essential idea 1/i);
  });
});

describe("streamed free-response reference-answer repair", () => {
  it("replaces a grading rubric with the mapped World War I subject answer", async () => {
    const { repairRubricLikeFreeResponseAnswers } = await import("@/lib/openai/streamed-teaching-generator");
    const activities = [{
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Explain",
      title: "Explain the outbreak in your own words",
      body: "Explain how a local crisis widened into a European war.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept: "World War I outbreak chain",
      choices: [],
      correctAnswer: "A strong response should mention the assassination, alliances, mobilization, and declarations of war.",
      feedback: "Connect the Sarajevo assassination to alliance commitments and mobilization.",
    }];

    const repaired = repairRubricLikeFreeResponseAnswers({
      activities,
      evidenceMap: [{
        activityConcept: "World War I outbreak chain",
        essentialIdea: "The assassination of Franz Ferdinand triggered alliance commitments and mobilization, widening the conflict",
      }],
    });

    expect(repaired.repairedCount).toBe(1);
    expect(repaired.activities[0]?.correctAnswer).toBe(
      "The assassination of Franz Ferdinand triggered alliance commitments and mobilization, widening the conflict.",
    );
  });

  it("turns a mapped subject phrase into a concrete answer without relaxing validation", async () => {
    const { repairRubricLikeFreeResponseAnswers } = await import("@/lib/openai/streamed-teaching-generator");
    const activities = [{
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Explain",
      title: "Explain the outbreak in your own words",
      body: "Explain how a local crisis widened into a European war.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept: "World War I outbreak chain",
      choices: [],
      correctAnswer: "The learner should name the relevant events in order.",
      feedback: "Connect the Sarajevo assassination to alliance commitments and mobilization.",
    }];

    const repaired = repairRubricLikeFreeResponseAnswers({
      activities,
      evidenceMap: [{
        activityConcept: "World War I outbreak chain",
        essentialIdea: "Sequence from the Sarajevo assassination through alliance commitments to declarations of war",
      }],
    });

    expect(repaired.activities[0]?.correctAnswer).toBe(
      "For World War I outbreak chain, the key idea is sequence from the Sarajevo assassination through alliance commitments to declarations of war.",
    );
  });
});

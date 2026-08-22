import { describe, expect, it } from "vitest";
import { readSessionResourceFromStepData, toSessionResource } from "@/lib/session-generation/resource";
import {
  CachedGeneratedSessionV16Schema,
  CachedGeneratedSessionV17Schema,
  GeneratedSessionDraftSchema,
  type SessionGenerationResponse,
} from "@/lib/session-generation/schema";

const generatedSession: SessionGenerationResponse["session"] = {
  topicIds: ["11111111-1111-4111-8111-111111111111"],
  schemaVersion: 15,
  model: "gpt-test",
  generatedAt: "2026-08-05T18:00:00.000Z",
  routingContext: {
    taskType: "conceptual_learning",
    knowledgeStage: "novice",
  },
  rationale: "This sequence teaches the core idea before checking recall and application.",
  coverage: {
    focus: "Understand and retrieve the purpose of retrieval practice.",
    essentialIdeas: ["Retrieval happens before answer review"],
    completionEvidence: ["Explain the purpose of attempting an answer from memory"],
    evidenceMap: [{
      essentialIdea: "Retrieval happens before answer review",
      activityConcept: "Retrieval practice",
    }],
    deferredContent: [],
  },
  sourceGrounding: null,
  methodBriefing: {
    learningMode: "learn",
    taskType: "conceptual_learning",
    methodId: "retrieval_practice",
    name: "Retrieval practice",
    what: "Produce an answer from memory before looking at the explanation.",
    why: "This creates objective evidence of what is available without support before the learner reviews the idea.",
    how: ["Hide the explanation and attempt the answer.", "Compare, repair the gap, and retry it later."],
    completion: "The answer has been attempted from memory and every missing idea has been marked for review.",
    personalization: ["You asked for concrete examples before rules, so the session begins with one complete example."],
  },
  deliveryPolicy: {
    schemaVersion: 1,
    evidenceStatus: "starting_hypothesis",
    presentation: {
      mode: "example_first",
      label: "Example first",
      instruction: "Begin the explanation with one concrete case before naming the general rule.",
    },
    repair: {
      mode: "hint_first",
      label: "Hint first",
      instruction: "After a miss, reveal one bounded cue before showing the complete correction.",
    },
    retention: {
      mode: "retrieval",
      label: "Recall without cues",
      instruction: "Require retrieval without visible notes before answer review.",
    },
    workspace: {
      mode: "one_step",
      label: "One step at a time",
      instruction: "Keep only the current action prominent while preserving an optional path preview.",
    },
    pacing: {
      firstActionMinutes: 4,
      maximumActivities: 5,
      reason: "There is not enough repeated behavior evidence to change the normal session size.",
    },
    activityCadence: {
      mode: "task_aligned",
      label: "Task-aligned cadence",
      instruction: "Change activities only when the selected method and current objective call for it.",
    },
    attemptSafety: {
      mode: "task_aligned",
      label: "Task-aligned attempts",
      instruction: "Use the attempt and feedback format best supported by the current task.",
    },
    knowledgeCheck: {
      mode: "task_aligned",
      label: "Task-aligned check",
      instruction: "Use the knowledge check required by the selected method and current objective.",
    },
    learnerFacingReasons: ["You asked for concrete examples before rules, so YOVA will make the first explanation example-led."],
    signalsUsed: ["A concrete example before the rule"],
  },
  supportPlan: {
    level: "fading",
    title: "Support reduced for Retrieval practice",
    explanation: "The prior guided check was secure, so this session removes some help before another independent attempt.",
    evidenceLabel: "1 completed check",
    concept: "Retrieval practice",
  },
  activities: [
    {
      topicId: null,
      methodPhase: "model",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "Learn",
      title: "Build the idea",
      body: "Start with a concise explanation that connects the new idea to the learning goal.",
      teaching: {
        keyIdea: "Retrieval makes current knowledge visible before review.",
        explanation: "Trying to produce an answer first separates what is available from memory from what only feels familiar while it is visible.",
        example: null,
        commonMistake: null,
      },
      choices: [],
      correctAnswer: null,
      feedback: null,
    },
    {
      topicId: "11111111-1111-4111-8111-111111111111",
      methodPhase: "retrieve",
      practiceIntent: "misconception_discrimination",
      misconceptionSummary: "Confuses recalling an answer with rereading familiar wording.",
      estimatedMinutes: 3,
      requiredForCompletion: true,
      type: "multiple_choice",
      concept: "Retrieval practice",
      label: "Check",
      title: "Choose the best description",
      body: "Which option best describes retrieval practice in this learning sequence?",
      teaching: null,
      choices: ["Recall before reviewing", "Copy notes repeatedly", "Only reread summaries"],
      correctAnswer: "Recall before reviewing",
      feedback: "Retrieval practice asks the learner to produce an answer before checking the source.",
    },
    {
      topicId: "11111111-1111-4111-8111-111111111111",
      methodPhase: "repair",
      estimatedMinutes: 5,
      requiredForCompletion: true,
      type: "free_response",
      concept: "Retrieval practice",
      label: "Explain",
      title: "Teach it back",
      body: "Explain why recalling an answer before reviewing can reveal a useful learning gap.",
      teaching: null,
      choices: [],
      correctAnswer: "Trying first makes missing or uncertain knowledge visible before review.",
      feedback: "A strong response connects the retrieval attempt to identifying what needs repair.",
    },
  ],
};

const streamedSession = CachedGeneratedSessionV16Schema.parse({
  ...generatedSession,
  schemaVersion: 16,
  deliveryInstructions: {
    schemaVersion: 1,
    explanationDensity: "balanced",
    tone: "encouraging",
    analogyUse: "only_when_helpful",
    workedExamples: "lead_with_example",
    structure: "task_aligned",
    pacing: {
      firstActionMinutes: 4,
      maximumActivities: 5,
      instruction: "Keep the first step bounded while preserving all required lesson ideas.",
    },
    learnerContext: ["Use current evidence as a presentation guide, not as a fixed learning style."],
    contentRequirements: {
      coverAllEssentialIdeas: true,
      includeConcreteWorkedExample: true,
      includeCommonMixup: true,
      preservePrerequisiteOrder: true,
    },
  },
  activities: generatedSession.activities.map((activity, index) => ({
    ...activity,
    ...(index === 0 ? {
      topicId: "11111111-1111-4111-8111-111111111111",
      teaching: null,
      lessonBrief: {
        version: 1,
        topicIds: ["11111111-1111-4111-8111-111111111111"],
        essentialIdeas: ["Retrieval happens before answer review"],
        sourceChunks: [],
        knowledgeSource: "model_knowledge" as const,
        evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
        contentRequirements: {
          teachEveryEssentialIdea: true as const,
          includeConcreteExample: true,
          includeCommonMixup: true as const,
          preservePrerequisiteOrder: true as const,
        },
      },
    } : { lessonBrief: null }),
  })),
});
const pacedStreamedSession = CachedGeneratedSessionV17Schema.parse({
  ...streamedSession,
  schemaVersion: 17,
  cacheContext: {
    effectiveMinutes: 25,
    adjustmentFingerprint: "a".repeat(64),
    scopeFingerprint: "sc1:0123456789abcdef",
  },
});

describe("session resources", () => {
  it("turns a generated session into reusable plan content", () => {
    const resource = toSessionResource(generatedSession);
    expect(resource.origin).toBe("generated");
    expect(resource.generatedAt).toBe(generatedSession.generatedAt);
    expect(resource.methodBriefing?.methodId).toBe("retrieval_practice");
    expect(resource.supportPlan?.level).toBe("fading");
    expect(resource.routingContext).toEqual({
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
    });
    expect(resource.activities).toHaveLength(3);
    expect(resource.activities[1].correctAnswer).toBe("Recall before reviewing");
    expect(resource.activities[1]).toMatchObject({
      practiceIntent: "misconception_discrimination",
      misconceptionSummary: "Confuses recalling an answer with rereading familiar wording.",
    });
  });

  it("reads valid cached content from database step data", () => {
    expect(readSessionResourceFromStepData({ generatedSession })?.activities[2].type).toBe("free_response");
  });

  it("preserves the v16 lesson brief and delivery instructions for streamed teaching", () => {
    const resource = toSessionResource(streamedSession);

    expect(resource.deliveryInstructions?.explanationDensity).toBe("balanced");
    expect(resource.activities[0]?.topicId).toBe("11111111-1111-4111-8111-111111111111");
    expect(resource.activities[0]?.lessonBrief?.essentialIdeas).toEqual([
      "Retrieval happens before answer review",
    ]);
    expect(readSessionResourceFromStepData({ generatedSession: streamedSession })?.activities[0]?.teaching).toBeNull();
  });

  it("reads the paced v17 streamed cache while retaining v16 resume compatibility", () => {
    expect(toSessionResource(pacedStreamedSession).deliveryInstructions?.explanationDensity).toBe("balanced");
    expect(readSessionResourceFromStepData({ generatedSession: pacedStreamedSession })?.activities[0]?.lessonBrief)
      .toBeDefined();
    expect(readSessionResourceFromStepData({ generatedSession: streamedSession })?.activities[0]?.lessonBrief)
      .toBeDefined();
  });

  it("ignores missing or unsafe cached content", () => {
    expect(readSessionResourceFromStepData(null)).toBeUndefined();
    expect(readSessionResourceFromStepData({ generatedSession: { rationale: "too small" } })).toBeUndefined();
    expect(readSessionResourceFromStepData({
      generatedSession: { ...generatedSession, schemaVersion: 13 },
    })).toBeUndefined();
  });

  it("rejects a teaching-first session that hides the lesson inside an instruction paragraph", () => {
    const invalidSession = {
      ...generatedSession,
      activities: [
        {
          ...generatedSession.activities[0],
          methodPhase: "orient",
          teaching: null,
          body: "Read the lesson text placed in this generic instruction field before continuing.",
        },
        ...generatedSession.activities.slice(1),
      ],
    };

    const result = GeneratedSessionDraftSchema.safeParse(invalidSession);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "activities.0.teaching")).toBe(true);
    }
  });
});

describe("method runtimes surviving storage", () => {
  const retrievalRound = {
    kind: "retrieval_round" as const,
    sourceClosedReminder: "Close your notes before answering anything below.",
    prompts: [
      { prompt: "What does NADH carry?", expectedAnswer: "High-energy electrons", hint: null },
      { prompt: "Where does the Krebs cycle run?", expectedAnswer: "Mitochondrial matrix", hint: null },
      { prompt: "What is FADH2 for?", expectedAnswer: "Carrying electrons to complex II", hint: null },
    ],
  };

  it("keeps the method runtime when a stored session is read back", () => {
    const withRuntime: SessionGenerationResponse["session"] = {
      ...generatedSession,
      activities: generatedSession.activities.map((activity, index) => (
        index === 0 ? { ...activity, methodRuntime: retrievalRound } : activity
      )),
    };

    // A dropped runtime here would render the method correctly once and then
    // silently fall back to the generic activity path on resume.
    expect(toSessionResource(withRuntime).activities[0].methodRuntime).toEqual(retrievalRound);
  });

  it("reports no runtime for sessions generated before method runtimes existed", () => {
    expect(toSessionResource(generatedSession).activities[0].methodRuntime ?? null).toBeNull();
  });
});

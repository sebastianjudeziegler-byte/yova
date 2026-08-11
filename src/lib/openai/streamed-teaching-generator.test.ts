import { describe, expect, it, vi } from "vitest";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

vi.mock("server-only", () => ({}));

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
    const ideas = [
      "Prewar alliance tensions made the July Crisis easier to widen across Europe",
      "The Sarajevo assassination triggered alliance commitments, mobilization, and declarations of war",
      "World War I moved through a basic chronology from 1914 to the 1918 armistice",
    ];
    const concepts = ["Prewar alliance tensions", "July Crisis sequence", "1914 to 1918 chronology"];
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
      rationale: "Teach the July Crisis causal chain now and preserve later-war chronology for the remaining plan.",
      coverage: {
        focus: "Build the opening World War I cause chain before moving into later-war chronology.",
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
        why: "Reconstructing the causal chain checks understanding while keeping later-war content in later sessions.",
        how: ["Study the short model once.", "Explain the causal chain without reopening it."],
        completion: "Identify the escalation mechanism and explain the July Crisis sequence without notes.",
        personalization: ["The learner requested the July Crisis first, so later-war chronology remains deferred."],
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
          concept: concepts[0],
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
          concept: concepts[1],
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
          concept: concepts[2],
          label: "Later",
          title: "Check the later-war chronology",
          body: "Which event marked the end of fighting in 1918?",
          choices: ["The armistice", "The Sarajevo assassination", "The July ultimatum"],
          correctAnswer: "The armistice",
          feedback: "The November 1918 armistice ended the fighting and belongs in a later-war session.",
        },
      ],
    });

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
    for (const target of plannedTargets) {
      expect([
        ...finalized.coverage.essentialIdeas,
        ...finalized.coverage.deferredContent,
      ].some((item) => coverageTargetsMatch(item, target))).toBe(true);
    }
    expect(finalized.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
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

import { describe, expect, it, vi } from "vitest";
import {
  enrichStreamedLessonBriefs,
  isCompleteLessonClaim,
  lessonIdeaCapacityForMinutes,
  validateStreamedLessonScope,
} from "@/lib/session-generation/lesson-brief";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const topicId = "11111111-1111-4111-8111-111111111111";
const chunkId = "22222222-2222-4222-8222-222222222222";
const materialId = "33333333-3333-4333-8333-333333333333";

function streamedDraft() {
  return StreamedGeneratedSessionDraftSchema.parse({
    topicIds: [topicId],
    rationale: "Teach the causal model first, then require the learner to explain and identify it without support.",
    coverage: {
      focus: "Understand how alliance obligations widened the July Crisis.",
      essentialIdeas: ["Alliance obligations connected a local crisis to wider mobilization"],
      completionEvidence: ["Explain how alliance obligations widened the conflict"],
      evidenceMap: [{
        essentialIdea: "Alliance obligations connected a local crisis to wider mobilization",
        activityConcept: "Alliance escalation",
      }],
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "self_explanation",
      name: "Self-explanation",
      what: "Study an accurate causal model and then reconstruct why its steps connect.",
      why: "Explaining the relationship after seeing the model checks understanding instead of familiarity with visible wording.",
      how: ["Study the model once.", "Close it and explain the causal connection."],
      completion: "Explain the causal link and identify the central mechanism without reopening the lesson.",
      personalization: ["YOVA keeps the model concise while preserving every required causal idea."],
    },
    sourceGrounding: null,
    activities: [
      {
        topicId,
        methodPhase: "model",
        estimatedMinutes: 4,
        requiredForCompletion: true,
        type: "instruction",
        concept: null,
        label: "Learn",
        title: "Build the escalation model",
        body: "Study the causal model, then continue when the relationship is clear enough to explain.",
        teaching: null,
        lessonBrief: {
          version: 1,
          topicIds: [topicId],
          essentialIdeas: ["Alliance obligations connected a local crisis to wider mobilization"],
          sourceChunks: [],
          knowledgeSource: "model_knowledge",
          evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
          contentRequirements: {
            teachEveryEssentialIdea: true,
            includeConcreteExample: true,
            includeCommonMixup: true,
            preservePrerequisiteOrder: true,
          },
        },
        choices: [],
        correctAnswer: null,
        feedback: null,
      },
      {
        topicId,
        methodPhase: "explain",
        estimatedMinutes: 4,
        requiredForCompletion: true,
        type: "free_response",
        concept: "Alliance escalation",
        label: "Explain",
        title: "Explain the widening conflict",
        body: "Explain how alliance obligations helped turn the local crisis into a wider conflict.",
        teaching: null,
        lessonBrief: null,
        choices: [],
        correctAnswer: "Alliance obligations pulled additional states into mobilization and declarations after the local crisis escalated.",
        feedback: "A complete answer connects alliance commitments to mobilization and the entry of additional states into the conflict.",
      },
      {
        topicId,
        methodPhase: "explain",
        estimatedMinutes: 2,
        requiredForCompletion: true,
        type: "multiple_choice",
        concept: "Alliance escalation",
        label: "Check",
        title: "Identify the central mechanism",
        body: "Which mechanism most directly widened the conflict beyond the original dispute?",
        teaching: null,
        lessonBrief: null,
        choices: ["Alliance commitments and mobilization", "A single isolated battle", "The invention of tanks"],
        correctAnswer: "Alliance commitments and mobilization",
        feedback: "Alliance commitments linked states together, while mobilization made the crisis harder to contain.",
      },
    ],
  });
}

describe("authoritative streamed lesson briefs", () => {
  it("uses retrieved topic chunks and only persisted evidence for learner context", () => {
    const result = enrichStreamedLessonBriefs(streamedDraft(), {
      sessionTopicIds: [topicId],
      materials: [{
        materialId,
        chunkId,
        name: "World War I study guide",
        text: "Alliances and mobilization widened the July Crisis after the assassination.",
        truncated: false,
        locationLabel: "Page 2",
        role: "scope_outline",
      }],
      knowledgeTopics: [{
        id: topicId,
        title: "Alliance escalation",
        description: "How alliance commitments and mobilization widened a local crisis.",
        subtopics: [],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: { source: "placement_check", outcome: "gap", observedAt: "2026-08-09T12:00:00.000Z" },
        sourceReferences: [],
        origin: "material",
        deferred: null,
        curriculumReference: null,
      }],
      conceptSignals: [{
        topicId,
        concept: "Alliance escalation",
        attempts: 1,
        secureAttempts: 0,
        needsReviewAttempts: 1,
        lastOutcome: "needs_review",
        lastObservedAt: "2026-08-09T12:00:00.000Z",
        status: "needs_review",
        misconceptionSummary: "The learner treated alliance membership as automatic war without accounting for mobilization decisions.",
      }],
      taskType: "conceptual_learning",
      deliveryInstructions: {
        schemaVersion: 1,
        explanationDensity: "balanced",
        tone: "encouraging",
        analogyUse: "only_when_helpful",
        workedExamples: "lead_with_example",
        structure: "overview_first",
        pacing: { firstActionMinutes: 3, maximumActivities: 5, instruction: "Begin with a short model while preserving all required ideas." },
        learnerContext: ["Use the learner's demonstrated gap to focus the explanation without assigning a fixed type."],
        contentRequirements: { coverAllEssentialIdeas: true, includeConcreteWorkedExample: true, includeCommonMixup: true, preservePrerequisiteOrder: true },
      },
    });

    const brief = result.activities[0]?.lessonBrief;
    expect(brief?.knowledgeSource).toBe("scope_defined_model_instruction");
    expect(brief?.sourceChunks[0]).toMatchObject({ chunkId, role: "scope_outline", locationLabel: "Page 2" });
    expect(brief?.evidenceContext.confirmedGaps).toHaveLength(1);
    expect(brief?.evidenceContext.priorMisconceptions[0]?.misconception).toContain("mobilization decisions");
  });

  it("defers WWI ideas that no longer fit after the opening explanation is shortened", () => {
    const draft = streamedDraft();
    const overflowIdea = "The Sarajevo assassination triggered the July Crisis, which led to declarations of war";
    draft.coverage.essentialIdeas.push(overflowIdea);
    draft.coverage.evidenceMap.push({
      essentialIdea: overflowIdea,
      activityConcept: "Alliance escalation",
    });
    const teachingActivity = draft.activities[0];
    if (!teachingActivity || teachingActivity.type !== "instruction" || !teachingActivity.lessonBrief) {
      throw new Error("The fixture needs a teaching brief.");
    }
    // The model originally budgeted two ideas for this block. Final pacing
    // reduced it to five minutes, where one idea is the honest capacity.
    teachingActivity.estimatedMinutes = 5;
    teachingActivity.lessonBrief.essentialIdeas = [
      "Alliance obligations connected a local crisis to wider mobilization",
      overflowIdea,
    ];
    const result = enrichStreamedLessonBriefs(draft, {
      sessionTopicIds: [topicId],
      materials: [],
      knowledgeTopics: [{
        id: topicId,
        title: "Alliance escalation",
        description: "How alliance commitments and mobilization widened a local crisis.",
        subtopics: [],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
        curriculumReference: null,
      }],
      conceptSignals: [],
      taskType: "conceptual_learning",
      deliveryInstructions: {
        schemaVersion: 1,
        explanationDensity: "balanced",
        tone: "encouraging",
        analogyUse: "only_when_helpful",
        workedExamples: "lead_with_example",
        structure: "overview_first",
        pacing: { firstActionMinutes: 3, maximumActivities: 5, instruction: "Begin with a short model while preserving all required ideas." },
        learnerContext: [],
        contentRequirements: { coverAllEssentialIdeas: true, includeConcreteWorkedExample: true, includeCommonMixup: true, preservePrerequisiteOrder: true },
      },
    });

    expect(result.activities[0]?.lessonBrief?.essentialIdeas).toEqual([
      "Alliance obligations connected a local crisis to wider mobilization",
    ]);
    expect(result.coverage.essentialIdeas).toEqual([
      "Alliance obligations connected a local crisis to wider mobilization",
    ]);
    expect(result.coverage.evidenceMap).toEqual([{
      essentialIdea: "Alliance obligations connected a local crisis to wider mobilization",
      activityConcept: "Alliance escalation",
    }]);
    expect(result.coverage.deferredContent).toContain(overflowIdea);
    expect(validateStreamedLessonScope(result, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliance obligations widened the July Crisis.",
      sessionContentTargets: draft.coverage.essentialIdeas,
      sessionEstimatedMinutes: 15,
    })).toBeNull();
  });

  it("still rejects a raw skeleton that claims an active idea without teaching time", () => {
    const draft = streamedDraft();
    const untaughtIdea = "The Sarajevo assassination triggered the July Crisis, which led to declarations of war";
    draft.coverage.essentialIdeas.push(untaughtIdea);
    draft.coverage.evidenceMap.push({
      essentialIdea: untaughtIdea,
      activityConcept: "Alliance escalation",
    });

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliance obligations widened the July Crisis.",
      sessionContentTargets: draft.coverage.essentialIdeas,
      sessionEstimatedMinutes: 15,
    })).toContain(`The active idea “${untaughtIdea}” has no teaching time`);
  });

  it("distributes assigned ideas across bounded teaching blocks instead of expanding the first block", () => {
    const draft = streamedDraft();
    const secondIdea = "Mobilization schedules made escalation difficult to pause";
    draft.coverage.essentialIdeas.push(secondIdea);
    draft.activities.splice(1, 0, {
      ...draft.activities[0]!,
      title: "Connect mobilization to escalation",
      estimatedMinutes: 4,
      lessonBrief: {
        ...draft.activities[0]!.lessonBrief!,
        essentialIdeas: [secondIdea],
      },
    });

    const result = enrichStreamedLessonBriefs(draft, {
      sessionTopicIds: [topicId],
      materials: [],
      knowledgeTopics: [],
      conceptSignals: [],
      taskType: "conceptual_learning",
      deliveryInstructions: {
        schemaVersion: 1,
        explanationDensity: "balanced",
        tone: "encouraging",
        analogyUse: "only_when_helpful",
        workedExamples: "lead_with_example",
        structure: "overview_first",
        pacing: { firstActionMinutes: 3, maximumActivities: 5, instruction: "Use short teaching blocks." },
        learnerContext: [],
        contentRequirements: { coverAllEssentialIdeas: true, includeConcreteWorkedExample: true, includeCommonMixup: true, preservePrerequisiteOrder: true },
      },
    });

    expect(result.activities[0]?.lessonBrief?.essentialIdeas).toEqual([
      "Alliance obligations connected a local crisis to wider mobilization",
    ]);
    expect(result.activities[1]?.lessonBrief?.essentialIdeas).toEqual([secondIdea]);
  });

  it("scales the number of teachable ideas with the teaching block's minutes", () => {
    expect(lessonIdeaCapacityForMinutes(4)).toBe(1);
    expect(lessonIdeaCapacityForMinutes(5)).toBe(1);
    expect(lessonIdeaCapacityForMinutes(8)).toBe(2);
    expect(lessonIdeaCapacityForMinutes(10)).toBe(2);
    expect(lessonIdeaCapacityForMinutes(15)).toBe(3);
  });

  it("allows a later twelve-minute lesson slice to teach more than a four-minute opener", () => {
    const ideas = [
      "Alliance obligations connected a local crisis to wider mobilization",
      "Mobilization schedules made escalation difficult to pause",
      "Declarations of war turned the July Crisis into a continental conflict",
    ];
    const draft = streamedDraft();
    draft.coverage.essentialIdeas = ideas;
    draft.activities[0]!.estimatedMinutes = 12;
    draft.activities[0]!.lessonBrief!.essentialIdeas = ideas;

    const context = {
      sessionTopicIds: [topicId],
      sessionObjective: "Connect the main escalation mechanisms in the July Crisis.",
      sessionContentTargets: ideas,
      sessionEstimatedMinutes: 20,
    };
    expect(validateStreamedLessonScope(draft, context)).toBeNull();

    draft.activities[0]!.estimatedMinutes = 4;
    expect(validateStreamedLessonScope(draft, {
      ...context,
      sessionEstimatedMinutes: 15,
    })).toContain("may teach at most 1 essential idea");
  });

  it.each([
    "The product rule differentiates a product using both changing factors",
    "Cells exchange oxygen and carbon dioxide across thin respiratory membranes",
    "Alliance obligations connected a local crisis to wider mobilization",
    "Inflation erodes purchasing power when prices rise",
  ])("accepts a bounded explanatory claim across subjects: %s", (claim) => {
    expect(isCompleteLessonClaim(claim)).toBe(true);
  });

  it("rejects a bare chapter-style label as lesson content", () => {
    expect(isCompleteLessonClaim("Prewar European alliances and tensions")).toBe(false);
  });

  it("rejects a broad whole-plan idea when the session was assigned a narrower target", () => {
    const draft = streamedDraft();
    draft.coverage.essentialIdeas = ["A complete survey of World War I from 1914 through 1918"];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [...draft.coverage.essentialIdeas];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliance obligations widened the July Crisis.",
      sessionContentTargets: ["Alliance obligations connected a local crisis to wider mobilization"],
      sessionEstimatedMinutes: 15,
    })).toContain("is outside this session's assigned target");
  });

  it("rejects a broad WWI survey even when it repeats words from the assigned opening target", () => {
    const draft = streamedDraft();
    draft.coverage.essentialIdeas = [
      "Alliance commitments and mobilization shaped the opening crisis, while trench warfare, United States entry, and the Treaty of Versailles explain how World War I developed and ended",
    ];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [...draft.coverage.essentialIdeas];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliance obligations widened the July Crisis.",
      sessionContentTargets: [
        "Alliance obligations connected a local crisis to wider mobilization and declarations of war",
      ],
      sessionEstimatedMinutes: 15,
    })).toContain("is outside this session's assigned target");
  });

  it("accepts an explanatory claim scoped by a broader plan target label", () => {
    const draft = streamedDraft();

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how prewar tensions widened the July Crisis.",
      sessionContentTargets: ["Prewar European alliances and tensions"],
      sessionEstimatedMinutes: 15,
    })).toBeNull();
  });

  it("accepts the production prewar explanation for its concise plan target", () => {
    const draft = streamedDraft();
    const idea = "Before 1914, Europe had rival alliance blocs and tensions that made a local crisis more dangerous.";
    draft.coverage.essentialIdeas = [idea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [idea];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Understand the main prewar tensions and build a simple start-to-finish WWI timeline using a concrete example first.",
      sessionContentTargets: ["Prewar European alliances and tensions"],
      sessionEstimatedMinutes: 15,
    })).toBeNull();
  });

  it("accepts the production Sarajevo escalation claim for its sequence target", () => {
    const draft = streamedDraft();
    const idea = "The Sarajevo assassination started a diplomatic and military escalation that widened the crisis into war declarations.";
    draft.coverage.essentialIdeas = [idea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [idea];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Understand the main prewar tensions and build a simple start-to-finish WWI timeline using a concrete example first.",
      sessionContentTargets: ["Sequence from the Sarajevo assassination to declarations of war"],
      sessionEstimatedMinutes: 15,
    })).toBeNull();
  });

  it("accepts normal explanatory claims for concise two-word targets", () => {
    const draft = streamedDraft();
    const idea = "The chain rule differentiates a composite function by multiplying the outer and inner derivatives.";
    draft.coverage.essentialIdeas = [idea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [idea];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain the chain rule.",
      sessionContentTargets: ["Chain rule"],
      sessionEstimatedMinutes: 15,
    })).toBeNull();

    const allianceIdea = "Alliance commitments can pull neighboring powers into a local crisis and widen the war.";
    draft.coverage.essentialIdeas = [allianceIdea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [allianceIdea];
    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain alliance commitments.",
      sessionContentTargets: ["Alliance commitments"],
      sessionEstimatedMinutes: 15,
    })).toBeNull();
  });

  it("still rejects a short target padded with neighboring subject matter", () => {
    const draft = streamedDraft();
    const idea = "Photosynthesis and cellular respiration exchange gases while ecosystems recycle matter and energy.";
    draft.coverage.essentialIdeas = [idea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [idea];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain photosynthesis.",
      sessionContentTargets: ["Photosynthesis"],
      sessionEstimatedMinutes: 15,
    })).toContain("is outside this session's assigned target");

    const dilutionIdea = "Dilution changes founder ownership while liquidation preferences, debt conversion, board control, and investor exits shape financing.";
    draft.coverage.essentialIdeas = [dilutionIdea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [dilutionIdea];
    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain founder dilution.",
      sessionContentTargets: ["Dilution changes founder ownership"],
      sessionEstimatedMinutes: 15,
    })).toContain("is outside this session's assigned target");
  });

  it("still rejects later-war survey content for the same concise prewar target", () => {
    const draft = streamedDraft();
    const idea = "Before 1914, Europe had rival alliance blocs and tensions, then trench warfare, United States entry, and the Treaty of Versailles explain how the war developed and ended.";
    draft.coverage.essentialIdeas = [idea];
    draft.activities[0]!.lessonBrief!.essentialIdeas = [idea];

    expect(validateStreamedLessonScope(draft, {
      sessionTopicIds: [topicId],
      sessionObjective: "Understand the main prewar tensions and build a simple start-to-finish WWI timeline using a concrete example first.",
      sessionContentTargets: ["Prewar European alliances and tensions"],
      sessionEstimatedMinutes: 15,
    })).toContain("is outside this session's assigned target");
  });
});

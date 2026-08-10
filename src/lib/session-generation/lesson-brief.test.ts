import { describe, expect, it, vi } from "vitest";
import { enrichStreamedLessonBriefs } from "@/lib/session-generation/lesson-brief";
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

  it("assigns every coverage idea to a teaching brief before checks can assess it", () => {
    const draft = streamedDraft();
    draft.coverage.essentialIdeas.push("Mobilization schedules made escalation difficult to pause");
    const teachingActivity = draft.activities[0];
    if (!teachingActivity || teachingActivity.type !== "instruction" || !teachingActivity.lessonBrief) {
      throw new Error("The fixture needs a teaching brief.");
    }
    teachingActivity.lessonBrief.essentialIdeas = [
      "A broad model label",
      "A second unsupported label",
      "A third unsupported label",
      "A fourth unsupported label",
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

    expect(result.activities[0]?.lessonBrief?.essentialIdeas).toEqual(draft.coverage.essentialIdeas);
  });
});

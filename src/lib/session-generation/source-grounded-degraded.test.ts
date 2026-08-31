import { describe, expect, it } from "vitest";
import { buildStatedPreferenceLessonDelivery } from "@/lib/personalization/session-delivery-policy";
import {
  buildSourceGroundedDegradedSession,
  type SourceGroundedDegradedSessionInput,
} from "@/lib/session-generation/source-grounded-degraded";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_ID = "33333333-3333-4333-8333-333333333333";
const TARGET = "How the sodium-potassium pump maintains ion gradients";
const SOURCE_TEXT = "The sodium-potassium pump uses ATP to move three sodium ions out of a cell and two potassium ions into it. This unequal transport helps maintain the ion gradients used by excitable cells.";

function input(
  architecture: "filled" | "streamed" = "filled",
): SourceGroundedDegradedSessionInput {
  const delivery = buildStatedPreferenceLessonDelivery({
    learnerProfile: null,
    estimatedMinutes: 15,
    taskType: "conceptual_learning",
  });
  return {
    architecture,
    objective: "Explain how the sodium-potassium pump maintains cellular ion gradients.",
    learningMode: "learn",
    taskType: "conceptual_learning",
    methodId: "self_explanation",
    methodName: "Feynman Technique",
    estimatedMinutes: 15,
    topicIds: [TOPIC_ID],
    contentTargets: [TARGET],
    deferredContentTargets: [],
    completionEvidence: ["Explain the transport ratio and its consequence without reopening the source."],
    knowledgeTopics: [{
      id: TOPIC_ID,
      title: TARGET,
      description: "The pump's ATP use, transport ratio, and contribution to membrane ion gradients.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [{
        materialId: MATERIAL_ID,
        chunkId: CHUNK_ID,
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: SOURCE_TEXT.length,
        locationLabel: "Page 4, membrane transport",
        sectionRole: "content_source",
      }],
      origin: "material",
      deferred: null,
    }],
    materials: [{
      materialId: MATERIAL_ID,
      chunkId: CHUNK_ID,
      name: "Cell transport notes.pdf",
      locationLabel: "Page 4, membrane transport",
      text: SOURCE_TEXT,
      truncated: false,
      role: "content_source",
    }],
    personalizationReasons: [
      "YOVA is keeping each attempt private and revisable before showing the verified comparison.",
    ],
    deliveryInstructions: delivery.instructions,
    maximumActivities: 8,
  };
}

describe("source-grounded degraded session", () => {
  it("builds the exact self-explanation recipe from mapped explanatory source text", () => {
    const draft = buildSourceGroundedDegradedSession(input());

    expect(draft).not.toBeNull();
    expect(draft?.methodBriefing).toMatchObject({
      methodId: "self_explanation",
      name: "Feynman Technique",
    });
    expect(draft?.activities.map((activity) => activity.methodPhase)).toEqual([
      "model",
      "explain",
      "repair",
      "reexplain",
    ]);
    expect(draft?.sourceGrounding).toMatchObject({
      mode: "materials_only",
      anchors: [expect.objectContaining({ chunkId: CHUNK_ID })],
    });
    expect(JSON.stringify(draft)).toContain("three sodium ions");
    expect(JSON.stringify(draft)).not.toContain("scope-only");
  });

  it("places the verified chunk in streamed lesson delivery without another provider call", () => {
    const draft = buildSourceGroundedDegradedSession(input("streamed"));
    const lessonBriefs = draft?.activities.flatMap((activity) => (
      "lessonBrief" in activity && activity.lessonBrief ? [activity.lessonBrief] : []
    ));

    expect(draft).not.toBeNull();
    expect(lessonBriefs).toHaveLength(1);
    expect(lessonBriefs?.[0]).toMatchObject({
      knowledgeSource: "material_content",
      sourceChunks: [expect.objectContaining({
        chunkId: CHUNK_ID,
        text: SOURCE_TEXT,
      })],
    });
  });

  it("refuses scope outlines because deterministic fallback cannot invent their teaching", () => {
    const scoped = input();
    scoped.materials = scoped.materials.map((material) => ({
      ...material,
      role: "scope_outline",
    }));

    expect(buildSourceGroundedDegradedSession(scoped)).toBeNull();
  });

  it("refuses missing, unmapped, or AI-origin source authority", () => {
    const missing = input();
    missing.materials = [];
    expect(buildSourceGroundedDegradedSession(missing)).toBeNull();

    const aiOrigin = input();
    aiOrigin.knowledgeTopics = aiOrigin.knowledgeTopics.map((topic) => ({
      ...topic,
      origin: "ai_generated",
      sourceReferences: [],
    }));
    expect(buildSourceGroundedDegradedSession(aiOrigin)).toBeNull();
  });

  it("does not invent concept-map relationships in deterministic fallback", () => {
    const conceptMapping = input();
    conceptMapping.learningMode = "study";
    conceptMapping.methodId = "concept_mapping";
    conceptMapping.methodName = "Concept Mapping";

    expect(buildSourceGroundedDegradedSession(conceptMapping)).toBeNull();
  });

  it("preserves committed route identity while explicitly deferring an unsupported mixed-authority target", () => {
    const mixed = input("streamed");
    const aiTopicId = "44444444-4444-4444-8444-444444444444";
    const aiTarget = "How membrane potential changes after the pump is inhibited";
    mixed.estimatedMinutes = 30;
    mixed.topicIds = [TOPIC_ID, aiTopicId];
    mixed.routeTopicIds = [TOPIC_ID, aiTopicId];
    mixed.contentTargets = [TARGET, aiTarget];
    mixed.completionEvidence = [
      "Explain the transport ratio without reopening the source.",
      "Explain the inhibition effect without reopening the source.",
    ];
    mixed.knowledgeTopics.push({
      id: aiTopicId,
      title: aiTarget,
      description: "A neighboring continuation generated without mapped learner material.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    });

    const draft = buildSourceGroundedDegradedSession(mixed);

    expect(draft?.topicIds).toEqual([TOPIC_ID, aiTopicId]);
    expect(draft?.coverage.deferredContent).toEqual([aiTarget]);
    expect(draft?.activities.filter((activity) => activity.topicId).map((activity) => (
      activity.topicId
    ))).not.toContain(aiTopicId);
    expect(JSON.stringify(draft)).not.toContain("neighboring continuation generated");
  });
});

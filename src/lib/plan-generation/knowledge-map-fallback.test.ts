import { describe, expect, it } from "vitest";
import { buildDeterministicKnowledgeMapFallback } from "@/lib/plan-generation/knowledge-map-fallback";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_TOPIC_ID = "22222222-2222-4222-8222-222222222221";
const SECOND_TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_CHUNK_ID = "33333333-3333-4333-8333-333333333331";
const SECOND_CHUNK_ID = "33333333-3333-4333-8333-333333333332";

describe("deterministic knowledge-map fallback", () => {
  it("reports a mapping failure instead of silently inventing a new map from material metadata", () => {
    const request = baseRequest({
      materialMode: "upload",
      materials: [{
        id: MATERIAL_ID,
        name: "cell-respiration-notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2_048,
        textContent: "Source text remains outside the generated plan response.",
        processingStatus: "ready",
        understanding: {
          version: 1,
          role: "content_source",
          roleReason: "The document contains explanatory teaching content and examples.",
          mixedSections: [],
          chunkCount: 2,
          mappedAt: "2026-08-31T09:00:00.000Z",
          topics: [
            materialTopic({
              id: FIRST_TOPIC_ID,
              chunkId: FIRST_CHUNK_ID,
              chunkIndex: 0,
              title: "Glycolysis inputs and outputs",
              description: "The notes explain the inputs, outputs, and location of glycolysis.",
            }),
            materialTopic({
              id: SECOND_TOPIC_ID,
              chunkId: SECOND_CHUNK_ID,
              chunkIndex: 1,
              title: "Oxidative phosphorylation",
              description: "The notes connect the electron transport chain to ATP production.",
              prerequisiteTopicIds: [FIRST_TOPIC_ID],
            }),
          ],
        },
      }],
    });

    expect(() => buildDeterministicKnowledgeMapFallback(request, "knowledge_map_provider_request"))
      .toThrow("YOVA could not map this learning goal yet. Try again in a moment.");

  });

  it("reports a retryable source-free mapping failure without preview topics", () => {
    expect(() => buildDeterministicKnowledgeMapFallback(baseRequest(), "knowledge_map_structure"))
      .toThrow("YOVA could not map this learning goal yet. Try again in a moment.");
  });
});

function baseRequest(overrides: Record<string, unknown> = {}) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Learn cellular respiration accurately and explain how its major stages connect.",
    startingContext: "I need a careful explanation from the beginning.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: null,
    timeZone: "UTC",
    diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Evening", minutes: 30 }],
    profileSummary: "Use concise explanations followed by an independent check.",
    ...overrides,
  });
}

function materialTopic({
  id,
  chunkId,
  chunkIndex,
  title,
  description,
  prerequisiteTopicIds = [],
}: {
  id: string;
  chunkId: string;
  chunkIndex: number;
  title: string;
  description: string;
  prerequisiteTopicIds?: string[];
}) {
  return {
    id,
    title,
    description,
    subtopics: [],
    prerequisiteTopicIds,
    status: "secure" as const,
    initialEvidence: {
      source: "placement_check" as const,
      outcome: "demonstrated" as const,
      observedAt: "2026-08-31T09:05:00.000Z",
    },
    sourceReferences: [{
      materialId: MATERIAL_ID,
      chunkId,
      chunkIndex,
      startCharacter: chunkIndex * 100,
      endCharacter: chunkIndex * 100 + 90,
      locationLabel: `Page ${chunkIndex + 1}`,
      sectionRole: "content_source" as const,
    }],
    origin: "material" as const,
    deferred: null,
  };
}

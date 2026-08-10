import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: () => ({ model: "gpt-yova-map-test" }),
}));

const baseRequest = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn the product rule well enough to solve an upcoming calculus quiz.",
  startingContext: "I am starting from the beginning and have not learned this rule.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: "2026-08-20T18:00:00.000Z",
  timeZone: "UTC",
  diagnosticResponses: [],
  availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants a concise explanation followed by guided examples and independent practice.",
});

function response(outputParsed: unknown) {
  return {
    status: "completed",
    output_parsed: outputParsed,
    usage: {
      input_tokens: 200,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 80,
    },
  };
}

describe("plan knowledge-map generation", () => {
  beforeEach(() => parseResponse.mockReset());

  it("builds a prerequisite-ordered map for a no-material goal", async () => {
    parseResponse.mockResolvedValue(response({
      scopeJudgment: {
        band: "focused_skill",
        label: "Focused calculus skill",
        minimumSessions: 2,
        recommendedSessions: 4,
        maximumSessions: 6,
        minimumTeachingSessions: 2,
        explanation: "The learner needs the prerequisite meaning, the rule itself, guided use, and independent evidence.",
      },
      topics: [
        {
          title: "Products of functions",
          description: "Recognize a function formed by multiplying two changing functions.",
          subtopics: ["Function factors"],
          prerequisiteTopicIndexes: [],
          sourceMaterialTopicIds: [],
        },
        {
          title: "The product rule",
          description: "Differentiate a product by combining both factor derivatives correctly.",
          subtopics: ["Rule structure"],
          prerequisiteTopicIndexes: [0],
          sourceMaterialTopicIds: [],
        },
        {
          title: "Independent rule selection",
          description: "Choose and apply the product rule without a provided scaffold.",
          subtopics: ["Mixed rule selection"],
          prerequisiteTopicIndexes: [1],
          sourceMaterialTopicIds: [],
        },
      ],
    }));
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");

    const correctedRequest = PlanGenerationRequestSchema.parse({
      ...baseRequest,
      mapCorrection: "Include the chain rule prerequisite, but keep integration outside this plan.",
    });
    const result = await generatePlanKnowledgeMap(correctedRequest);

    expect(result.map.scopeJudgment.band).toBe("focused_skill");
    expect(result.map.topics).toHaveLength(3);
    expect(result.map.topics[1]?.prerequisiteTopicIds).toEqual([result.map.topics[0]?.id]);
    expect(result.map.topics.every((topic) => topic.origin === "ai_generated")).toBe(true);
    expect(parseResponse.mock.calls[0]?.[0]?.input).toContain("Include the chain rule prerequisite");
  });

  it("rejects a map that silently drops an uploaded material topic", async () => {
    const materialTopicId = "22222222-2222-4222-8222-222222222222";
    const materialRequest = PlanGenerationRequestSchema.parse({
      ...baseRequest,
      materialMode: "upload",
      materials: [{
        id: "33333333-3333-4333-8333-333333333333",
        name: "quiz-outline.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_000,
        textContent: "Product rule and quotient rule",
        processingStatus: "ready",
        understanding: {
          version: 1,
          role: "scope_outline",
          roleReason: "The document lists quiz topics without providing instructional explanations.",
          mixedSections: [],
          chunkCount: 1,
          mappedAt: "2026-08-09T18:00:00.000Z",
          topics: [{
            id: materialTopicId,
            title: "Product rule",
            description: "The quiz outline requires product rule differentiation.",
            subtopics: [],
            prerequisiteTopicIds: [],
            status: "not_started",
            sourceReferences: [{
              materialId: "33333333-3333-4333-8333-333333333333",
              chunkId: "44444444-4444-4444-8444-444444444444",
              chunkIndex: 0,
              startCharacter: 0,
              endCharacter: 30,
              locationLabel: "Characters 1-30",
              sectionRole: "scope_outline",
            }],
            origin: "material",
            deferred: null,
          }],
        },
      }],
    });
    parseResponse.mockResolvedValue(response({
      scopeJudgment: {
        band: "focused_skill",
        label: "Focused calculus skill",
        minimumSessions: 2,
        recommendedSessions: 3,
        maximumSessions: 5,
        minimumTeachingSessions: 1,
        explanation: "The returned map is invalid because it omits the uploaded outline topic.",
      },
      topics: [{
        title: "Unrelated derivative review",
        description: "Review a derivative topic that was not the mapped outline requirement.",
        subtopics: [],
        prerequisiteTopicIndexes: [],
        sourceMaterialTopicIds: [],
      }],
    }));
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");

    await expect(generatePlanKnowledgeMap(materialRequest)).rejects.toMatchObject({
      failedValidator: "knowledge_map_material_coverage",
    });
  });
});

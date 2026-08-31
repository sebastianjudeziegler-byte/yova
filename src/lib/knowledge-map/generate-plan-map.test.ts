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

  it("regenerates a long-goal scope label that ends on a dangling word", async () => {
    const outputForLabel = (label: string) => ({
      scopeJudgment: {
        band: "unit_or_exam",
        label,
        minimumSessions: 4,
        recommendedSessions: 6,
        maximumSessions: 8,
        minimumTeachingSessions: 4,
        explanation: "The learner needs several connected derivative rules and enough practice to prepare for a unit test.",
      },
      topics: [{
        title: "Derivative rule selection",
        description: "Select and apply the appropriate derivative rule for each expression.",
        subtopics: ["Product rule", "Chain rule", "Implicit differentiation"],
        prerequisiteTopicIndexes: [],
        sourceMaterialTopicIds: [],
      }],
    });
    parseResponse
      .mockResolvedValueOnce(response(outputForLabel(
        "Calc Unit 3 test on derivative basics, product rule, chain rule, and implicit on",
      )))
      .mockResolvedValueOnce(response({ label: "Derivative rules for Calc Unit 3" }));
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");
    const longGoalRequest = PlanGenerationRequestSchema.parse({
      ...baseRequest,
      goal: "Calc Unit 3 test: derivative basics, product rule, chain rule, and implicit differentiation",
    });

    const result = await generatePlanKnowledgeMap(longGoalRequest);

    expect(result.map.scopeJudgment.label).toBe("Derivative rules for Calc Unit 3");
    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[1]?.timeout)).toEqual([35_000, 10_000]);
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).toContain("Aim for 3-8 words");
    expect(parseResponse.mock.calls[1]?.[0]?.instructions).toContain("REPAIR ATTEMPT");
    expect(parseResponse.mock.calls[1]?.[0]?.max_output_tokens).toBe(200);
    expect(parseResponse.mock.calls[1]?.[0]?.input).toContain("implicit on");
    expect(result.stats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      failedValidator: "knowledge_map_structure",
    });

    const providerSchema = parseResponse.mock.calls[1]?.[0]?.text?.format?.schema as {
      properties?: { label?: { pattern?: string } };
    };
    const labelPattern = providerSchema.properties?.label?.pattern;
    expect(labelPattern).toEqual(expect.any(String));
    expect(new RegExp(labelPattern!).test("Derivative rules AND")).toBe(false);
    expect(new RegExp(labelPattern!).test("Derivative rules for Calc Unit 3")).toBe(true);
  });

  it("preserves both provider calls and token totals when scope-label repair fails", async () => {
    parseResponse
      .mockResolvedValueOnce(response({
        scopeJudgment: {
          band: "focused_skill",
          label: "Product rule and",
          minimumSessions: 2,
          recommendedSessions: 3,
          maximumSessions: 4,
          minimumTeachingSessions: 1,
          explanation: "The learner needs one explanation, guided application, and independent evidence.",
        },
        topics: [{
          title: "The product rule",
          description: "Differentiate a product by combining both factor derivatives correctly.",
          subtopics: [],
          prerequisiteTopicIndexes: [],
          sourceMaterialTopicIds: [],
        }],
      }))
      .mockResolvedValueOnce({
        ...response({ label: "Product rule application" }),
        status: "incomplete",
      });
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");

    await expect(generatePlanKnowledgeMap(baseRequest)).rejects.toMatchObject({
      failedValidator: "knowledge_map_response_status",
      model: "gpt-yova-map-test",
      generationMetrics: {
        attempts: 2,
        inputTokens: 400,
        outputTokens: 160,
        firstAttemptPassed: false,
        failedValidator: "knowledge_map_response_status",
      },
    });
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

  it("uses the versioned official AP Biology Unit 2 spine instead of model labels", async () => {
    parseResponse.mockResolvedValue(response({
      scopeJudgment: {
        band: "unit_or_exam",
        label: "AP Biology Unit 2",
        minimumSessions: 6,
        recommendedSessions: 10,
        maximumSessions: 14,
        minimumTeachingSessions: 6,
        explanation: "The learner is starting a full official unit, so the plan needs prerequisite-ordered teaching and later evidence.",
      },
      materialAlignments: [],
    }));
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");
    const request = PlanGenerationRequestSchema.parse({
      ...baseRequest,
      goal: "Prepare for my AP Biology Unit 2 exam on cells from the beginning.",
    });

    const result = await generatePlanKnowledgeMap(request);

    expect(result.map.curriculum).toMatchObject({
      id: "college_board_ap_biology_2025_unit_2",
      version: "Course and Exam Description, effective Fall 2025",
      matchSource: "goal",
    });
    expect(result.map.topics.map((topic) => topic.title)).toEqual([
      "2.1 Cell Structure and Function",
      "2.2 Cell Size",
      "2.3 Plasma Membrane",
      "2.4 Membrane Permeability",
      "2.5 Membrane Transport",
      "2.6 Facilitated Diffusion",
      "2.7 Tonicity and Osmoregulation",
      "2.8 Mechanisms of Transport",
      "2.9 Cell Compartmentalization",
      "2.10 Origins of Cell Compartmentalization",
    ]);
    expect(result.map.topics[2]?.curriculumReference).toEqual({
      curriculumId: "college_board_ap_biology_2025_unit_2",
      topicCode: "2.3",
      objectiveCodes: ["2.3.A", "2.3.B"],
    });
    expect(result.map.topics[2]?.subtopics[0]).toContain("2.3.A: Describe the roles");
    expect(result.stats).toMatchObject({
      curriculumRecognized: true,
      curriculumId: "college_board_ap_biology_2025_unit_2",
    });
  });

  it("aligns uploaded material topics onto official topic ids without allowing invented codes", async () => {
    const materialTopicId = "77777777-7777-4777-8777-777777777777";
    parseResponse.mockResolvedValue(response({
      scopeJudgment: {
        band: "unit_or_exam",
        label: "AP Biology Unit 2",
        minimumSessions: 5,
        recommendedSessions: 9,
        maximumSessions: 14,
        minimumTeachingSessions: 5,
        explanation: "The study guide defines the official unit scope while YOVA supplies any missing instruction.",
      },
      materialAlignments: [{
        sourceMaterialTopicId: materialTopicId,
        curriculumTopicCodes: ["2.5", "2.7"],
      }],
    }));
    const request = PlanGenerationRequestSchema.parse({
      ...baseRequest,
      goal: "Prepare for my AP Biology Unit 2 exam on cells.",
      materialMode: "upload",
      materials: [{
        id: "88888888-8888-4888-8888-888888888888",
        name: "AP Biology Unit 2 study guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_000,
        textContent: "Membrane transport, concentration gradients, and osmosis",
        processingStatus: "ready",
        understanding: {
          version: 1,
          role: "scope_outline",
          roleReason: "The study guide lists the required membrane topics without teaching them in depth.",
          mixedSections: [],
          chunkCount: 1,
          mappedAt: "2026-08-09T18:00:00.000Z",
          topics: [{
            id: materialTopicId,
            title: "Membrane transport and osmosis",
            description: "The guide requires transport mechanisms and osmoregulation.",
            subtopics: ["Diffusion", "Osmosis"],
            prerequisiteTopicIds: [],
            status: "not_started",
            sourceReferences: [{
              materialId: "88888888-8888-4888-8888-888888888888",
              chunkId: "99999999-9999-4999-8999-999999999999",
              chunkIndex: 0,
              startCharacter: 0,
              endCharacter: 58,
              locationLabel: "Characters 1-58",
              sectionRole: "scope_outline",
            }],
            origin: "material",
            deferred: null,
          }],
        },
      }],
    });
    const { generatePlanKnowledgeMap } = await import("@/lib/knowledge-map/generate-plan-map");

    const result = await generatePlanKnowledgeMap(request);

    expect(result.map.topics.find((topic) => topic.curriculumReference?.topicCode === "2.5")?.sourceReferences).toHaveLength(1);
    expect(result.map.topics.find((topic) => topic.curriculumReference?.topicCode === "2.7")?.sourceReferences).toHaveLength(1);
    expect(result.map.topics.find((topic) => topic.curriculumReference?.topicCode === "2.6")?.origin).toBe("ai_generated");
  });
});

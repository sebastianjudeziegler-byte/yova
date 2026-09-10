import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockFixture, BLOCK_TOPIC_ID } from "./brief-c-block-fixture";
import { deltaFixture } from "./personalization-delta-fixture";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

vi.mock("server-only", () => ({}));
const oldLesson = vi.hoisted(() => vi.fn(async () => ({
  draft: { topicIds: [], rationale: "AI lesson first", activities: [{ type: "instruction", title: "AI lesson first" }] },
  model: "fixture-only", responseId: "legacy", generationStats: { attempts: 1, elapsedMs: 1 },
})));
vi.mock("@/lib/openai/streamed-teaching-generator", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/openai/streamed-teaching-generator")>(),
  generateStreamedTeachingSkeletonWithOpenAI: oldLesson,
}));
vi.mock("@/lib/openai/reliable-session-generator", () => ({ canGenerateReliableSession: () => true, generateReliableSessionWithOpenAI: oldLesson }));

export function generationContext(profile: 1 | 2, mode: "learn" | "study" = "learn", sourced = true): SessionGenerationContext {
  const saved = blockFixture(profile);
  const source = saved.block.sources[0]!;
  return {
    learningGoal: { title: "AP Biology", topic: "Cellular energetics", kind: "course", deadline: null, sourceMode: sourced ? "user_materials" : "yova_generated", studyMode: "inside_yova", learningIntent: mode },
    planRationale: "Learn ATP and energy transfer using the assigned lecture section.",
    session: { title: "ATP and energy transfer", objective: saved.block.objective, method: "Retrieval Practice", methodReason: saved.rationale, estimatedMinutes: 20, learningMode: mode, topicIds: [BLOCK_TOPIC_ID], contentTargets: ["ATP and energy transfer"], completionEvidence: saved.coverage.completionEvidence },
    knowledgeTopics: [{ id: BLOCK_TOPIC_ID, title: "ATP and energy transfer", description: saved.block.objective, subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, origin: sourced ? "material" : "ai_generated", deferred: null,
      attachedSources: sourced ? [{ material_id: source.materialId }] : [],
      sourceReferences: sourced ? [{ materialId: source.materialId, chunkId: "c0000000-0000-4000-8000-000000000005", chunkIndex: 0, startCharacter: 0, endCharacter: source.text.length, locationLabel: source.section, sectionRole: "content_source" }] : [],
    }],
    materials: sourced ? [{ materialId: source.materialId, chunkId: "c0000000-0000-4000-8000-000000000005", name: source.title, text: source.text, truncated: false, locationLabel: source.section, role: "content_source" }] : [],
    learnerProfile: null, personalization: deltaFixture(profile).methodContext.personalization,
    recentResults: [], recentInterruptions: [], conceptSignals: [],
  };
}

type ProviderInput = { slots: Array<{ id: string; topicId: string; format: string }>; explanationTopicIds: string[] };
function provider() {
  return {
    generate: vi.fn(async (input: ProviderInput) => ({
      explanations: input.explanationTopicIds.map(topicId => ({ topicId, text: blockFixture().block.sources[0]!.text })),
      questions: input.slots.map((slot, index) => ({
        id: slot.id, topicId: slot.topicId,
        prompt: ["Which products form when ATP reacts with water?", "Why can ATP hydrolysis support energy-requiring work?", "What inputs are needed to regenerate ATP?"][index % 3]!,
        choices: slot.format === "multiple_choice" ? ["ADP and inorganic phosphate", "ADP and glucose", "AMP and oxygen"] : [],
        answer: index === 0 ? "ADP and inorganic phosphate" : index === 1 ? "The favorable reaction supplies free energy to the coupled process." : "ADP, phosphate and energy from other reactions.",
        requiredIdeas: [index === 0 ? "ADP and inorganic phosphate" : index === 1 ? "Favorable free-energy transfer drives the coupled process" : "ADP, phosphate and energy"],
        explanation: "Hydrolysis converts ATP to ADP and phosphate; the favorable change supplies free energy to a coupled process.",
        hints: ["Look at the hydrolysis sentence.", "Distinguish the products from the inputs."],
        workedExample: "For ATP regeneration, first identify the reactants: ADP and phosphate. Apply the same reactant/product distinction here.",
        workedSolution: [],
      })),
    })),
    review: vi.fn(async (): Promise<{ verdict: "pass" | "fail"; reason: string }> => ({ verdict: "pass", reason: "Every check is supported by the assigned section and has a defensible answer." })),
  };
}

async function generate(profile: 1 | 2, mode: "learn" | "study" = "learn", sourced = true, port = provider()) {
  const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");
  const runtime = { signal: undefined, blockProvider: port };
  const result = await generateProductionSessionWithOpenAI(generationContext(profile, mode, sourced), runtime);
  const block = Reflect.get(result.draft, "block") as ReturnType<typeof blockFixture>["block"] | undefined;
  return { block, port };
}

describe("Brief C production block defaults", () => {
  beforeEach(() => oldLesson.mockClear());

  it("delivers the learner's PDF first, then its supported practice instead of a default AI lesson", async () => {
    const { block } = await generate(1);
    expect(block?.activities[0]?.kind).toBe("read_source_section");
    expect(block?.sources[0]?.title).toBe("Cellular energetics lecture.pdf");
    expect(block?.questions[0]?.prompt).toContain("ATP");
    expect(oldLesson).not.toHaveBeenCalled();
  });

  it("keeps an unsourced learn topic on the AI-explanation default", async () => {
    const { block } = await generate(2, "learn", false);
    expect(block?.activities[0]?.kind).toBe("ai_explanation");
    expect(block?.sources).toHaveLength(0);
    expect(block?.questions).not.toHaveLength(0);
  });

  it("opens covered work as practice and keeps the source optional", async () => {
    const { block } = await generate(1, "study");
    expect(block?.activities[0]?.kind).toBe("quiz");
    expect(block?.activities.some(activity => activity.kind === "ai_explanation")).toBe(false);
    expect(block?.sources[0]?.title).toContain("lecture.pdf");
    expect(block?.stoppingPoint).toContain("continue");
  });

  it("delivers at least three visible profile differences in the first practice activity", async () => {
    const { block: p1 } = await generate(1);
    const { block: p2 } = await generate(2);
    expect(p1?.questions[0]?.workedExample).toContain("reactants");
    expect(p2?.questions[0]?.workedExample).toBeNull();
    expect(p1?.questions[0]?.hints.length).toBeGreaterThan(0);
    expect(p2?.questions[0]?.hints).toHaveLength(0);
    expect(p1?.questions.length).toBeLessThan(p2?.questions.length ?? 0);
    expect(p1?.personalization.profileReason).toMatch(/short|focus|example/i);
    expect(p2?.personalization.profileReason).toMatch(/own words|reflect/i);
  });

  it("performs one bounded semantic review and saves its judgment with the block", async () => {
    const { block, port } = await generate(1);
    expect(port.review).toHaveBeenCalledTimes(1);
    expect(port.review.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ timeoutMs: expect.any(Number) })]));
    expect(block?.semanticReview.status).toBe("passed");
  });

  it("routes failed semantic review to recovery without retries or a fallback AI lesson", async () => {
    const port = provider();
    port.review.mockResolvedValue({ verdict: "fail", reason: "Two answer choices are defensible." });
    await expect(generate(1, "learn", true, port)).rejects.toThrow(/review|practice|prepare/i);
    expect(port.generate).toHaveBeenCalledTimes(1);
    expect(port.review).toHaveBeenCalledTimes(1);
    expect(oldLesson).not.toHaveBeenCalled();
  });
});

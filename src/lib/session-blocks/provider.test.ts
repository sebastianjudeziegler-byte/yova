import { describe, expect, it, vi } from "vitest";
import { generationContext } from "@/evals/brief-c-generation-fixture";
import { generateWorkBlock } from "./generate";
const parse = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => ({ responses: { parse } }) }));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => ({ model: "unit-fixture" }) }));

describe("provider fills code-owned block slots", () => {
  it("rejects an apparently passing review when independent choice checking finds two defensible answers", async () => {
    const { WorkBlockSchema } = await import("./schema");
    const { blockFixture } = await import("@/evals/brief-c-block-fixture");
    const block = WorkBlockSchema.parse(blockFixture().block);
    const question = block.questions[0]!;
    question.prompt = "Which process uses or transforms energy?";
    question.choices = ["ATP regeneration", "ATP hydrolysis", "Neither"];
    parse.mockReset();
    parse.mockResolvedValue({ output_parsed: { verdict: "pass", reason: "The chosen answer is supported.", choiceChecks: { [question.id]: [0, 1] } } });
    const { createBlockProvider } = await import("./provider");
    const result = await createBlockProvider().review({ block, answerKeys: [{ questionId: question.id, answer: "ATP hydrolysis", requiredIdeas: ["ATP hydrolysis"], explanation: "ATP hydrolysis transforms energy.", sourceIds: [block.sources[0]!.id], workedSolution: [] }], assignedTopics: generationContext(1).knowledgeTopics, deferredContent: [] }, { timeoutMs: 25_000 });
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/one defensible answer/);
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it("binds content by fixed slot key and keeps requested hints and the first example required", async () => {
    parse.mockReset();
    const context = generationContext(1);
    parse.mockImplementation(async request => {
      if (request.text.format.name === "yova_block_semantic_review") return { id: "review", output_parsed: { verdict: "pass", reason: "The two questions are source-supported and distinct.", choiceChecks: { "practice-1": [0] } } };
      const question = (prompt: string, answer: string, choices: string[], workedExample: string | null) => ({ prompt, answer, choices, workedExample, requiredIdeas: [answer], explanation: "Hydrolysis produces ADP and phosphate and supplies free energy for coupled work.", hints: ["Use the hydrolysis sentence in the assigned section."], workedSolution: [] });
      return { id: "fill", output_parsed: { explanations: {}, questions: {
        "practice-1": question("Which products form when ATP reacts with water?", "ADP and inorganic phosphate", ["ADP and inorganic phosphate", "ADP and glucose", "AMP and oxygen"], "For regeneration, ADP and phosphate are inputs; distinguish inputs from products."),
        "practice-2": question("Why can hydrolysis support cellular work?", "Favorable free-energy transfer drives a coupled process.", [], null),
      } } };
    });
    const generated = await generateWorkBlock(context, {});
    expect(generated.block.questions.map(question => question.id)).toEqual(["practice-1", "practice-2"]);
    expect(generated.block.questions.every(question => question.topicId === context.session.topicIds[0])).toBe(true);
    expect(generated.block.questions[0]?.workedExample).toContain("regeneration");
    expect(generated.block.questions.every(question => question.hints.length > 0)).toBe(true);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls.every(call => call[1].maxRetries === 0)).toBe(true);
    const schema = parse.mock.calls[0]![0].text.format.schema;
    expect(Object.keys(schema.properties.questions.properties)).toEqual(["practice-1", "practice-2"]);
    expect(schema.properties.questions.properties["practice-1"].properties.hints.minItems).toBe(1);
  });
});

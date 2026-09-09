import { beforeEach, describe, expect, it, vi } from "vitest";
import captures from "./__fixtures__/brief-0-5-validator-captures.json";
import additionCapture from "./__fixtures__/brief-0-5-addition-capture.json";
import equationCapture from "./__fixtures__/brief-0-5-equation-capture.json";
import type { SessionGenerationContext } from "./session-generator";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import { lessonIdeaSharesTargetSubject } from "@/lib/session-generation/lesson-brief";

const parse = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ getOpenAIClient: () => ({ responses: { parse } }) }));
vi.mock("./config", () => ({ getOpenAISessionConfig: () => ({ apiKey: "test", model: "test" }) }));

function supply(outputs: unknown[]) {
  parse.mockReset();
  for (const [index, output_parsed] of outputs.entries()) parse.mockResolvedValueOnce({
    id: `capture-${index}`, model: "test", status: "completed", output_parsed,
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100 },
  });
}

describe("Brief 0.5 preserved subject and notation boundaries", () => {
  beforeEach(() => parse.mockReset());

  it("delivers the captured complete symbolic equation without requesting a replacement lesson", async () => {
    supply(equationCapture.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(equationCapture.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas).toEqual(["(fg)' = f'g + fg'"]);
    expect(result.draft.activities.find(activity => activity.type === "multiple_choice")?.correctAnswer).toBe("A product of two functions");
    expect(result.generationStats.attempts).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("delivers the captured membrane claims and their typed checks without lending the transport target", async () => {
    supply(captures.membrane.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.membrane.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas).toContain("Phospholipids form a hydrophobic core that blocks most polar or charged substances.");
    const lessons = StreamedGeneratedSessionDraftSchema.parse(result.draft).activities.filter(activity => activity.type === "instruction");
    expect(lessons.flatMap(activity => activity.lessonBrief?.essentialIdeas ?? []).join(" ")).toMatch(/hydrophobic core/);
    expect(result.draft.activities.filter(activity => activity.type === "free_response").map(activity => activity.correctAnswer).join(" ")).toMatch(/hydrophobic|polar/i);
  });

  it("delivers distinct product-rule formulas as choices instead of rejecting them as duplicates", async () => {
    supply(captures.formula.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.formula.context as SessionGenerationContext);
    const recognition = result.draft.activities.find(activity => activity.type === "multiple_choice");
    expect(recognition?.choices).toEqual(["(fg)' = f'g + fg'", "(fg)' = f'g' + f'g", "(fg)' = fg'", "(fg)' = f'g - fg'"]);
    expect(recognition?.correctAnswer).toBe("(fg)' = f'g + fg'");
    expect(result.draft.coverage.essentialIdeas).toContain("(fg)' = f'g + fg'");
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("preserves both captured derivative claims when a symbolic answer establishes the first", async () => {
    supply(captures.product_chain.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.product_chain.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/Product rule/);
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/Chain rule/);
    expect(result.draft.activities.filter(activity => activity.type === "free_response").map(activity => activity.correctAnswer).join(" ")).toContain("f g' + g f'");
  });

  it("keeps the captured product relation when its answer uses plus notation instead of prose", async () => {
    supply(captures.symbolic_relation.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.symbolic_relation.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas).toHaveLength(2);
    expect(result.draft.coverage.essentialIdeas[0]).toContain("plus");
    expect(result.draft.activities.filter(activity => activity.type === "free_response").map(activity => activity.correctAnswer).join(" ")).toContain("f'(x)g(x)+f(x)g'(x)");
  });

  it("preserves the captured adding relation and both derivative lessons through bounded recovery", async () => {
    supply(additionCapture.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(additionCapture.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas).toHaveLength(2);
    expect(result.draft.coverage.essentialIdeas[0]).toContain("adding");
    expect(result.draft.activities.filter(activity => activity.type === "free_response").map(activity => activity.correctAnswer).join(" ")).toContain("f'(x)g(x) + f(x)g'(x)");
    expect(result.generationStats.attempts).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("grounds the typed independent comparison in the same validated claim as recognition", async () => {
    supply(captures.independent_formula.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.independent_formula.context as SessionGenerationContext);
    const check = result.draft.activities.find(activity => activity.methodPhase === "independent_practice")!;
    expect(check.body).toContain("generally not");
    expect(check.correctAnswer).toContain("(fg)' = f'g + fg'");
  });

  it.each(["off-topic", "deferred"])("still rejects %s substance in the typed independent check", async kind => {
    const context = structuredClone(captures.independent_formula.context) as SessionGenerationContext;
    const recovery = structuredClone(captures.independent_formula.outputs[1]) as typeof captures.independent_formula.outputs[1] & { items: { check: { prompt: string; referenceAnswer: string; feedback: string } }[] };
    if (kind === "off-topic") {
      recovery.items[1]!.check.referenceAnswer = "Photosynthesis converts light energy into chemical energy inside chloroplasts.";
      recovery.items[1]!.check.feedback = "Chloroplasts absorb sunlight and use it to build glucose from carbon dioxide and water.";
    } else {
      context.session.deferredContentTargets = ["What net ATP from glycolysis is used for"];
      recovery.items[1]!.check.prompt = "Explain why net ATP from glycolysis is used for muscle contraction and active transport.";
    }
    supply([{}, recovery]);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    await expect(generateStreamedTeachingSkeletonWithOpenAI(context)).rejects.toThrow(kind === "off-topic" ? /streamed_target_subject/ : /streamed_deferred_content/);
  });

  it("recognizes a formula-only authoritative target while preserving different formulas", () => {
    expect(lessonIdeaSharesTargetSubject("The product rule states (fg)' equals f'g plus fg'.", "The formula (fg)' = f'g + fg'")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("For a product fg, the derivative is f'g + fg'.", "The formula (fg)' = f'g + fg'")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("f'g + fg'", "The formula (fg)' = f'g + fg'", "check")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("(fg)' = f'g + fg' + h", "The formula (fg)' = f'g + fg'")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("Photosynthesis converts light into glucose.", "The formula (fg)' = f'g + fg'")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("The formula (fg)' = f'g' multiplies the derivatives.", "The formula (fg)' = f'g + fg'")).toBe(false);
  });

  it("preserves explicit function arguments without accepting different arguments or derivatives", () => {
    const target = "Interpret and state (fg)' = f'g + fg'";
    expect(lessonIdeaSharesTargetSubject("f'(x)g(x) + f(x)g'(x)", target, "check")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("f'(x)g(y) + f(x)g'(y)", target, "check")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("f'(x)g'(x)", target, "check")).toBe(false);
  });

  it("accepts a short chronology answer grounded in its validated armistice teaching claim", async () => {
    supply(captures.history_answer.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.history_answer.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/1918.*armistice|armistice.*1918/);
    expect(result.draft.activities.find(activity => activity.type === "multiple_choice")?.correctAnswer).toBe("1918");
  });

  it("still rejects a neighboring claim's answer in the final claim's recognition slot", async () => {
    supply([{}, captures.history_neighbor]);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    await expect(generateStreamedTeachingSkeletonWithOpenAI(captures.history_answer.context as SessionGenerationContext)).rejects.toThrow(/streamed_target_subject/);
  });

  it("delivers factual date recall through complete validation using equivalent question wording", async () => {
    const outputs = structuredClone(captures.history_answer.outputs);
    const recovery = outputs[1] as typeof outputs[1] & { recognitionCheck: { title: string; prompt: string } };
    recovery.recognitionCheck.title = "World War I ending date";
    recovery.recognitionCheck.prompt = "When did World War I end?";
    supply(outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.history_answer.context as SessionGenerationContext);
    const question = result.draft.activities.find(activity => activity.type === "multiple_choice")!;
    expect(question.title).toBe("World War I ending date");
    expect(question.body).toBe("When did World War I end?");
    expect(question.correctAnswer).toBe("1918");
  });

  it("accepts a complete on-topic check without treating its four choices as one short claim", () => {
    const surface = "Use the product rule. Which derivative correctly differentiates the product f(x)g(x)? The product rule gives f'(x)g(x) + f(x)g'(x). Keep both derivative terms rather than multiplying the derivatives together.";
    expect(lessonIdeaSharesTargetSubject(surface, "Product rule", "check")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("Photosynthesis produces glucose from light energy and carbon dioxide in chloroplasts.", "Product rule", "check")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("Photosynthesis and cellular respiration exchange gases while ecosystems recycle matter and energy.", "Photosynthesis")).toBe(false);
  });

  it("still rejects identical and presentation-equivalent recognition formulas", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    for (const duplicate of ["(fg)' = f'g + fg'", "(fg)′=f′g+fg′"]) {
      const outputs = structuredClone(captures.formula.outputs);
      const normal = outputs[0] as typeof outputs[0] & { activities: { type: string; choices: string[] }[] };
      normal.activities.find(activity => activity.type === "multiple_choice")!.choices[1] = duplicate;
      const recovery = outputs[1] as typeof captures.formula.outputs[1] & { recognitionCheck: { choices: string[] } };
      recovery.recognitionCheck.choices[1] = duplicate;
      supply(outputs);
      await expect(generateStreamedTeachingSkeletonWithOpenAI(captures.formula.context as SessionGenerationContext)).rejects.toThrow(/bounded content schema/);
    }
  });

  it("rejects duplicate choices on the normal path and recovers to distinct learner choices", async () => {
    expect(StreamedGeneratedSessionDraftSchema.safeParse(captures.duplicate_normal.badDraft).success).toBe(false);
    supply(captures.duplicate_normal.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.duplicate_normal.context as SessionGenerationContext);
    const question = result.draft.activities.find(activity => activity.type === "multiple_choice")!;
    expect(question.title).toBe("Recognize the product rule");
    expect(new Set(question.choices).size).toBe(4);
    expect(question.correctAnswer).toBe("(fg)' = f'g + fg'");
  });

  it("keeps case-sensitive code choices distinct at the shared choice boundary", () => {
    const draft = structuredClone(captures.duplicate_normal.badDraft);
    const question = draft.activities.find(activity => activity.type === "multiple_choice")!;
    question.choices = ["values.map(fn)", "values.Map(fn)", "values.filter(fn)", "values.reduce(fn)"];
    question.correctAnswer = question.choices[0]!;
    const parsed = StreamedGeneratedSessionDraftSchema.parse(draft);
    expect(parsed.activities.find(activity => activity.type === "multiple_choice")?.choices).toEqual(question.choices);
  });

  it("does not let an on-topic recognition heading authorize an off-topic answer and explanation", async () => {
    const outputs = structuredClone(captures.product_chain.outputs);
    const recovery = outputs[1] as typeof captures.product_chain.outputs[1] & { recognitionCheck: { choices: string[]; correctAnswer: string; feedback: string } };
    const unrelated = "Photosynthesis stores light energy in glucose inside chloroplasts.";
    recovery.recognitionCheck.choices[0] = unrelated;
    recovery.recognitionCheck.correctAnswer = unrelated;
    recovery.recognitionCheck.feedback = "Chloroplasts absorb light and combine water with carbon dioxide to produce glucose.";
    supply(outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    await expect(generateStreamedTeachingSkeletonWithOpenAI(captures.product_chain.context as SessionGenerationContext)).rejects.toThrow(/streamed_target_subject/);
  });

  it("still rejects the genuinely duplicate Spanish recovery claims", async () => {
    supply(captures.spanish.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    await expect(generateStreamedTeachingSkeletonWithOpenAI(captures.spanish.context as SessionGenerationContext)).rejects.toThrow(/streamed_target_assignment_duplicate/);
  });

  it.each(["prompt", "distractor"])("still rejects deferred ATP-use content in a recognition %s", async field => {
    const context = structuredClone(captures.membrane.context) as SessionGenerationContext;
    context.session.deferredContentTargets = ["What net ATP from glycolysis is used for"];
    const recovery = structuredClone(captures.membrane.outputs[1]) as typeof captures.membrane.outputs[1] & { recognitionCheck: { prompt: string; choices: string[]; correctAnswer: string } };
    const leak = "What net ATP from glycolysis is used for includes active transport and muscle contraction.";
    if (field === "prompt") recovery.recognitionCheck.prompt += ` ${leak}`;
    else recovery.recognitionCheck.choices[recovery.recognitionCheck.choices.findIndex(choice => choice !== recovery.recognitionCheck.correctAnswer)] = leak;
    supply([{}, recovery]);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    await expect(generateStreamedTeachingSkeletonWithOpenAI(context)).rejects.toThrow(/streamed_deferred_content/);
  });

  it("keeps off-topic, deferred ATP use, and cross-target content outside the mapped subject", async () => {
    const { buildStreamedTargetSubjectReferences, validateStreamedTargetAssignments } = await import("./streamed-teaching-generator");
    const context = captures.membrane.context as SessionGenerationContext;
    const scope = { activeTargets: context.session.contentTargets!, deferredTargets: ["What net ATP from glycolysis is used for"] };
    const references = buildStreamedTargetSubjectReferences({ context, currentSessionScope: scope });
    for (const invalid of [
      "Photosynthesis converts sunlight into chemical energy in chloroplasts.",
      "Phospholipids form a hydrophobic core; net ATP from glycolysis is used for active transport and muscle contraction.",
      "Passive transport moves substances down their concentration gradient without energy.",
    ]) {
      expect(() => validateStreamedTargetAssignments({
        essentialIdeas: [invalid, "Passive transport moves down gradients while active transport uses ATP against gradients."],
        targetAssignments: [{ essentialIdea: invalid, targetId: "target_1" }, { essentialIdea: "Passive transport moves down gradients while active transport uses ATP against gradients.", targetId: "target_2" }],
        currentSessionScope: scope, targetSubjectReferences: references,
      })).toThrow();
    }
  });
});

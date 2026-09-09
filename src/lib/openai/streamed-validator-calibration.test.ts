import { beforeEach, describe, expect, it, vi } from "vitest";
import captures from "./__fixtures__/brief-0-5-validator-captures.json";
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
    expect(recognition?.choices).toEqual(["(fg)' = f'g + fg'", "(fg)' = f'g'", "(fg)' = f + g", "(fg)' = fg"]);
    expect(recognition?.correctAnswer).toBe("(fg)' = f'g + fg'");
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/product rule/i);
  });

  it("preserves both captured derivative claims when a symbolic answer establishes the first", async () => {
    supply(captures.product_chain.outputs);
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("./streamed-teaching-generator");
    const result = await generateStreamedTeachingSkeletonWithOpenAI(captures.product_chain.context as SessionGenerationContext);
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/Product rule/);
    expect(result.draft.coverage.essentialIdeas.join(" ")).toMatch(/Chain rule/);
    expect(result.draft.activities.filter(activity => activity.type === "free_response").map(activity => activity.correctAnswer).join(" ")).toContain("f g' + g f'");
  });

  it("recognizes a formula-only authoritative target while preserving different formulas", () => {
    expect(lessonIdeaSharesTargetSubject("The product rule states (fg)' equals f'g plus fg'.", "The formula (fg)' = f'g + fg'")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("For a product fg, the derivative is f'g + fg'.", "The formula (fg)' = f'g + fg'")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("f'g + fg'", "The formula (fg)' = f'g + fg'", "check")).toBe(true);
    expect(lessonIdeaSharesTargetSubject("(fg)' = f'g + fg' + h", "The formula (fg)' = f'g + fg'")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("Photosynthesis converts light into glucose.", "The formula (fg)' = f'g + fg'")).toBe(false);
    expect(lessonIdeaSharesTargetSubject("The formula (fg)' = f'g' multiplies the derivatives.", "The formula (fg)' = f'g + fg'")).toBe(false);
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
      const recovery = outputs[1] as typeof captures.formula.outputs[1] & { recognitionCheck: { choices: string[] } };
      recovery.recognitionCheck.choices[1] = duplicate;
      supply(outputs);
      await expect(generateStreamedTeachingSkeletonWithOpenAI(captures.formula.context as SessionGenerationContext)).rejects.toThrow(/bounded content schema/);
    }
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

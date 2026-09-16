import { describe, expect, it, vi } from "vitest";
import { SHAPE_SLOT_HONEST_ERROR, type CompareRequest, type DirectionRequest, type LearnBlockRequest, type PracticeRequest } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => { throw new Error("not used in tests"); } }));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => null }));

const { fillShapeSlot, ShapeSlotGenerationError, templateDirection } = await import("./shape-slot-generator");

const ids = { requestId: "11111111-1111-4111-8111-111111111111", recoveryKey: "22222222-2222-4222-8222-222222222222", planId: "33333333-3333-4333-8333-333333333333", planSessionId: "44444444-4444-4444-8444-444444444444" };
const topic = { id: "55555555-5555-4555-8555-555555555555", title: "Glycolysis", description: "How glucose is split into pyruvate with a net gain of ATP and NADH.", subtopics: [], taskType: "conceptual_learning" as const };
const modifiers = { instructionStyle: "standard" as const, questionMix: { recall: 1, application: 2, compare_contrast: 1, prediction: 0, misconception: 1 }, produceStep: "typed_explanation" as const, explanationFocus: "concept" as const, questionCap: 8, questionTarget: 5 };

type Slot = { slotId: string; type: string; keyPointIds: string[] };
type ProviderCall = { instructions: string; input: string };

function draft(slotId: string, overrides: Record<string, unknown> = {}) {
  return { slotId, prompt: `Which statement answers slot ${slotId}?`, choices: ["Alpha", "Beta", "Gamma", "Delta"], correctChoiceIndex: 1, explanation: "Beta is what the explanation states.", ...overrides };
}

const keyPoints = [
  { id: "k1", text: "Glycolysis splits one glucose into two pyruvate." },
  { id: "k2", text: "The pathway invests two ATP and produces four, a net gain of two." },
  { id: "k3", text: "NAD+ is reduced to NADH during the payoff phase." },
  { id: "k4", text: "Glycolysis takes place in the cytosol of every cell." },
  { id: "k5", text: "Without oxygen, pyruvate becomes lactate to regenerate NAD+." },
];

const explanation = "Glycolysis is the first stage of cellular respiration. It takes place in the cytosol and splits one six-carbon glucose into two three-carbon pyruvate molecules. The pathway first invests two ATP to phosphorylate glucose, then recovers four ATP in the payoff phase, for a net gain of two ATP. Along the way NAD+ is reduced to NADH, which carries electrons to later stages. For example, a muscle cell sprinting without enough oxygen still runs glycolysis and then turns pyruvate into lactate to regenerate NAD+.";
const structure = ["Glucose enters the cytosol", "Investment phase spends 2 ATP", "Payoff phase gains 4 ATP and 2 NADH", "Two pyruvate leave"];

function providerReturning(...results: Array<unknown | Error>) {
  const calls: unknown[] = [];
  const provider = vi.fn(async (call: unknown) => {
    calls.push(call);
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next ?? null;
  });
  return { provider, calls };
}

/** A stand-in for the model that follows the prompt: one question per slot the generator sent. */
function followingPrompt(shape: (slots: Slot[], call: ProviderCall) => unknown, failures: Array<Error | null> = []) {
  const calls: ProviderCall[] = [];
  const provider = vi.fn(async (call: ProviderCall) => {
    calls.push(call);
    const failure = failures.shift();
    if (failure) throw failure;
    return shape(JSON.parse(call.input).slots as Slot[], call);
  });
  return { provider, calls };
}
const slotsOf = (call: ProviderCall) => JSON.parse(call.input).slots as Slot[];

describe("Slot 2 — learn block in one call", () => {
  const request: LearnBlockRequest = { ...ids, action: "learn_block", topic, modifiers };
  const goodBlock = (slots: Slot[]) => ({ explanation, keyPoints, structure, questions: slots.map((slot) => draft(slot.slotId)) });

  it("returns the explanation, key points and questions from a single provider call, bound to code-planned slots", async () => {
    const { provider, calls } = followingPrompt(goodBlock);
    const result = await fillShapeSlot(request, provider as never);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("learn_block");
    if (result.action !== "learn_block") return;
    expect(result.keyPoints).toEqual(keyPoints);
    const slots = slotsOf(calls[0]!);
    expect(slots.map((slot) => slot.type)).toEqual(["recall", "application", "application", "compare_contrast", "misconception"]);
    expect(result.questions.map((question) => question.kind)).toEqual(slots.map((slot) => slot.type));
    expect(result.questions.map((question) => question.keyPointIds)).toEqual(slots.map((slot) => slot.keyPointIds));
  });

  it("tells the model the exact key points to derive and asks for plausible reasoning errors as distractors", async () => {
    const { provider, calls } = followingPrompt(goodBlock);
    await fillShapeSlot(request, provider as never);
    expect(calls[0]!.instructions).toContain("exactly 5 key points");
    expect(calls[0]!.instructions).toMatch(/plausible reasoning error/i);
  });

  it("rejects a draft that skips a planned slot, retries once, then errors honestly", async () => {
    const { provider } = followingPrompt((slots) => ({ explanation, keyPoints, structure, questions: slots.slice(1).map((slot) => draft(slot.slotId)) }));
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed", attempts: 2, message: SHAPE_SLOT_HONEST_ERROR });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("rejects a draft whose key points are not the ones the slots reference", async () => {
    const { provider } = followingPrompt((slots) => ({ ...goodBlock(slots), keyPoints: keyPoints.slice(0, 3) }));
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed" });
  });

  it("recovers on the single retry after a provider failure", async () => {
    const { provider } = followingPrompt(goodBlock, [new Error("timeout")]);
    const result = await fillShapeSlot(request, provider as never);
    expect(result.action).toBe("learn_block");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("never fabricates content when the provider is not configured", async () => {
    await expect(fillShapeSlot(request, null)).rejects.toBeInstanceOf(ShapeSlotGenerationError);
    await expect(fillShapeSlot(request, null)).rejects.toMatchObject({ code: "provider_unavailable", attempts: 0 });
  });

  it("caps questions from the profile and derives matching key points", async () => {
    const { provider, calls } = followingPrompt((slots) => ({ explanation, structure, keyPoints: keyPoints.slice(0, 3), questions: slots.map((slot) => draft(slot.slotId)) }));
    const result = await fillShapeSlot({ ...request, modifiers: { ...modifiers, questionCap: 3 } }, provider as never);
    expect(result.action === "learn_block" && result.questions).toHaveLength(3);
    expect(calls[0]!.instructions).toContain("exactly 3 key points");
  });
});

describe("Slot 1 — direction", () => {
  const request: DirectionRequest = { ...ids, action: "direction", topic, modifiers, source: { name: "Unit 3 slides", kind: "slides", location: "slides 12–20" }, entry: "study_full" };

  it("uses the generated two sentences when the provider answers", async () => {
    const { provider } = providerReturning({ whatToLookAt: "Review your Unit 3 slides on glycolysis.", howToApproach: "Read for the mechanism, not the terms." });
    const result = await fillShapeSlot(request, provider as never);
    expect(result).toEqual({ action: "direction", whatToLookAt: "Review your Unit 3 slides on glycolysis.", howToApproach: "Read for the mechanism, not the terms.", origin: "generated" });
  });

  it("falls back to an honest template naming the learner's own material when the provider is absent or fails twice", async () => {
    expect(await fillShapeSlot(request, null)).toEqual(templateDirection(request));
    const { provider } = providerReturning(new Error("down"), null);
    const result = await fillShapeSlot(request, provider as never);
    expect(result).toMatchObject({ origin: "template", whatToLookAt: "Review Unit 3 slides (slides 12–20) on Glycolysis." });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("template wording follows the produce step and source kind", () => {
    expect(templateDirection({ ...request, source: { name: "the video you added", kind: "video", location: null }, modifiers: { ...modifiers, produceStep: "concept_map" } })).toMatchObject({ whatToLookAt: "Watch the video you added on Glycolysis.", howToApproach: expect.stringContaining("map them") });
    expect(templateDirection({ ...request, entry: "brief_review" }).whatToLookAt).toMatch(/^Skim/);
  });
});

describe("Slot 3 — comparison is feedback, never a verdict", () => {
  const request: CompareRequest = { ...ids, action: "compare", topic, modifiers, produced: "Glucose becomes two pyruvate and makes ATP.", reference: { excerpts: [], keyPoints } };

  it("returns what is missing or wrong with no pass/fail field", async () => {
    const { provider } = providerReturning({ feedback: "You covered the split into pyruvate and the ATP gain, but you didn't mention NADH.", missing: ["NAD+ is reduced to NADH"], incorrect: [] });
    const result = await fillShapeSlot(request, provider as never);
    expect(result).toEqual({ action: "compare", feedback: "You covered the split into pyruvate and the ATP gain, but you didn't mention NADH.", missing: ["NAD+ is reduced to NADH"], incorrect: [] });
    expect(Object.keys(result)).not.toContain("verdict");
  });

  it("rejects verdict language and retries", async () => {
    const { provider } = providerReturning({ feedback: "You passed this check with a good score.", missing: [], incorrect: [] }, { feedback: "You named the products; the NADH step is still missing.", missing: ["NADH"], incorrect: [] });
    const result = await fillShapeSlot(request, provider as never);
    expect(result.action === "compare" && result.feedback).toBe("You named the products; the NADH step is still missing.");
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe("Slot 4 — fresh practice checked in code", () => {
  const supplied = keyPoints.slice(0, 3);
  const request: PracticeRequest = { ...ids, action: "practice", topic, modifiers, round: 1, keyPoints: supplied, outstandingKeyPointIds: [], excerpts: [], attempt: "66666666-6666-4666-8666-666666666666", roundKind: "active_recall", repairTargets: [] };
  const answer = (points: typeof keyPoints) => (slots: Slot[]) => ({ keyPoints: points, questions: slots.map((slot) => draft(slot.slotId)) });

  it("keeps the supplied key points and binds every question to a planned slot", async () => {
    const { provider, calls } = followingPrompt(answer(supplied));
    const result = await fillShapeSlot(request, provider as never);
    expect(result.action === "practice" && result.keyPoints).toEqual(supplied);
    expect(calls[0]!.instructions).toContain(request.attempt);
    if (result.action !== "practice") return;
    const slots = slotsOf(calls[0]!);
    expect(result.questions.map((question) => question.slotId)).toEqual(slots.map((slot) => slot.slotId));
    expect(new Set(result.questions.flatMap((question) => question.keyPointIds))).toEqual(new Set(["k1", "k2", "k3"]));
  });

  it("round 2 requests only the outstanding key points", async () => {
    const { provider, calls } = followingPrompt(answer([supplied[1]!]));
    const result = await fillShapeSlot({ ...request, round: 2, outstandingKeyPointIds: ["k2"] }, provider as never);
    expect(JSON.parse(calls[0]!.input).keyPoints).toEqual([supplied[1]]);
    expect(result.action === "practice" && result.questions.every((item) => item.keyPointIds.every((id) => id === "k2"))).toBe(true);
  });

  // Brief 1.5 item 1: the ordinary retry. A model that follows the prompt must not be rejected.
  it.each([
    { missed: ["k2"], label: "one-point" },
    { missed: ["k1", "k3"], label: "two-point" },
  ])("a $label retry succeeds on the first call with one question per missed point", async ({ missed }) => {
    const { provider, calls } = followingPrompt(answer(supplied.filter((item) => missed.includes(item.id))));
    const result = await fillShapeSlot({ ...request, round: 2, outstandingKeyPointIds: missed }, provider as never);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.action === "practice" && result.questions).toHaveLength(missed.length);
    expect(result.action === "practice" && new Set(result.questions.flatMap((item) => item.keyPointIds))).toEqual(new Set(missed));
    expect(calls[0]!.instructions).toContain(`exactly ${missed.length} question`);
  });

  it("a one-point retry only plans one-point question types", async () => {
    const { provider, calls } = followingPrompt(answer([supplied[1]!]));
    await fillShapeSlot({ ...request, round: 2, outstandingKeyPointIds: ["k2"] }, provider as never);
    expect(slotsOf(calls[0]!).map((slot) => slot.type)).not.toEqual(expect.arrayContaining(["application"]));
    expect(slotsOf(calls[0]!).every((slot) => slot.keyPointIds.length === 1)).toBe(true);
  });

  it("derives exactly the planned number of key points from the topic when none are supplied", async () => {
    const { provider, calls } = followingPrompt(answer(keyPoints));
    const result = await fillShapeSlot({ ...request, keyPoints: [] }, provider as never);
    expect(calls[0]!.instructions).toContain("exactly 5 key points");
    expect(result.action === "practice" && result.keyPoints).toEqual(keyPoints);
  });

  it("rejects a provider that invents key point ids", async () => {
    const { provider } = followingPrompt((slots) => ({ keyPoints: [{ id: "zzz", text: "Something not in the learn block." }], questions: slots.map((slot) => draft(slot.slotId)) }));
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed" });
  });
});

// Brief 1.5 item 3: each practice label is a different round, not a relabel.
describe("Slot 4 — practice round kinds", () => {
  const supplied = keyPoints.slice(0, 3);
  const base: PracticeRequest = { ...ids, action: "practice", topic, modifiers: { ...modifiers, questionCap: 5 }, round: 1, keyPoints: supplied, outstandingKeyPointIds: [], excerpts: [], attempt: "77777777-7777-4777-8777-777777777777", roundKind: "active_recall", repairTargets: [] };
  const answer = (points: typeof keyPoints) => (slots: Slot[]) => ({ keyPoints: points, questions: slots.map((slot) => draft(slot.slotId)) });

  it("a Practice Test asks a longer exam-style set of eight, even when the profile caps rounds at five", async () => {
    const { provider, calls } = followingPrompt(answer(supplied));
    const result = await fillShapeSlot({ ...base, roundKind: "practice_test" }, provider as never);
    expect(result.action === "practice" && result.questions).toHaveLength(8);
    expect(calls[0]!.instructions).toMatch(/exam/i);
  });

  it("Error Repair sends each missed question and the answer chosen, and asks for the same reasoning error", async () => {
    const repairTargets = [{ keyPointId: "k2", question: "What is the net ATP gain of glycolysis?", chosenAnswer: "Four", correctAnswer: "Two" }];
    const { provider, calls } = followingPrompt(answer([supplied[1]!]));
    const result = await fillShapeSlot({ ...base, round: 2, outstandingKeyPointIds: ["k2"], roundKind: "error_repair", repairTargets }, provider as never);
    expect(result.action === "practice" && result.questions).toHaveLength(1);
    expect(JSON.parse(calls[0]!.input).repairTargets).toEqual(repairTargets);
    expect(calls[0]!.instructions).toMatch(/same reasoning error/i);
  });

  it("an Interleaved Review asks the learner to decide which idea applies across topics", async () => {
    const { provider, calls } = followingPrompt(answer(supplied));
    await fillShapeSlot({ ...base, roundKind: "interleaved_review" }, provider as never);
    expect(calls[0]!.instructions).toMatch(/which idea applies/i);
  });

  it("Active Recall keeps the ordinary framing", async () => {
    const { provider, calls } = followingPrompt(answer(supplied));
    await fillShapeSlot(base, provider as never);
    expect(calls[0]!.instructions).not.toMatch(/exam|same reasoning error|which idea applies/i);
  });
});

// Brief 1.5 item 4: a high-difficulty topic asks more questions.
describe("Slot 2 and Slot 4 — question target", () => {
  it("a learn block for a high-difficulty topic plans eight questions", async () => {
    const { provider, calls } = followingPrompt((slots) => ({ explanation, structure, keyPoints, questions: slots.map((slot) => draft(slot.slotId)) }));
    const result = await fillShapeSlot({ ...ids, action: "learn_block", topic, modifiers: { ...modifiers, questionCap: 8, questionTarget: 8 } }, provider as never);
    expect(result.action === "learn_block" && result.questions).toHaveLength(8);
    expect(slotsOf(calls[0]!)).toHaveLength(8);
  });

  it("an ordinary topic keeps five", async () => {
    const { provider, calls } = followingPrompt((slots) => ({ explanation, structure, keyPoints, questions: slots.map((slot) => draft(slot.slotId)) }));
    await fillShapeSlot({ ...ids, action: "learn_block", topic, modifiers: { ...modifiers, questionTarget: 5 } }, provider as never);
    expect(slotsOf(calls[0]!)).toHaveLength(5);
  });
});


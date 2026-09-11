import { describe, expect, it, vi } from "vitest";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
import { SHAPE_SLOT_HONEST_ERROR, type CompareRequest, type DirectionRequest, type LearnBlockRequest, type PracticeRequest } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => { throw new Error("not used in tests"); } }));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => null }));

const { fillShapeSlot, ShapeSlotGenerationError, templateDirection } = await import("./shape-slot-generator");

const ids = { requestId: "11111111-1111-4111-8111-111111111111", recoveryKey: "22222222-2222-4222-8222-222222222222", planId: "33333333-3333-4333-8333-333333333333", planSessionId: "44444444-4444-4444-8444-444444444444" };
const topic = { id: "55555555-5555-4555-8555-555555555555", title: "Glycolysis", description: "How glucose is split into pyruvate with a net gain of ATP and NADH.", subtopics: [], taskType: "conceptual_learning" as const };
const modifiers = { instructionStyle: "standard" as const, weighting: "relationships_first" as const, produceStep: "typed_explanation" as const, explanationFocus: "concept" as const, questionCap: 8 };

function question(id: string, keyPointId: string, kind: PracticeQuestion["kind"] = "relationship"): PracticeQuestion {
  return { id, keyPointId, kind, prompt: `Which statement about ${keyPointId} is right?`, choices: ["Alpha", "Beta", "Gamma", "Delta"], correctChoiceIndex: 1, explanation: "Beta is what the explanation states." };
}

const keyPoints = [
  { id: "k1", text: "Glycolysis splits one glucose into two pyruvate." },
  { id: "k2", text: "The pathway invests two ATP and produces four, a net gain of two." },
  { id: "k3", text: "NAD+ is reduced to NADH during the payoff phase." },
];

const goodLearnBlock = {
  explanation: "Glycolysis is the first stage of cellular respiration. It takes place in the cytosol and splits one six-carbon glucose into two three-carbon pyruvate molecules. The pathway first invests two ATP to phosphorylate glucose, then recovers four ATP in the payoff phase, for a net gain of two ATP. Along the way NAD+ is reduced to NADH, which carries electrons to later stages. For example, a muscle cell sprinting without enough oxygen still runs glycolysis and then turns pyruvate into lactate to regenerate NAD+.",
  keyPoints,
  questions: [question("q1", "k1"), question("q2", "k2", "term"), question("q3", "k3")],
  structure: ["Glucose enters the cytosol", "Investment phase spends 2 ATP", "Payoff phase gains 4 ATP and 2 NADH", "Two pyruvate leave"],
};

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

describe("Slot 2 — learn block in one call", () => {
  const request: LearnBlockRequest = { ...ids, action: "learn_block", topic, modifiers };

  it("returns the explanation, key points and questions from a single provider call", async () => {
    const { provider } = providerReturning(goodLearnBlock);
    const result = await fillShapeSlot(request, provider as never);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("learn_block");
    if (result.action !== "learn_block") return;
    expect(result.keyPoints).toEqual(keyPoints);
    expect(result.questions.map((item) => item.keyPointId)).toEqual(["k1", "k3", "k2"]);
  });

  it("rejects a draft whose questions test something the explanation's key points do not cover, retries once, then errors honestly", async () => {
    const outside = { ...goodLearnBlock, questions: [question("q1", "k1"), question("q2", "k2"), question("q9", "not-covered")] };
    const { provider } = providerReturning(outside, outside);
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed", attempts: 2, message: SHAPE_SLOT_HONEST_ERROR });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("recovers on the single retry after a provider failure", async () => {
    const { provider } = providerReturning(new Error("timeout"), goodLearnBlock);
    const result = await fillShapeSlot(request, provider as never);
    expect(result.action).toBe("learn_block");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("never fabricates content when the provider is not configured", async () => {
    await expect(fillShapeSlot(request, null)).rejects.toBeInstanceOf(ShapeSlotGenerationError);
    await expect(fillShapeSlot(request, null)).rejects.toMatchObject({ code: "provider_unavailable", attempts: 0 });
  });

  it("caps questions from the profile", async () => {
    const many = { ...goodLearnBlock, keyPoints: [...keyPoints, { id: "k4", text: "Pyruvate is converted to lactate when oxygen is scarce." }, { id: "k5", text: "Glycolysis happens in the cytosol of every cell." }], questions: [question("q1", "k1"), question("q2", "k2"), question("q3", "k3"), question("q4", "k4"), question("q5", "k5")] };
    const { provider } = providerReturning(many);
    const result = await fillShapeSlot({ ...request, modifiers: { ...modifiers, questionCap: 3 } }, provider as never);
    expect(result.action === "learn_block" && result.questions).toHaveLength(3);
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
  const request: PracticeRequest = { ...ids, action: "practice", topic, modifiers, round: 1, keyPoints, outstandingKeyPointIds: [], excerpts: [], attempt: "66666666-6666-4666-8666-666666666666" };

  it("keeps the supplied key points and binds every question to one of them", async () => {
    const { provider, calls } = providerReturning({ keyPoints, questions: [question("p1", "k1"), question("p2", "k2"), question("p3", "k3")] });
    const result = await fillShapeSlot(request, provider as never);
    expect(result.action === "practice" && result.keyPoints).toEqual(keyPoints);
    expect((calls[0] as { instructions: string }).instructions).toContain(request.attempt);
  });

  it("round 2 requests only the outstanding key points", async () => {
    const { provider, calls } = providerReturning({ keyPoints: [keyPoints[1]], questions: [question("p4", "k2"), question("p5", "k2"), question("p6", "k2")] });
    const result = await fillShapeSlot({ ...request, round: 2, outstandingKeyPointIds: ["k2"] }, provider as never);
    expect(JSON.parse((calls[0] as { input: string }).input).keyPoints).toEqual([keyPoints[1]]);
    expect(result.action === "practice" && result.questions.every((item) => item.keyPointId === "k2")).toBe(true);
  });

  it("derives key points from the topic when none are supplied", async () => {
    const derived = [{ id: "k1", text: "Glycolysis splits glucose into two pyruvate." }, { id: "k2", text: "Net gain is two ATP." }, { id: "k3", text: "NADH is produced." }];
    const { provider } = providerReturning({ keyPoints: derived, questions: [question("p1", "k1"), question("p2", "k2"), question("p3", "k3")] });
    const result = await fillShapeSlot({ ...request, keyPoints: [] }, provider as never);
    expect(result.action === "practice" && result.keyPoints).toEqual(derived);
  });

  it("rejects a provider that invents key point ids", async () => {
    const invented = { keyPoints: [{ id: "zzz", text: "Something not in the learn block." }], questions: [question("p1", "zzz"), question("p2", "k1"), question("p3", "k2")] };
    const { provider } = providerReturning(invented, invented);
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed" });
  });
});

import { describe, expect, it, vi } from "vitest";
import sample from "./fixtures/ci410-invalid-osmosis-question.json";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => { throw new Error("not used"); } }));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => null }));
import { fillShapeSlot, type SlotProviderCall } from "./shape-slot-generator";
import type { PracticeRequest } from "@/lib/session-shapes/slots-schema";

const request = {
  action: "practice", requestId: "11111111-1111-4111-8111-111111111111", recoveryKey: "22222222-2222-4222-8222-222222222222",
  planId: "33333333-3333-4333-8333-333333333333", planSessionId: "44444444-4444-4444-8444-444444444444",
  topic: sample.topic, modifiers: { instructionStyle: "standard", questionMix: { recall: 0, application: 1, compare_contrast: 0, prediction: 0, misconception: 0 }, produceStep: null, explanationFocus: null, questionCap: 1, questionTarget: 1 },
  tips: [], round: 1, keyPoints: sample.keyPoints, outstandingKeyPointIds: [], excerpts: [], attempt: "55555555-5555-4555-8555-555555555555", roundKind: "active_recall", repairTargets: [],
} as PracticeRequest;
const bad = { slotId: "s1", prompt: sample.question.prompt, choices: sample.question.choices, correctChoiceIndex: sample.question.correctChoiceIndex, explanation: sample.question.explanation };
const good = { ...bad, choices: [...bad.choices.slice(0, 3), "Water moves from side A to side B because dilute solutions have higher water potential."], correctChoiceIndex: 3 };

function fixture(repairWorks: boolean) {
  return vi.fn(async (call: SlotProviderCall<unknown>) => {
    const input = JSON.parse(call.input);
    if (call.schemaName === "yova_practice_quality_review") {
      return { reviews: input.questions.map((question: { slotId: string; choices: string[] }) => {
        const index = question.choices.indexOf(good.choices[3]);
        return { slotId: question.slotId, answerIndices: index >= 0 ? [index] : [], issue: index >= 0 ? "none" : "ambiguous", reason: "Water moves A to B from higher to lower water potential; the reason and direction must both match.", duplicateOfSlotId: null };
      }) };
    }
    return { keyPoints: sample.keyPoints, questions: [input.qualityIssues && repairWorks ? good : bad], tips: [] };
  });
}

describe("MCQ quality gate before delivery", () => {
  it("repairs the actual no-correct-option CI failure and independently rechecks the replacement", async () => {
    const provider = fixture(true);
    const response = await fillShapeSlot(request, provider as never);
    if (response.action !== "practice") throw new Error("Expected practice");
    const question = response.questions[0]!;
    expect(question.choices[question.correctChoiceIndex]).toBe(good.choices[3]);
    expect(provider.mock.calls.filter(([call]) => call.schemaName === "yova_practice_quality_review")).toHaveLength(2);
    expect(provider.mock.calls.filter(([call]) => JSON.parse(call.input).qualityIssues)).toHaveLength(1);
  });

  it("never delivers an invalid repair and does not create an endless repair loop", async () => {
    const provider = fixture(false);
    await expect(fillShapeSlot(request, provider as never)).rejects.toMatchObject({ code: "generation_failed" });
    expect(provider).toHaveBeenCalledTimes(4);
  });

  it("keeps the learner's missed-answer context when the quality gate replaces a one-point retry", async () => {
    const repairTargets = [{ keyPointId: "k2", question: "Why does water move from side A to side B?", chosenAnswer: "Water moves toward higher water potential.", correctAnswer: "Water moves toward lower water potential." }];
    const provider = fixture(true);
    const response = await fillShapeSlot({ ...request, round: 2, roundKind: "error_repair", outstandingKeyPointIds: ["k2"], repairTargets }, provider as never);
    if (response.action !== "practice") throw new Error("Expected practice");
    expect(response.questions).toHaveLength(1);
    expect(response.questions[0]!.keyPointIds).toEqual(["k2"]);
    const replacement = provider.mock.calls.find(([call]) => JSON.parse(call.input).qualityIssues)![0];
    expect(JSON.parse(replacement.input)).toMatchObject({ round: 2, roundKind: "error_repair", repairTargets });
    expect(provider).toHaveBeenCalledTimes(4);
  });

  it("preserves retry context in later batches and their bounded collision repair", async () => {
    const keyPoints = Array.from({ length: 9 }, (_, index) => ({ id: `k${index + 1}`, text: `Osmosis key point ${index + 1}: water moves from higher to lower water potential.` }));
    const repairTargets = [{ keyPointId: "k9", question: "Why does water move from side A to side B?", chosenAnswer: "Water moves toward higher water potential.", correctAnswer: "Water moves toward lower water potential." }];
    const provider = vi.fn(async (call: SlotProviderCall<unknown>) => {
      const input = JSON.parse(call.input);
      if (call.schemaName === "yova_practice_quality_review") {
        return { reviews: input.questions.map((question: { slotId: string; choices: string[] }) => ({ slotId: question.slotId, answerIndices: [question.choices.indexOf(good.choices[3])], issue: "none", reason: "", duplicateOfSlotId: null })) };
      }
      return { keyPoints, tips: [], questions: input.slots.map((slot: { slotId: string }) => ({ ...good, slotId: slot.slotId, prompt: `Explain the osmosis direction in case ${slot.slotId === "s9" && !input.collisionRepair ? "s1" : slot.slotId}.` })) };
    });
    const response = await fillShapeSlot({ ...request, modifiers: { ...request.modifiers, questionCap: 9, questionTarget: 9 }, keyPoints, outstandingKeyPointIds: keyPoints.map(point => point.id), round: 2, roundKind: "error_repair", repairTargets }, provider as never);
    if (response.action !== "practice") throw new Error("Expected practice");
    expect(response.questions).toHaveLength(9);
    expect(new Set(response.questions.map(question => question.prompt)).size).toBe(9);
    const batches = provider.mock.calls.filter(([call]) => call.schemaName === "yova_shape_question_batch").map(([call]) => JSON.parse(call.input));
    expect(batches).toHaveLength(2);
    expect(batches.map(batch => batch.collisionRepair)).toEqual([false, true]);
    for (const batch of batches) {
      expect(batch).toMatchObject({ round: 2, roundKind: "error_repair", repairTargets });
      expect(batch.slots).toEqual([expect.objectContaining({ slotId: "s9" })]);
    }
    expect(provider).toHaveBeenCalledTimes(4);
  });
});

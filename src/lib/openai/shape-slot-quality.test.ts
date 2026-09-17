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
});

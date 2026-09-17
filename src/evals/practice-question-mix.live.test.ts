import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
import { TASK_TYPE_QUESTION_MIX, TWO_POINT_QUESTION_TYPES } from "@/lib/practice/question-mix";
import type { LearnBlockRequest, PracticeRequest } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));
const { fillShapeSlot, openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");

/**
 * Brief 1.5 item 2, live. New in this brief: the brief referred to an existing
 * study-guide live test, which had never been written. The 11 Sept audit found
 * 0/9 conceptual questions requiring transfer. Every conceptual round from the
 * real model must include at least one non-recall question, two-point types
 * must span two key points, and no question may simply restate a key point.
 */
const topic = {
  id: "7a1c1d5e-2f0b-4c3a-9d1e-5b6f7a8c9d0e",
  title: "Osmosis and water potential",
  description: "How water moves across a partially permeable membrane from higher to lower water potential, and what that does to plant and animal cells.",
  subtopics: ["Water potential", "Hypotonic, isotonic and hypertonic solutions", "Turgor and plasmolysis"],
  taskType: "conceptual_learning" as const,
};
const modifiers = { instructionStyle: "standard" as const, questionMix: TASK_TYPE_QUESTION_MIX.conceptual_learning, produceStep: "typed_explanation" as const, explanationFocus: "concept" as const, questionCap: 8, questionTarget: 5 };
const ids = () => ({ requestId: randomUUID(), recoveryKey: randomUUID(), planId: randomUUID(), planSessionId: randomUUID(), tips: [] });
const studyGuideExcerpt = {
  label: "Unit 2 study guide, osmosis",
  text: "Osmosis is the net movement of water molecules across a partially permeable membrane from a region of higher water potential to a region of lower water potential. Pure water has a water potential of zero; adding solute makes it negative. A plant cell placed in a solution with a lower water potential than its cytoplasm loses water, the vacuole shrinks and the membrane pulls away from the wall: plasmolysis. In a solution with a higher water potential the cell gains water until the wall resists further expansion, and the cell becomes turgid. Animal cells have no wall, so in a solution of much higher water potential they swell and can burst, and in a solution of lower water potential they shrink and crenate.",
};

function assertTransferMix(questions: PracticeQuestion[], keyPoints: Array<{ id: string; text: string }>) {
  expect(questions.filter((question) => question.kind !== "recall").length, "at least one non-recall question").toBeGreaterThanOrEqual(1);
  for (const question of questions) {
    expect(question.keyPointIds).toHaveLength(TWO_POINT_QUESTION_TYPES.includes(question.kind) ? 2 : 1);
    for (const keyPoint of keyPoints) {
      expect(question.prompt.toLocaleLowerCase(), `${question.kind} question restates key point ${keyPoint.id}`).not.toContain(keyPoint.text.toLocaleLowerCase());
    }
  }
}

describe.skipIf(process.env.YOVA_RUN_LIVE_QUESTION_MIX !== "1")("Brief 1.5 live question-type mix", () => {
  const printout: Record<string, unknown> = {};

  it("a conceptual learn block round includes non-recall questions that span two key points", async () => {
    const provider = openAIShapeSlotProvider();
    expect(provider, "OPENAI_API_KEY is required for this live case").not.toBeNull();
    const request: LearnBlockRequest = { ...ids(), action: "learn_block", topic, modifiers };
    const result = await fillShapeSlot(request, provider);
    expect(result.action).toBe("learn_block");
    if (result.action !== "learn_block") return;
    assertTransferMix(result.questions, result.keyPoints);
    printout.learnBlock = { keyPoints: result.keyPoints, questions: result.questions.map(({ kind, keyPointIds, prompt, choices, correctChoiceIndex }) => ({ kind, keyPointIds, prompt, choices, correctChoiceIndex })) };
  }, 120_000);

  it("a conceptual practice round from a study-guide excerpt includes non-recall questions that span two key points", async () => {
    const provider = openAIShapeSlotProvider();
    expect(provider, "OPENAI_API_KEY is required for this live case").not.toBeNull();
    const request: PracticeRequest = { ...ids(), action: "practice", topic, modifiers, round: 1, keyPoints: [], outstandingKeyPointIds: [], excerpts: [studyGuideExcerpt], attempt: randomUUID(), roundKind: "active_recall", repairTargets: [] };
    const result = await fillShapeSlot(request, provider);
    expect(result.action).toBe("practice");
    if (result.action !== "practice") return;
    assertTransferMix(result.questions, result.keyPoints);
    printout.practice = { keyPoints: result.keyPoints, questions: result.questions.map(({ kind, keyPointIds, prompt, choices, correctChoiceIndex }) => ({ kind, keyPointIds, prompt, choices, correctChoiceIndex })) };
    if (process.env.YOVA_QUESTION_MIX_PRINTOUT) writeFileSync(process.env.YOVA_QUESTION_MIX_PRINTOUT, JSON.stringify(printout, null, 2));
  }, 120_000);
});

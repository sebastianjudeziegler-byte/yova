import { describe, expect, it, vi } from "vitest";
import sample from "@/lib/openai/fixtures/ci410-invalid-osmosis-question.json";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
vi.mock("server-only", () => ({}));

describe.skipIf(process.env.YOVA_RUN_LIVE_PRACTICE_QUALITY !== "1")("live MCQ answer quality regression", () => {
  it("finds the actual CI410 no-correct-option failure and accepts a sound replacement", async () => {
    const { reviewPracticeQuestions } = await import("@/lib/openai/practice-quality-review");
    const { openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");
    const provider = openAIShapeSlotProvider();
    expect(provider, "Live answer review requires a configured provider").not.toBeNull();
    if (!provider) return;
    const question = sample.question as PracticeQuestion;
    const context = { topic: sample.topic, explanation: sample.explanation, keyPoints: sample.keyPoints };
    const failed = await reviewPracticeQuestions({ ...context, questions: [question] }, provider);
    console.info("Retained synthetic CI410 failure:", JSON.stringify(failed));
    expect(failed).toMatchObject({ ok: true, rejected: [{ slotId: question.slotId }] });
    const replacement: PracticeQuestion = { ...question,
      prompt: "Two compartments at equal temperature and pressure contain the same dissolved solute, which cannot cross their water-permeable membrane. A is more dilute than B. Which initial net movement and reason are correct?",
      choices: [
        "Water moves A to B because A has higher water potential.",
        "Water moves B to A because dissolved solute pushes water toward the dilute side.",
        "There is no net water movement because the membrane blocks the dissolved solute.",
        "Water moves B to A because adding solute raises water potential.",
      ], correctChoiceIndex: 0,
      explanation: "At equal pressure for the same solute, A has higher water potential; water crosses the membrane from A to B while the solute stays on its own side.",
    };
    const passed = await reviewPracticeQuestions({ ...context, questions: [replacement] }, provider);
    console.info("Explicit-condition replacement:", JSON.stringify(passed));
    expect(passed).toEqual({ ok: true, rejected: [] });
  }, 60_000);
});

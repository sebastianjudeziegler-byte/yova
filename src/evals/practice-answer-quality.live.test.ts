import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import sample from "@/lib/openai/fixtures/ci410-invalid-osmosis-question.json";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
vi.mock("server-only", () => ({}));

/**
 * The CI #410 canary, sampled (founder decision, 18 Sept 2026). One review is
 * one draw from a model, and a single draw both passed and failed on identical
 * code in runs 423 and 424, so one sample cannot say how reliable the reviewer
 * is. Each run now reviews the retained question that has no fully correct
 * option SAMPLES times, and its corrected replacement SAMPLES times, each on a
 * fresh provider, and requires the reviewer to be right on most of them. Both
 * rates are printed and written to artifacts/quality/canary-hit-rate.json:
 * how often it catches the bad question, and how often it wrongly rejects the
 * sound one.
 */
const SAMPLES = 5;
const REQUIRED = 4;

describe.skipIf(process.env.YOVA_RUN_LIVE_PRACTICE_QUALITY !== "1")("live MCQ answer quality regression", () => {
  it(`catches the CI410 no-correct-option question in at least ${REQUIRED} of ${SAMPLES} reviews and accepts its sound replacement as often`, async () => {
    const { reviewPracticeQuestions } = await import("@/lib/openai/practice-quality-review");
    const { openAIShapeSlotProvider } = await import("@/lib/openai/shape-slot-generator");
    expect(openAIShapeSlotProvider(), "Live answer review requires a configured provider").not.toBeNull();
    const question = sample.question as PracticeQuestion;
    const context = { topic: sample.topic, explanation: sample.explanation, keyPoints: sample.keyPoints };
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
    // A fresh provider per review: each draw has its own budget and nothing is shared.
    const review = (target: PracticeQuestion) => reviewPracticeQuestions({ ...context, questions: [target] }, openAIShapeSlotProvider()!);
    const [bad, good] = await Promise.all([
      Promise.all(Array.from({ length: SAMPLES }, () => review(question))),
      Promise.all(Array.from({ length: SAMPLES }, () => review(replacement))),
    ]);
    const caught = bad.filter(result => result.ok && result.rejected.some(issue => issue.slotId === question.slotId)).length;
    const accepted = good.filter(result => result.ok && result.rejected.length === 0).length;
    const rates = {
      samples: SAMPLES, required: REQUIRED,
      badQuestionCaught: caught,
      badQuestionMissed: bad.filter(result => result.ok && result.rejected.length === 0).length,
      soundReplacementAccepted: accepted,
      soundReplacementWronglyRejected: good.filter(result => result.ok && result.rejected.length > 0).length,
      unusableReplies: [...bad, ...good].filter(result => !result.ok).length,
    };
    console.info("CI410 canary hit rate:", JSON.stringify(rates));
    mkdirSync(resolve("artifacts/quality"), { recursive: true });
    writeFileSync(resolve("artifacts/quality/canary-hit-rate.json"), JSON.stringify({ ...rates, bad, good }, null, 2));
    expect(caught, `caught the retained invalid question in ${caught} of ${SAMPLES} reviews`).toBeGreaterThanOrEqual(REQUIRED);
    expect(accepted, `accepted the sound replacement in ${accepted} of ${SAMPLES} reviews`).toBeGreaterThanOrEqual(REQUIRED);
  }, 120_000);
});

import type { PracticeRoundKind } from "./practice-rounds";
import { planQuestionSlots, type QuestionMix, type QuestionSlot, type QuestionType } from "./question-mix";

/**
 * A long first pass of practice is one sitting in parts of at most eight
 * questions (founder decision, 18 Sept 2026: option B). Each part is generated
 * and independently reviewed on its own request, which keeps every request
 * inside the provider budget: one 32-question generation chained five model
 * stages and failed at the 50-second wall in CI runs 420-428.
 *
 * The session's size still follows the learner's profile: a 32-question
 * workload is still 32 questions, delivered as four parts. The parts are built
 * up, not shuffled: recall first, then application, prediction and comparison.
 */
export const PRACTICE_PART_SIZE = 8;

/** Easiest first. Misconception checks a single point, so it sits with recall. */
const SCAFFOLD_ORDER: readonly QuestionType[] = ["recall", "misconception", "application", "prediction", "compare_contrast"];

/** Near-equal parts of at most eight: 32 → [8,8,8,8], 20 → [7,7,6], 10 → [5,5]. */
export function practicePartSizes(total: number): number[] {
  if (total <= 0) return [];
  const count = Math.ceil(total / PRACTICE_PART_SIZE);
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => base + (index < total % count ? 1 : 0));
}

/** Every planned slot exactly once, easiest first, cut into near-equal parts. */
export function scaffoldedParts(slots: readonly QuestionSlot[]): QuestionSlot[][] {
  const ordered = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => SCAFFOLD_ORDER.indexOf(a.slot.type) - SCAFFOLD_ORDER.indexOf(b.slot.type) || a.index - b.index)
    .map(({ slot }) => slot);
  const parts: QuestionSlot[][] = [];
  let start = 0;
  for (const size of practicePartSizes(ordered.length)) {
    parts.push(ordered.slice(start, start + size));
    start += size;
  }
  return parts;
}

/** One part of a first pass. Deterministic, so every request recomputes the same plan. */
export function scaffoldedPart(plan: { keyPointIds: readonly string[]; mix: QuestionMix; count: number }, partIndex: number): QuestionSlot[] {
  const parts = scaffoldedParts(planQuestionSlots(plan));
  const part = parts[partIndex - 1];
  if (!part) throw new Error(`Practice part ${partIndex} is outside this plan's ${parts.length} parts.`);
  return part;
}

/**
 * How many parts the first pass has. A practice test that is not sized by a
 * saved workload is always one part of eight; everything else follows the
 * round's target.
 */
export function firstPassPartCount({ roundKind, questionTarget, workloadBounded }: { roundKind: PracticeRoundKind; questionTarget: number; workloadBounded?: boolean }): number {
  if (roundKind === "practice_test" && !workloadBounded) return 1;
  return Math.max(1, practicePartSizes(questionTarget).length);
}

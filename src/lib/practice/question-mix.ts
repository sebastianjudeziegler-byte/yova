import type { LearningTaskType } from "@/lib/learning/method-catalog";

/**
 * Question-type mix (Brief 1.5 item 2). Code decides which kinds of question a
 * round asks and which key points each may draw on; the model only writes the
 * question for each slot. Task type first, then profile (02-ROUTING Layer 4).
 */
export const QUESTION_TYPES = ["recall", "application", "compare_contrast", "prediction", "misconception"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Learner-facing names. */
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  recall: "Recall",
  application: "Application",
  compare_contrast: "Compare and contrast",
  prediction: "Prediction",
  misconception: "Misconception",
};

/** "2 recall, 1 application, 1 compare and contrast, 1 misconception" for a mix. */
export function describeQuestionMix(source: QuestionMix) {
  return QUESTION_TYPES.filter((type) => source[type] > 0).map((type) => `${source[type]} ${QUESTION_TYPE_LABEL[type].toLocaleLowerCase()}`).join(", ");
}

/** Types that must span two key points; recall and misconception span one. */
export const TWO_POINT_QUESTION_TYPES: readonly QuestionType[] = ["application", "compare_contrast", "prediction"];

/** Counts per type for a five-question round. */
export type QuestionMix = Record<QuestionType, number>;
export const BASE_MIX_SIZE = 5;

const mix = (recall: number, application: number, compare_contrast: number, prediction: number, misconception: number): QuestionMix => ({ recall, application, compare_contrast, prediction, misconception });

export const TASK_TYPE_QUESTION_MIX: Record<LearningTaskType, QuestionMix> = {
  memorization: mix(4, 0, 0, 0, 1),
  conceptual_learning: mix(1, 2, 1, 0, 1),
  reading_to_quiz: mix(2, 1, 0, 1, 1),
  problem_solving: mix(1, 3, 0, 0, 1),
  programming: mix(1, 3, 0, 0, 1),
  writing_argumentation: mix(1, 0, 2, 1, 1),
  mixed_assessment: mix(2, 1, 1, 0, 1),
};

/** The type that gives up an item when the profile shifts the mix; misconception goes last so a round keeps it while it can. */
const SHIFT_DONOR_ORDER: readonly QuestionType[] = ["application", "compare_contrast", "prediction", "recall", "misconception"];

export type Q7GistDetail = "gist_leaning" | "detail_leaning" | "balanced" | null;

export function questionMixFor({ taskType, q7 }: { taskType: LearningTaskType; q7: Q7GistDetail }): { mix: QuestionMix; ruleIds: string[] } {
  const base = TASK_TYPE_QUESTION_MIX[taskType];
  const ruleIds = [`L4.mix.${taskType}`];
  if (q7 === "gist_leaning") return { mix: shiftOne(base, "recall"), ruleIds: [...ruleIds, "L4.q7.gist_leaning.mix_recall"] };
  if (q7 === "detail_leaning") return { mix: shiftOne(base, "compare_contrast"), ruleIds: [...ruleIds, "L4.q7.detail_leaning.mix_compare_contrast"] };
  return { mix: { ...base }, ruleIds };
}

/** Moves one item toward `target` from the largest other type (ties by SHIFT_DONOR_ORDER). */
function shiftOne(base: QuestionMix, target: QuestionType): QuestionMix {
  const donor = SHIFT_DONOR_ORDER
    .filter((type) => type !== target && base[type] > 0)
    .reduce<QuestionType | null>((best, type) => (best === null || base[type] > base[best] ? type : best), null);
  if (!donor) return { ...base };
  return { ...base, [donor]: base[donor] - 1, [target]: base[target] + 1 };
}

/**
 * Scales a five-question mix to `count` by largest remainder (ties by
 * QUESTION_TYPES order) and returns the flat generation order: types in
 * QUESTION_TYPES order.
 */
export function scaleQuestionMix(source: QuestionMix, count: number): QuestionType[] {
  const size = QUESTION_TYPES.reduce((sum, type) => sum + source[type], 0) || BASE_MIX_SIZE;
  const exact = QUESTION_TYPES.map((type) => ({ type, value: (source[type] * count) / size }));
  const counts = new Map(exact.map(({ type, value }) => [type, Math.floor(value)]));
  let remaining = count - [...counts.values()].reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((entry, index) => ({ ...entry, index, fraction: entry.value - Math.floor(entry.value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    if (entry.fraction <= 0 && source[entry.type] === 0) continue;
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    remaining -= 1;
  }
  // A mix with too few non-zero types to fill the count tops up recall.
  if (remaining > 0) counts.set("recall", (counts.get("recall") ?? 0) + remaining);
  return QUESTION_TYPES.flatMap((type) => Array.from({ length: counts.get(type) ?? 0 }, () => type));
}

export type QuestionSlot = { slotId: string; type: QuestionType; keyPointIds: string[] };

/**
 * Assigns each question slot its type and key points. One-point types take
 * the least-covered key point; two-point types first vary the pair, then favor
 * the least-covered points (ties by order). This prevents longer blocks from
 * repeating the same small subset of relationships indefinitely.
 * With a single key point (a one-point retry) two-point types become recall.
 */
export function planQuestionSlots({ keyPointIds, mix: source, count }: { keyPointIds: readonly string[]; mix: QuestionMix; count: number }): QuestionSlot[] {
  if (keyPointIds.length === 0 || count <= 0) return [];
  const coverage = new Map(keyPointIds.map((id) => [id, 0]));
  const pairCoverage = new Map<string, number>();
  const pairs = keyPointIds.flatMap((first, index) => keyPointIds.slice(index + 1).map(second => [first, second]));
  const leastCovered = (n: number) => [...keyPointIds]
    .map((id, index) => ({ id, index, covered: coverage.get(id) ?? 0 }))
    .sort((a, b) => a.covered - b.covered || a.index - b.index)
    .slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.id);
  return scaleQuestionMix(source, count).map((planned, index) => {
    const twoPoint = TWO_POINT_QUESTION_TYPES.includes(planned) && keyPointIds.length >= 2;
    const type: QuestionType = TWO_POINT_QUESTION_TYPES.includes(planned) && !twoPoint ? "recall" : planned;
    const chosen = twoPoint
      ? [...pairs].sort((a, b) => (pairCoverage.get(a.join(":")) ?? 0) - (pairCoverage.get(b.join(":")) ?? 0)
        || a.reduce((sum, id) => sum + coverage.get(id)!, 0) - b.reduce((sum, id) => sum + coverage.get(id)!, 0))[0]!
      : leastCovered(1);
    if (twoPoint) pairCoverage.set(chosen.join(":"), (pairCoverage.get(chosen.join(":")) ?? 0) + 1);
    for (const id of chosen) coverage.set(id, (coverage.get(id) ?? 0) + 1);
    return { slotId: `s${index + 1}`, type, keyPointIds: chosen };
  });
}

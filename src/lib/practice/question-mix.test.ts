import { describe, expect, it } from "vitest";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import {
  planQuestionSlots,
  QUESTION_TYPES,
  questionMixFor,
  scaleQuestionMix,
  TWO_POINT_QUESTION_TYPES,
  type QuestionMix,
} from "./question-mix";

const total = (mix: QuestionMix) => QUESTION_TYPES.reduce((sum, type) => sum + mix[type], 0);
const mix = (recall: number, application: number, compare_contrast: number, prediction: number, misconception: number): QuestionMix => ({ recall, application, compare_contrast, prediction, misconception });

// Brief 1.5 item 2: task type first, then profile (02-ROUTING Layer 4).
describe("question-type mix", () => {
  it.each([
    ["memorization", mix(4, 0, 0, 0, 1)],
    ["conceptual_learning", mix(1, 2, 1, 0, 1)],
    ["reading_to_quiz", mix(2, 1, 0, 1, 1)],
    ["problem_solving", mix(1, 3, 0, 0, 1)],
    ["programming", mix(1, 3, 0, 0, 1)],
    ["writing_argumentation", mix(1, 0, 2, 1, 1)],
    ["mixed_assessment", mix(2, 1, 1, 0, 1)],
  ] as const)("%s defaults to the brief's five-question mix", (taskType, expected) => {
    const decided = questionMixFor({ taskType, q7: null });
    expect(decided.mix).toEqual(expected);
    expect(decided.ruleIds).toEqual([`L4.mix.${taskType}`]);
  });

  it("covers every task type with exactly five questions", () => {
    for (const taskType of LEARNING_TASK_TYPES) expect(total(questionMixFor({ taskType, q7: null }).mix)).toBe(5);
  });

  it("gist_leaning shifts one item toward recall, recorded as its own rule", () => {
    const decided = questionMixFor({ taskType: "conceptual_learning", q7: "gist_leaning" });
    expect(decided.mix).toEqual(mix(2, 1, 1, 0, 1));
    expect(decided.ruleIds).toEqual(["L4.mix.conceptual_learning", "L4.q7.gist_leaning.mix_recall"]);
  });

  it("detail_leaning shifts one item toward compare_contrast, recorded as its own rule", () => {
    const decided = questionMixFor({ taskType: "conceptual_learning", q7: "detail_leaning" });
    expect(decided.mix).toEqual(mix(1, 1, 2, 0, 1));
    expect(decided.ruleIds).toEqual(["L4.mix.conceptual_learning", "L4.q7.detail_leaning.mix_compare_contrast"]);
  });

  it("balanced and unanswered keep the task default", () => {
    expect(questionMixFor({ taskType: "reading_to_quiz", q7: "balanced" }).mix).toEqual(mix(2, 1, 0, 1, 1));
  });

  it("scales proportionally for counts other than five and always sums to the count", () => {
    const conceptual = mix(1, 2, 1, 0, 1);
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8]) expect(scaleQuestionMix(conceptual, count)).toHaveLength(count);
    expect(scaleQuestionMix(conceptual, 5)).toEqual(["recall", "application", "application", "compare_contrast", "misconception"]);
    expect(scaleQuestionMix(mix(1, 3, 0, 0, 1), 8)).toEqual(["recall", "recall", "application", "application", "application", "application", "application", "misconception"]);
  });
});

describe("question slots", () => {
  const five = ["k1", "k2", "k3", "k4", "k5"];

  it("gives application, compare_contrast and prediction two key points, and recall and misconception one", () => {
    const slots = planQuestionSlots({ keyPointIds: five, mix: mix(1, 1, 1, 1, 1), count: 5 });
    for (const slot of slots) {
      expect(slot.keyPointIds).toHaveLength(TWO_POINT_QUESTION_TYPES.includes(slot.type) ? 2 : 1);
      expect(new Set(slot.keyPointIds).size).toBe(slot.keyPointIds.length);
    }
  });

  it("covers every key point in a first round and keeps generation order flat", () => {
    const slots = planQuestionSlots({ keyPointIds: five, mix: mix(1, 2, 1, 0, 1), count: 5 });
    expect(new Set(slots.flatMap((slot) => slot.keyPointIds))).toEqual(new Set(five));
    expect(slots.map((slot) => slot.type)).toEqual(["recall", "application", "application", "compare_contrast", "misconception"]);
    expect(slots.map((slot) => slot.slotId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("a one-point retry can only use one-point types", () => {
    const slots = planQuestionSlots({ keyPointIds: ["k3"], mix: mix(1, 2, 1, 0, 1), count: 1 });
    expect(slots).toHaveLength(1);
    expect(TWO_POINT_QUESTION_TYPES).not.toContain(slots[0]!.type);
    expect(slots[0]!.keyPointIds).toEqual(["k3"]);
  });

  it("a two-point retry pairs only the missed points and checks both", () => {
    const slots = planQuestionSlots({ keyPointIds: ["k2", "k4"], mix: mix(1, 3, 0, 0, 1), count: 2 });
    expect(new Set(slots.flatMap((slot) => slot.keyPointIds))).toEqual(new Set(["k2", "k4"]));
    for (const slot of slots) for (const id of slot.keyPointIds) expect(["k2", "k4"]).toContain(id);
  });
});

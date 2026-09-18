import { describe, expect, it } from "vitest";
import {
  composePracticeRound,
  firstRoundKeyPointCount,
  keyPointsForRound,
  roundQuestionCount,
  type KeyPoint,
  type QuestionDraft,
} from "./compose-practice";
import { planQuestionSlots, type QuestionMix, type QuestionSlot } from "./question-mix";

const keyPoints: KeyPoint[] = Array.from({ length: 6 }, (_, index) => ({ id: `k${index + 1}`, text: `Key point number ${index + 1} about the topic.` }));
const conceptual: QuestionMix = { recall: 1, application: 2, compare_contrast: 1, prediction: 0, misconception: 1 };

function draft(slotId: string, overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return { slotId, prompt: `What does slot ${slotId} ask?`, choices: ["Alpha", "Beta", "Gamma", "Delta"], correctChoiceIndex: 0, explanation: "Alpha is the defined answer here.", ...overrides };
}
const fill = (slots: QuestionSlot[]) => slots.map((slot) => draft(slot.slotId));

describe("practice question count", () => {
  it("a first round asks five questions, within the route cap", () => {
    expect(roundQuestionCount({ round: 1, keyPointCount: 3, questionCap: 8 })).toBe(5);
    expect(roundQuestionCount({ round: 1, keyPointCount: 5, questionCap: 5 })).toBe(5);
    expect(roundQuestionCount({ round: 1, keyPointCount: 4, questionCap: 3 })).toBe(3);
  });

  it("a first round derives between three and five key points to match its question count", () => {
    expect(firstRoundKeyPointCount(3)).toBe(3);
    expect(firstRoundKeyPointCount(5)).toBe(5);
    expect(firstRoundKeyPointCount(8)).toBe(5);
  });

  // Brief 1.5 item 1: a retry checks each missed point once, never three questions on one point.
  it("a retry asks one question per missed point, within the cap", () => {
    expect(roundQuestionCount({ round: 2, keyPointCount: 1, questionCap: 8 })).toBe(1);
    expect(roundQuestionCount({ round: 2, keyPointCount: 2, questionCap: 8 })).toBe(2);
    expect(roundQuestionCount({ round: 3, keyPointCount: 6, questionCap: 5 })).toBe(5);
  });
});

describe("rounds", () => {
  it("round 1 covers every key point; later rounds only what was missed", () => {
    expect(keyPointsForRound(keyPoints, 1, [])).toHaveLength(6);
    expect(keyPointsForRound(keyPoints, 2, ["k2", "k5"]).map((keyPoint) => keyPoint.id)).toEqual(["k2", "k5"]);
  });
});

describe("composing a round from code-planned slots", () => {
  const slots = planQuestionSlots({ keyPointIds: ["k1", "k2", "k3", "k4", "k5"], mix: conceptual, count: 5 });

  it("takes each question's type and key points from its slot, in slot order", () => {
    const result = composePracticeRound({ keyPoints, slots, drafts: [...fill(slots)].reverse() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions.map((question) => question.slotId)).toEqual(slots.map((slot) => slot.slotId));
    expect(result.questions.map((question) => question.kind)).toEqual(slots.map((slot) => slot.type));
    expect(result.questions.map((question) => question.keyPointIds)).toEqual(slots.map((slot) => slot.keyPointIds));
  });

  it("refuses a round that leaves a slot unfilled", () => {
    expect(composePracticeRound({ keyPoints, slots, drafts: fill(slots).slice(1) }).ok).toBe(false);
  });

  it("permutes model answer positions while preserving the correct answer and stable resume order", () => {
    const input = { keyPoints, slots, drafts: fill(slots) };
    const first = composePracticeRound(input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.questions.some(question => question.correctChoiceIndex !== 0)).toBe(true);
    expect(first.questions.map(question => question.choices[question.correctChoiceIndex])).toEqual(slots.map(() => "Alpha"));
    expect(composePracticeRound(input)).toEqual(first);
  });

  it("preserves semantic numeric order and rejects questions about a guide rather than its subject", () => {
    const one = [slots[0]];
    const ordered = composePracticeRound({ keyPoints, slots: one, drafts: [draft(one[0].slotId, { choices: ["10 kg", "20 kg", "30 kg", "40 kg"], correctChoiceIndex: 2 })] });
    expect(ordered.ok && ordered.questions[0].choices).toEqual(["10 kg", "20 kg", "30 kg", "40 kg"]);
    const calendar = ["Monday", "Tuesday", "Wednesday", "Thursday"];
    const temporal = composePracticeRound({ keyPoints, slots: one, drafts: [draft(one[0].slotId, { choices: calendar, correctChoiceIndex: 2 })] });
    expect(temporal.ok && temporal.questions[0].choices).toEqual(calendar);
    expect(temporal.ok && temporal.questions[0].correctChoiceIndex).toBe(2);
    expect(composePracticeRound({ keyPoints, slots: one, drafts: [draft(one[0].slotId, { prompt: "What does the study guide list as the goals of unit 6?" })] }).ok).toBe(false);
  });

  it("refuses a question for a slot that was not planned", () => {
    expect(composePracticeRound({ keyPoints, slots, drafts: [...fill(slots), draft("s9")] }).ok).toBe(false);
  });

  it("refuses two questions for one slot", () => {
    expect(composePracticeRound({ keyPoints, slots, drafts: [...fill(slots), draft("s1", { prompt: "A second question on the first slot?" })] }).ok).toBe(false);
  });

  it("refuses repeated choices", () => {
    expect(composePracticeRound({ keyPoints, slots, drafts: [draft("s1", { choices: ["Alpha", "alpha", "Gamma", "Delta"] }), ...fill(slots).slice(1)] }).ok).toBe(false);
  });

  it("round 2 accepts one question when one key point is outstanding", () => {
    const retry = planQuestionSlots({ keyPointIds: ["k4"], mix: conceptual, count: roundQuestionCount({ round: 2, keyPointCount: 1, questionCap: 8 }) });
    const result = composePracticeRound({ keyPoints, slots: retry, drafts: fill(retry) });
    expect(result.ok && result.questions.flatMap((question) => question.keyPointIds)).toEqual(["k4"]);
  });

  it("round 2 accepts two questions when two key points are outstanding, and checks both", () => {
    const retry = planQuestionSlots({ keyPointIds: ["k2", "k4"], mix: conceptual, count: roundQuestionCount({ round: 2, keyPointCount: 2, questionCap: 8 }) });
    const result = composePracticeRound({ keyPoints, slots: retry, drafts: fill(retry) });
    expect(result.ok && new Set(result.questions.flatMap((question) => question.keyPointIds))).toEqual(new Set(["k2", "k4"]));
  });

  it("round 2 still refuses a set that leaves a missed point unchecked", () => {
    const retry = planQuestionSlots({ keyPointIds: ["k2", "k4"], mix: { recall: 1, application: 0, compare_contrast: 0, prediction: 0, misconception: 0 }, count: 2 });
    expect(composePracticeRound({ keyPoints, slots: retry, drafts: fill(retry).slice(0, 1) }).ok).toBe(false);
  });
});

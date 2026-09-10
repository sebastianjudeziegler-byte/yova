import { describe, expect, it } from "vitest";
import {
  composePracticeRound,
  keyPointsForRound,
  orderQuestionsByWeighting,
  practiceQuestionCount,
  type KeyPoint,
  type PracticeQuestion,
} from "./compose-practice";

const keyPoints: KeyPoint[] = Array.from({ length: 6 }, (_, index) => ({ id: `k${index + 1}`, text: `Key point number ${index + 1} about the topic.` }));

function question(id: string, keyPointId: string, kind: PracticeQuestion["kind"] = "relationship", overrides: Partial<PracticeQuestion> = {}): PracticeQuestion {
  return { id, keyPointId, kind, prompt: `What about ${keyPointId}?`, choices: ["Alpha", "Beta", "Gamma", "Delta"], correctChoiceIndex: 0, explanation: "Alpha is the defined answer here.", ...overrides };
}

const baseRoute = { questionCap: 8, questionMinimum: 3, weighting: "relationships_first" as const };

describe("practice question count", () => {
  it("is one per key point clamped to 3–8", () => {
    expect(practiceQuestionCount(1, baseRoute)).toBe(3);
    expect(practiceQuestionCount(5, baseRoute)).toBe(5);
    expect(practiceQuestionCount(12, baseRoute)).toBe(8);
  });

  it("honours the route cap for shorter sections and the shortest timer band", () => {
    expect(practiceQuestionCount(8, { ...baseRoute, questionCap: 5 })).toBe(5);
    expect(practiceQuestionCount(2, { ...baseRoute, questionCap: 5 })).toBe(3);
  });
});

describe("weighting", () => {
  const set = [question("a", "k1", "relationship"), question("b", "k2", "definition"), question("c", "k3", "compare_contrast"), question("d", "k4", "term")];

  it("gist-leaning puts definitions and terms first, keeping original order inside each group", () => {
    expect(orderQuestionsByWeighting(set, "terms_first").map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("detail-leaning puts compare-contrast and relationship items first", () => {
    expect(orderQuestionsByWeighting(set, "relationships_first").map((item) => item.id)).toEqual(["a", "c", "b", "d"]);
  });
});

describe("rounds", () => {
  it("round 1 covers every key point and later rounds only the outstanding ones", () => {
    expect(keyPointsForRound(keyPoints, 1, []).map((item) => item.id)).toEqual(["k1", "k2", "k3", "k4", "k5", "k6"]);
    expect(keyPointsForRound(keyPoints, 2, ["k2", "k5"]).map((item) => item.id)).toEqual(["k2", "k5"]);
  });
});

describe("composing a round from generated questions", () => {
  it("accepts a valid set, one per key point, ordered by weighting", () => {
    const result = composePracticeRound({ keyPoints, questions: keyPoints.map((keyPoint, index) => question(`q${index}`, keyPoint.id, index % 2 ? "term" : "relationship")), route: baseRoute });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(6);
    expect(result.questions.slice(0, 3).every((item) => item.kind === "relationship")).toBe(true);
  });

  it("trims to the cap while keeping one question per key point before any second", () => {
    const questions = [...keyPoints.map((keyPoint, index) => question(`q${index}`, keyPoint.id)), question("extra", "k1")];
    const result = composePracticeRound({ keyPoints, questions, route: { ...baseRoute, questionCap: 5 } });
    expect(result.ok && result.questions.map((item) => item.keyPointId)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("rejects a question that tests something outside the round's key points", () => {
    const result = composePracticeRound({ keyPoints, questions: [question("q1", "k1"), question("q2", "k2"), question("q3", "not-a-key-point")], route: baseRoute });
    expect(result).toEqual({ ok: false, reason: "A question tested something outside this round's key points." });
  });

  it("rejects repeated choices, duplicate ids, and a correct index off the choices", () => {
    expect(composePracticeRound({ keyPoints, questions: [question("q1", "k1", "term", { choices: ["Same", "same", "Other", "More"] }), question("q2", "k2"), question("q3", "k3")], route: baseRoute })).toMatchObject({ ok: false, reason: "A question repeated a choice." });
    expect(composePracticeRound({ keyPoints, questions: [question("q1", "k1"), question("q1", "k2"), question("q3", "k3")], route: baseRoute })).toMatchObject({ ok: false, reason: "Two questions shared an id." });
    expect(composePracticeRound({ keyPoints, questions: [question("q1", "k1", "term", { correctChoiceIndex: 4 }), question("q2", "k2"), question("q3", "k3")], route: baseRoute }).ok).toBe(false);
  });

  it("refuses a round with fewer than three usable questions when three are needed", () => {
    const result = composePracticeRound({ keyPoints, questions: [question("q1", "k1"), question("q2", "k2")], route: baseRoute });
    expect(result.ok).toBe(false);
  });

  it("round 2 accepts fewer questions when only one key point is outstanding", () => {
    const result = composePracticeRound({ keyPoints, questions: [question("q9", "k4")], route: baseRoute, round: 2, outstandingKeyPointIds: ["k4"] });
    expect(result.ok).toBe(false);
    const enough = composePracticeRound({ keyPoints, questions: [question("q9", "k4"), question("q10", "k4"), question("q11", "k4")], route: baseRoute, round: 2, outstandingKeyPointIds: ["k4"] });
    expect(enough.ok && enough.questions).toHaveLength(3);
  });
});

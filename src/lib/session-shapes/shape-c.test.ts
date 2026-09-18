import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers, withOnboardingAnswer } from "@/lib/onboarding/answers";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";
import { routeSession, type RoutingInput } from "@/lib/routing/session-route";
import {
  currentShapeCQuestion,
  initialShapeCState,
  isShapeCTopicDone,
  lastShapeCAnswer,
  shapeCReducer,
  shapeCTotals,
  shapeCKeyPointOutcomes,
  shapeCPartPosition,
  type ShapeCState,
} from "./shape-c";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "practice", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: record, ...overrides });
}

function question(id: string, keyPoints: string | string[], correctChoiceIndex = 0): PracticeQuestion {
  const keyPointIds = Array.isArray(keyPoints) ? keyPoints : [keyPoints];
  return { id, slotId: id, kind: keyPointIds.length === 2 ? "application" : "recall", keyPointIds, prompt: `Question ${id}?`, choices: ["A", "B", "C", "D"], correctChoiceIndex, explanation: "Because A is the defined answer." };
}

function answerAll(state: ShapeCState, choose: (question: PracticeQuestion) => number) {
  let next = state;
  while (next.phase === "question") {
    const current = currentShapeCQuestion(next)!;
    next = shapeCReducer(next, { type: "answer", choiceIndex: choose(current) });
    next = shapeCReducer(next, { type: "next" });
  }
  return next;
}

describe("Shape C reducer", () => {
  it("starts closed-book: no source shown, straight into questions", () => {
    expect(initialShapeCState(route()).phase).toBe("loading");
  });

  it("starts with a brief study step only for a memorization learn block", () => {
    expect(initialShapeCState(route({ taskType: "memorization", blockKind: "learn" })).phase).toBe("brief_study");
    expect(initialShapeCState(route({ taskType: "memorization", blockKind: "practice" })).phase).toBe("loading");
  });

  it("checks answers in code, reveals the correct answer on a miss, and moves on without a forced repeat", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", "k1", 2), question("q2", "k2", 1)] });
    expect(state.phase).toBe("question");
    state = shapeCReducer(state, { type: "answer", choiceIndex: 0 });
    expect(state.phase).toBe("revealed");
    expect(lastShapeCAnswer(state)).toEqual({ questionId: "q1", keyPointIds: ["k1"], choiceIndex: 0, correct: false });
    state = shapeCReducer(state, { type: "next" });
    expect(currentShapeCQuestion(state)?.id).toBe("q2");
    state = shapeCReducer(state, { type: "answer", choiceIndex: 1 });
    expect(lastShapeCAnswer(state)?.correct).toBe(true);
    state = shapeCReducer(state, { type: "next" });
    expect(state.phase).toBe("round_complete");
    expect(state.outstandingKeyPointIds).toEqual(["k1"]);
    expect(shapeCTotals(state)).toEqual({ correct: 1, total: 2 });
  });

  it("rejects an out-of-range choice and an answer outside the question phase", () => {
    let state = initialShapeCState(route());
    expect(shapeCReducer(state, { type: "answer", choiceIndex: 0 })).toBe(state);
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", "k1")] });
    expect(shapeCReducer(state, { type: "answer", choiceIndex: 9 })).toBe(state);
    expect(shapeCReducer(state, { type: "answer", choiceIndex: -1 })).toBe(state);
  });

  it("a topic is done when a full round passes clean", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", "k1"), question("q2", "k2"), question("q3", "k3")] });
    state = answerAll(state, () => 0);
    expect(isShapeCTopicDone(state)).toBe(true);
    expect(state.outstandingKeyPointIds).toEqual([]);
  });

  it("round 2 covers only what was missed", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", "k1"), question("q2", "k2"), question("q3", "k3")] });
    state = answerAll(state, (current) => (current.keyPointIds.includes("k2") ? 3 : 0));
    expect(state.phase).toBe("round_complete");
    expect(state.outstandingKeyPointIds).toEqual(["k2"]);
    state = shapeCReducer(state, { type: "start_next_round" });
    expect(state.phase).toBe("loading");
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q4", "k2")] });
    expect(state.rounds).toHaveLength(2);
    state = answerAll(state, () => 0);
    expect(isShapeCTopicDone(state)).toBe(true);
    expect(shapeCTotals(state)).toEqual({ correct: 3, total: 4 });
  });

  // Brief 1.5 item 2 (founder-confirmed): a two-point question tests both points.
  it("missing a two-point question marks both of its key points missed", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", "k1"), question("q2", ["k2", "k3"]), question("q3", "k4")] });
    state = answerAll(state, (current) => (current.id === "q2" ? 3 : 0));
    expect(state.phase).toBe("round_complete");
    expect(state.outstandingKeyPointIds).toEqual(["k2", "k3"]);
  });

  it("a correct two-point answer passes both of its key points", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q1", ["k1", "k2"]), question("q2", "k3")] });
    state = answerAll(state, () => 0);
    expect(isShapeCTopicDone(state)).toBe(true);
  });

  it("escalates after the third round instead of looping forever", () => {
    let state = initialShapeCState(route());
    for (let round = 1; round <= 3; round += 1) {
      state = shapeCReducer(state, { type: "questions_ready", questions: [question(`q${round}`, "k1")] });
      state = answerAll(state, () => 3);
      if (round < 3) {
        expect(state.phase).toBe("round_complete");
        state = shapeCReducer(state, { type: "start_next_round" });
      }
    }
    expect(state.phase).toBe("escalate");
    expect(state.outstandingKeyPointIds).toEqual(["k1"]);
    expect(shapeCReducer(state, { type: "start_next_round" })).toBe(state);
  });

  it("retains passed points at the retry ceiling and attributes points to their own topic", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("first", "passed"), question("second", "missed")] });
    state = answerAll(state, (item) => item.id === "first" ? 0 : 3);
    for (let round = 2; round <= 3; round += 1) {
      state = shapeCReducer(state, { type: "start_next_round" });
      state = shapeCReducer(state, { type: "questions_ready", questions: [question(`retry-${round}`, "missed")] });
      state = answerAll(state, () => 3);
    }
    expect(state.phase).toBe("escalate");
    expect(shapeCKeyPointOutcomes(state, [
      { id: "passed", text: "A point already passed", sourceTopicId: "10000000-0000-4000-8000-000000000001" },
      { id: "missed", text: "A point still unresolved", sourceTopicId: "10000000-0000-4000-8000-000000000002" },
      { id: "untested", text: "A point not in the round" },
    ])).toEqual([
      { keyPointId: "passed", text: "A point already passed", sourceTopicId: "10000000-0000-4000-8000-000000000001", outcome: "secure" },
      { keyPointId: "missed", text: "A point still unresolved", sourceTopicId: "10000000-0000-4000-8000-000000000002", outcome: "needs_review" },
    ]);
  });

  it("forget_during_tests raises the ceiling to four rounds", () => {
    let state = initialShapeCState(route({}, { extra_context: "forget_during_tests" }));
    expect(state.roundCeiling).toBe(4);
    for (let round = 1; round <= 3; round += 1) {
      state = shapeCReducer(state, { type: "questions_ready", questions: [question(`q${round}`, "k1")] });
      state = answerAll(state, () => 3);
      state = shapeCReducer(state, { type: "start_next_round" });
    }
    expect(state.phase).toBe("loading");
    state = shapeCReducer(state, { type: "questions_ready", questions: [question("q4", "k1")] });
    state = answerAll(state, () => 3);
    expect(state.phase).toBe("escalate");
  });

  it("an honest failure is shown and can be retried, never replaced with fabricated questions", () => {
    let state = initialShapeCState(route());
    state = shapeCReducer(state, { type: "questions_failed", message: "YOVA couldn't build this. Try again, or add material for this topic." });
    expect(state.phase).toBe("failed");
    expect(state.error).toMatch(/couldn't build this/);
    state = shapeCReducer(state, { type: "continue" });
    expect(state.phase).toBe("loading");
    state = shapeCReducer(state, { type: "questions_ready", questions: [] });
    expect(state.phase).toBe("failed");
  });
});

// Founder decision (18 Sept 2026, option B): a long first pass is one sitting in
// parts of at most eight, built up from recall. The next part is prepared while
// the learner answers, so it is usually waiting; the round is judged only after
// its last part, and missed-point repair still follows the whole pass.
describe("Shape C first pass in parts", () => {
  const longRoute = () => ({ ...route(), questionTarget: 24, questionCap: 24 });
  const part = (from: number, points: string[]) => Array.from({ length: 8 }, (_, index) => question(`q${from + index}`, points[index % points.length]!));
  const first = () => shapeCReducer(initialShapeCState(longRoute()), { type: "questions_ready", questions: part(1, ["k1", "k2"]) });

  it("plans three parts for a 24-question pass and one for a short one", () => {
    expect(initialShapeCState(longRoute()).firstPassParts).toBe(3);
    expect(initialShapeCState(route()).firstPassParts).toBe(1);
  });

  it("appends a part that is already waiting, without a gap and without judging the round early", () => {
    let state = first();
    state = shapeCReducer(state, { type: "part_ready", questions: part(9, ["k3"]) });
    expect(state.phase).toBe("question");
    state = answerAll(state, () => 0);
    expect(state.rounds).toHaveLength(1);
    expect(state.rounds[0]!.questions).toHaveLength(16);
    expect(state.phase).toBe("part_loading");
    expect(state.outstandingKeyPointIds).toEqual(expect.arrayContaining(["k1", "k2", "k3"]));
  });

  it("waits for a part that has not arrived, then carries on in the same round", () => {
    let state = answerAll(first(), () => 0);
    expect(state.phase).toBe("part_loading");
    state = shapeCReducer(state, { type: "part_ready", questions: part(9, ["k3"]) });
    expect(state.phase).toBe("question");
    expect(state.partsDelivered).toBe(2);
    expect(currentShapeCQuestion(state)!.id).toBe("q9");
    expect(shapeCPartPosition(state, 8)).toEqual({ part: 2, parts: 3, question: 1, questionsInPart: 8, lastInPart: false });
    expect(shapeCPartPosition(state, 7)).toMatchObject({ part: 1, question: 8, lastInPart: true });
  });

  it("judges the round only after the last part, then repairs only what was missed", () => {
    let state = first();
    state = shapeCReducer(state, { type: "part_ready", questions: part(9, ["k3"]) });
    state = answerAll(state, (current) => current.id === "q2" ? 1 : 0);
    state = shapeCReducer(state, { type: "part_ready", questions: part(17, ["k4"]) });
    state = answerAll(state, () => 0);
    expect(state.rounds).toHaveLength(1);
    expect(state.rounds[0]!.answers).toHaveLength(24);
    expect(state.phase).toBe("round_complete");
    expect(state.outstandingKeyPointIds).toEqual(["k2"]);
    expect(shapeCTotals(state)).toEqual({ correct: 23, total: 24 });
  });

  it("shows a failed part as an honest error only when the learner reaches it, and Try again asks again", () => {
    let state = shapeCReducer(first(), { type: "part_failed", message: "YOVA couldn't build this." });
    expect(state.phase).toBe("question");
    state = answerAll(state, () => 0);
    expect(state.phase).toBe("failed");
    expect(state.error).toBe("YOVA couldn't build this.");
    state = shapeCReducer(state, { type: "continue" });
    expect(state.phase).toBe("part_loading");
    expect(state.rounds[0]!.answers).toHaveLength(8);
  });

  it("keeps a saved session from before parts working as a single-part pass", () => {
    const saved = { ...first() } as Partial<ShapeCState>;
    delete saved.firstPassParts; delete saved.partsDelivered;
    const state = answerAll(saved as ShapeCState, () => 0);
    expect(state.phase).toBe("done");
  });
});

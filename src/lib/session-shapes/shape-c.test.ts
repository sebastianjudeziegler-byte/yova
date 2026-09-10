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
  type ShapeCState,
} from "./shape-c";

function route(overrides: Partial<RoutingInput> = {}, answers: Record<string, string> = {}) {
  let record = emptyOnboardingAnswers();
  for (const [id, value] of Object.entries(answers)) record = withOnboardingAnswer(record, id as never, value);
  return routeSession({ taskType: "conceptual_learning", blockKind: "practice", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: record, ...overrides });
}

function question(id: string, keyPointId: string, correctChoiceIndex = 0): PracticeQuestion {
  return { id, keyPointId, kind: "relationship", prompt: `Question ${id}?`, choices: ["A", "B", "C", "D"], correctChoiceIndex, explanation: "Because A is the defined answer." };
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
    expect(lastShapeCAnswer(state)).toEqual({ questionId: "q1", keyPointId: "k1", choiceIndex: 0, correct: false });
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
    state = answerAll(state, (current) => (current.keyPointId === "k2" ? 3 : 0));
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

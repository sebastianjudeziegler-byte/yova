import type { SessionRoute } from "@/lib/routing/session-route";
import { PRACTICE_ROUND_CEILING } from "@/lib/routing/session-route";
import type { PracticeQuestion } from "@/lib/practice/compose-practice";

/**
 * Shape C — closed-book practice. A coded step sequence.
 *
 * Fresh multiple-choice questions per attempt; answers are checked in code,
 * never by a model. A wrong answer shows the correct answer and moves on. No
 * forced repeat and no repair loop inside a round. Round 2+ covers only what
 * was missed. A topic is done when a full round passes clean. After the
 * ceiling, the block escalates instead of looping forever.
 * See docs/redesign/01-SESSION-SHAPES.md and 04-AI-SLOTS.md.
 */
export type ShapeCPhase = "brief_study" | "loading" | "question" | "revealed" | "round_complete" | "done" | "escalate" | "failed";

export type ShapeCAnswer = {
  questionId: string;
  keyPointId: string;
  choiceIndex: number;
  correct: boolean;
};

export type ShapeCRound = {
  number: number;
  questions: PracticeQuestion[];
  answers: ShapeCAnswer[];
};

export type ShapeCState = {
  phase: ShapeCPhase;
  rounds: ShapeCRound[];
  /** Key points still to pass; empty means the topic is done. */
  outstandingKeyPointIds: string[];
  roundCeiling: number;
  error: string | null;
  timerAcknowledged: boolean;
};

export type ShapeCEvent =
  | { type: "continue" }
  | { type: "questions_ready"; questions: PracticeQuestion[] }
  | { type: "questions_failed"; message: string }
  | { type: "answer"; choiceIndex: number }
  | { type: "next" }
  | { type: "start_next_round" }
  | { type: "acknowledge_timer" };

export function initialShapeCState(route: SessionRoute): ShapeCState {
  return {
    phase: route.briefStudyStep ? "brief_study" : "loading",
    rounds: [],
    outstandingKeyPointIds: [],
    roundCeiling: Math.max(PRACTICE_ROUND_CEILING, route.practiceRoundCeiling),
    error: null,
    timerAcknowledged: false,
  };
}

export function currentShapeCRound(state: ShapeCState): ShapeCRound | null {
  return state.rounds[state.rounds.length - 1] ?? null;
}

export function currentShapeCQuestion(state: ShapeCState): PracticeQuestion | null {
  const round = currentShapeCRound(state);
  if (!round) return null;
  return round.questions[round.answers.length] ?? null;
}

export function lastShapeCAnswer(state: ShapeCState): ShapeCAnswer | null {
  const round = currentShapeCRound(state);
  return round?.answers[round.answers.length - 1] ?? null;
}

/** Correct and total across every round, for the completion record. */
export function shapeCTotals(state: ShapeCState) {
  const answers = state.rounds.flatMap((round) => round.answers);
  return { correct: answers.filter((answer) => answer.correct).length, total: answers.length };
}

export function isShapeCTopicDone(state: ShapeCState) {
  return state.phase === "done";
}

export function shapeCReducer(state: ShapeCState, event: ShapeCEvent): ShapeCState {
  if (event.type === "acknowledge_timer") return { ...state, timerAcknowledged: true };
  switch (state.phase) {
    case "brief_study":
      return event.type === "continue" ? { ...state, phase: "loading" } : state;
    case "loading": {
      if (event.type === "questions_failed") return { ...state, phase: "failed", error: event.message };
      if (event.type !== "questions_ready") return state;
      const questions = event.questions;
      if (questions.length === 0) return { ...state, phase: "failed", error: "YOVA couldn't build this. Try again, or add material for this topic." };
      const number = state.rounds.length + 1;
      const outstanding = number === 1
        ? [...new Set(questions.map((question) => question.keyPointId))]
        : state.outstandingKeyPointIds;
      return {
        ...state,
        phase: "question",
        error: null,
        outstandingKeyPointIds: outstanding,
        rounds: [...state.rounds, { number, questions, answers: [] }],
      };
    }
    case "question": {
      if (event.type !== "answer") return state;
      const round = currentShapeCRound(state);
      const question = currentShapeCQuestion(state);
      if (!round || !question) return state;
      if (!Number.isInteger(event.choiceIndex) || event.choiceIndex < 0 || event.choiceIndex >= question.choices.length) return state;
      // Checked in code, not by a model.
      const correct = event.choiceIndex === question.correctChoiceIndex;
      const answer: ShapeCAnswer = { questionId: question.id, keyPointId: question.keyPointId, choiceIndex: event.choiceIndex, correct };
      const rounds = [...state.rounds.slice(0, -1), { ...round, answers: [...round.answers, answer] }];
      return { ...state, phase: "revealed", rounds };
    }
    case "revealed": {
      if (event.type !== "next") return state;
      const round = currentShapeCRound(state);
      if (!round) return state;
      if (round.answers.length < round.questions.length) return { ...state, phase: "question" };
      return finishRound(state);
    }
    case "round_complete":
      return event.type === "start_next_round" ? { ...state, phase: "loading" } : state;
    case "failed":
      return event.type === "continue" ? { ...state, phase: "loading", error: null } : state;
    case "done":
    case "escalate":
      return state;
    default: {
      const never: never = state.phase;
      throw new Error(`Unknown phase ${String(never)}`);
    }
  }
}

function finishRound(state: ShapeCState): ShapeCState {
  const round = currentShapeCRound(state);
  if (!round) return state;
  const missed = new Set(round.answers.filter((answer) => !answer.correct).map((answer) => answer.keyPointId));
  const passedThisRound = round.answers.filter((answer) => answer.correct).map((answer) => answer.keyPointId);
  // A key point passes when every question on it in this round was correct.
  const outstanding = state.outstandingKeyPointIds.filter((id) => missed.has(id) || !passedThisRound.includes(id));
  if (outstanding.length === 0) return { ...state, phase: "done", outstandingKeyPointIds: [] };
  if (round.number >= state.roundCeiling) return { ...state, phase: "escalate", outstandingKeyPointIds: outstanding };
  return { ...state, phase: "round_complete", outstandingKeyPointIds: outstanding };
}

/** Learner-facing escalation copy; the link target is a learn block with a different produce step. */
export const SHAPE_C_ESCALATION_MESSAGE = "This one isn't sticking — want to re-learn it a different way?";

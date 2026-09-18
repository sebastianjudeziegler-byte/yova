import type { SessionRoute } from "@/lib/routing/session-route";
import { PRACTICE_ROUND_CEILING } from "@/lib/routing/session-route";
import type { KeyPoint, PracticeQuestion } from "@/lib/practice/compose-practice";
import { practicePartSizes } from "@/lib/practice/practice-parts";

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
export type ShapeCPhase = "brief_study" | "loading" | "part_loading" | "question" | "revealed" | "round_complete" | "done" | "escalate" | "failed";

export type ShapeCAnswer = {
  questionId: string;
  /** Every key point the question tested; a two-point question passes or misses both. */
  keyPointIds: string[];
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
  /**
   * A long first pass arrives in parts of at most eight (founder decision,
   * 18 Sept 2026). Optional so a session saved before parts resumes as one part.
   */
  firstPassParts?: number;
  partsDelivered?: number;
  /** Index in round 1 where each delivered part begins, for "part 2 of 3". */
  partStarts?: number[];
  /** The next part, prepared while the learner answers the current one. */
  pendingPart?: PracticeQuestion[] | null;
  /** A next part that could not be built, shown when the learner reaches it. */
  partError?: string | null;
};

export type ShapeCEvent =
  | { type: "continue" }
  | { type: "questions_ready"; questions: PracticeQuestion[] }
  | { type: "questions_failed"; message: string }
  | { type: "part_ready"; questions: PracticeQuestion[] }
  | { type: "part_failed"; message: string }
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
    firstPassParts: Math.max(1, practicePartSizes(route.questionTarget).length),
    partsDelivered: 0,
    pendingPart: null,
    partError: null,
  };
}

/** Parts of the first pass not yet in the round; 0 once the pass is complete or has one part. */
export function shapeCPartsRemaining(state: ShapeCState) {
  if (state.rounds.length !== 1) return 0;
  return Math.max(0, (state.firstPassParts ?? 1) - (state.partsDelivered ?? 1));
}

function appendPart(state: ShapeCState, questions: PracticeQuestion[]): ShapeCState {
  const round = state.rounds[0]!;
  const outstanding = [...new Set([...state.outstandingKeyPointIds, ...questions.flatMap((question) => question.keyPointIds)])];
  return {
    ...state,
    phase: "question",
    error: null,
    pendingPart: null,
    partError: null,
    partsDelivered: (state.partsDelivered ?? 1) + 1,
    partStarts: [...(state.partStarts ?? [0]), round.questions.length],
    outstandingKeyPointIds: outstanding,
    rounds: [{ ...round, questions: [...round.questions, ...questions] }],
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

/** Only tested points receive an outcome, and a retry ceiling never undoes a passed point. */
export function shapeCKeyPointOutcomes(state: ShapeCState, keyPoints: readonly KeyPoint[]) {
  const tested = new Set(state.rounds.flatMap((round) => round.answers.flatMap((answer) => answer.keyPointIds)));
  return keyPoints.filter((point) => tested.has(point.id)).map((point) => ({
    keyPointId: point.id, text: point.text,
    ...(point.sourceTopicId ? { sourceTopicId: point.sourceTopicId } : {}),
    outcome: state.outstandingKeyPointIds.includes(point.id) ? "needs_review" as const : "secure" as const,
  }));
}

export function isShapeCTopicDone(state: ShapeCState) {
  return state.phase === "done";
}

export function shapeCReducer(state: ShapeCState, event: ShapeCEvent): ShapeCState {
  if (event.type === "acknowledge_timer") return { ...state, timerAcknowledged: true };
  // A later part may arrive at any point while the learner works; it waits
  // until they reach it, and is never applied outside the first pass.
  if (event.type === "part_ready" || event.type === "part_failed") {
    if (shapeCPartsRemaining(state) === 0 || event.type === "part_ready" && event.questions.length === 0) return state;
    if (state.phase === "part_loading") {
      return event.type === "part_ready" ? appendPart(state, event.questions) : { ...state, phase: "failed", error: event.message };
    }
    return event.type === "part_ready" ? { ...state, pendingPart: event.questions, partError: null } : { ...state, partError: event.message };
  }
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
        ? [...new Set(questions.flatMap((question) => question.keyPointIds))]
        : state.outstandingKeyPointIds;
      return {
        ...state,
        phase: "question",
        error: null,
        outstandingKeyPointIds: outstanding,
        ...(number === 1 ? { partsDelivered: 1, partStarts: [0] } : {}),
        rounds: [...state.rounds, { number, questions, answers: [] }],
      };
    }
    case "part_loading":
      return state;
    case "question": {
      if (event.type !== "answer") return state;
      const round = currentShapeCRound(state);
      const question = currentShapeCQuestion(state);
      if (!round || !question) return state;
      if (!Number.isInteger(event.choiceIndex) || event.choiceIndex < 0 || event.choiceIndex >= question.choices.length) return state;
      // Checked in code, not by a model.
      const correct = event.choiceIndex === question.correctChoiceIndex;
      const answer: ShapeCAnswer = { questionId: question.id, keyPointIds: [...question.keyPointIds], choiceIndex: event.choiceIndex, correct };
      const rounds = [...state.rounds.slice(0, -1), { ...round, answers: [...round.answers, answer] }];
      return { ...state, phase: "revealed", rounds };
    }
    case "revealed": {
      if (event.type !== "next") return state;
      const round = currentShapeCRound(state);
      if (!round) return state;
      if (round.answers.length < round.questions.length) return { ...state, phase: "question" };
      if (shapeCPartsRemaining(state) > 0) {
        if (state.pendingPart?.length) return appendPart(state, state.pendingPart);
        if (state.partError) return { ...state, phase: "failed", error: state.partError, partError: null };
        return { ...state, phase: "part_loading" };
      }
      return finishRound(state);
    }
    case "round_complete":
      return event.type === "start_next_round" ? { ...state, phase: "loading" } : state;
    case "failed":
      if (event.type !== "continue") return state;
      // Try again on a missing part asks for that part, keeping every answer so far.
      return shapeCPartsRemaining(state) > 0 && currentShapeCRound(state)?.answers.length === currentShapeCRound(state)?.questions.length
        ? { ...state, phase: "part_loading", error: null }
        : { ...state, phase: "loading", error: null };
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
  const missed = new Set(round.answers.filter((answer) => !answer.correct).flatMap((answer) => answer.keyPointIds));
  const passedThisRound = round.answers.filter((answer) => answer.correct).flatMap((answer) => answer.keyPointIds);
  // A key point passes when every question on it in this round was correct.
  const outstanding = state.outstandingKeyPointIds.filter((id) => missed.has(id) || !passedThisRound.includes(id));
  if (outstanding.length === 0) return { ...state, phase: "done", outstandingKeyPointIds: [] };
  if (round.number >= state.roundCeiling) return { ...state, phase: "escalate", outstandingKeyPointIds: outstanding };
  return { ...state, phase: "round_complete", outstandingKeyPointIds: outstanding };
}

/** Learner-facing escalation copy; the link target is a learn block with a different produce step. */
export const SHAPE_C_ESCALATION_MESSAGE = "Some points still need review. You can finish this block now.";

/** Where the learner is in a multi-part first pass, or null for a single-part round. */
export function shapeCPartPosition(state: ShapeCState, questionIndex: number) {
  const round = currentShapeCRound(state);
  const parts = state.firstPassParts ?? 1;
  if (!round || round.number !== 1 || parts <= 1) return null;
  const starts = state.partStarts ?? [0];
  let part = 0;
  for (let index = 0; index < starts.length; index += 1) if (questionIndex >= starts[index]!) part = index;
  const start = starts[part]!;
  const end = starts[part + 1] ?? round.questions.length;
  return { part: part + 1, parts, question: questionIndex - start + 1, questionsInPart: end - start, lastInPart: questionIndex === end - 1 };
}

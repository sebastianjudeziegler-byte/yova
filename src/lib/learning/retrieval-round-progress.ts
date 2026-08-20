/**
 * Queue behaviour for a retrieval round.
 *
 * The mechanism of retrieval practice is that the learner produces an answer
 * before seeing one, and that missed material comes back rather than being read
 * once and marked done. Both of those are state rules, not styling, so they
 * live here where they can be tested without rendering anything.
 */

export type RetrievalRecall = "got_it" | "partly" | "missed";

export type RetrievalPromptState = {
  index: number;
  attempts: number;
  lastRecall: RetrievalRecall | null;
  /** True once the learner has committed an attempt and seen the answer. */
  revealed: boolean;
};

export type RetrievalRoundState = {
  prompts: RetrievalPromptState[];
  /** Positions still to be asked, in order. Missed prompts are appended here. */
  queue: number[];
  activeIndex: number | null;
};

/** A prompt rated below this has not been retrieved and returns to the queue. */
const RECALL_REQUEUE: ReadonlySet<RetrievalRecall> = new Set<RetrievalRecall>(["partly", "missed"]);

/**
 * A prompt is asked at most twice. A third pass stops being retrieval practice
 * and becomes a memorisation loop the learner cannot exit.
 */
export const MAX_RETRIEVAL_ATTEMPTS = 2;

export function startRetrievalRound(promptCount: number): RetrievalRoundState {
  const prompts = Array.from({ length: promptCount }, (_unused, index) => ({
    index,
    attempts: 0,
    lastRecall: null,
    revealed: false,
  }));

  return {
    prompts,
    queue: prompts.map((prompt) => prompt.index).slice(1),
    activeIndex: promptCount > 0 ? 0 : null,
  };
}

/** Marks the active prompt as attempted so its answer may be shown. */
export function revealActivePrompt(state: RetrievalRoundState): RetrievalRoundState {
  if (state.activeIndex === null) return state;

  return {
    ...state,
    prompts: state.prompts.map((prompt) => (
      prompt.index === state.activeIndex
        ? { ...prompt, revealed: true, attempts: prompt.attempts + 1 }
        : prompt
    )),
  };
}

export function recordRecall(
  state: RetrievalRoundState,
  recall: RetrievalRecall,
): RetrievalRoundState {
  if (state.activeIndex === null) return state;
  const activeIndex = state.activeIndex;

  const prompts = state.prompts.map((prompt) => (
    prompt.index === activeIndex ? { ...prompt, lastRecall: recall } : prompt
  ));
  const active = prompts[activeIndex];
  const shouldRequeue = RECALL_REQUEUE.has(recall) && active.attempts < MAX_RETRIEVAL_ATTEMPTS;
  const queue = shouldRequeue ? [...state.queue, activeIndex] : [...state.queue];
  const nextIndex = queue.shift() ?? null;

  return {
    prompts: nextIndex === null
      ? prompts
      : prompts.map((prompt) => (
        prompt.index === nextIndex ? { ...prompt, revealed: false } : prompt
      )),
    queue,
    activeIndex: nextIndex,
  };
}

export function isRetrievalRoundComplete(state: RetrievalRoundState) {
  return state.activeIndex === null && state.queue.length === 0;
}

export type RetrievalRoundSummary = {
  total: number;
  remembered: number;
  shaky: number;
  missed: number;
  /** Positions the learner never retrieved, for the follow-up queue. */
  unresolvedIndexes: number[];
};

export function summarizeRetrievalRound(state: RetrievalRoundState): RetrievalRoundSummary {
  const rated = state.prompts.filter((prompt) => prompt.lastRecall !== null);

  return {
    total: state.prompts.length,
    remembered: rated.filter((prompt) => prompt.lastRecall === "got_it").length,
    shaky: rated.filter((prompt) => prompt.lastRecall === "partly").length,
    missed: rated.filter((prompt) => prompt.lastRecall === "missed").length,
    unresolvedIndexes: state.prompts
      .filter((prompt) => prompt.lastRecall !== null && prompt.lastRecall !== "got_it")
      .map((prompt) => prompt.index),
  };
}

import { describe, expect, it } from "vitest";
import {
  MAX_RETRIEVAL_ATTEMPTS,
  isRetrievalRoundComplete,
  recordRecall,
  revealActivePrompt,
  startRetrievalRound,
  summarizeRetrievalRound,
  type RetrievalRecall,
  type RetrievalRoundState,
} from "@/lib/learning/retrieval-round-progress";

function answer(state: RetrievalRoundState, recall: RetrievalRecall) {
  return recordRecall(revealActivePrompt(state), recall);
}

function runAll(promptCount: number, recalls: RetrievalRecall[]) {
  let state = startRetrievalRound(promptCount);
  for (const recall of recalls) {
    if (state.activeIndex === null) break;
    state = answer(state, recall);
  }
  return state;
}

describe("retrieval round queue", () => {
  it("starts on the first prompt with the rest queued", () => {
    const state = startRetrievalRound(3);
    expect(state.activeIndex).toBe(0);
    expect(state.queue).toEqual([1, 2]);
  });

  it("does not reveal an answer before the learner commits an attempt", () => {
    const state = startRetrievalRound(3);
    expect(state.prompts[0].revealed).toBe(false);
    expect(revealActivePrompt(state).prompts[0].revealed).toBe(true);
  });

  it("counts an attempt only when the answer is revealed", () => {
    const state = revealActivePrompt(startRetrievalRound(3));
    expect(state.prompts[0].attempts).toBe(1);
  });

  it("moves on when the learner retrieved the answer", () => {
    const state = answer(startRetrievalRound(3), "got_it");
    expect(state.activeIndex).toBe(1);
    expect(state.queue).toEqual([2]);
  });

  it("brings a missed prompt back before the round ends", () => {
    const state = answer(startRetrievalRound(3), "missed");
    expect(state.queue).toContain(0);
  });

  it("brings a partly-remembered prompt back too", () => {
    const state = answer(startRetrievalRound(3), "partly");
    expect(state.queue).toContain(0);
  });

  it("hides the answer again when a prompt returns", () => {
    let state = answer(startRetrievalRound(2), "missed");
    state = answer(state, "got_it");
    expect(state.activeIndex).toBe(0);
    expect(state.prompts[0].revealed).toBe(false);
  });

  it("stops asking after the attempt limit so the round can end", () => {
    const state = runAll(1, Array.from({ length: 6 }, () => "missed" as const));
    expect(state.prompts[0].attempts).toBe(MAX_RETRIEVAL_ATTEMPTS);
    expect(isRetrievalRoundComplete(state)).toBe(true);
  });

  it("completes once every prompt is retrieved", () => {
    const state = runAll(3, ["got_it", "got_it", "got_it"]);
    expect(isRetrievalRoundComplete(state)).toBe(true);
  });

  it("is not complete while prompts remain queued", () => {
    const state = answer(startRetrievalRound(3), "got_it");
    expect(isRetrievalRoundComplete(state)).toBe(false);
  });

  it("separates what was remembered from what was missed", () => {
    const state = runAll(3, ["got_it", "missed", "partly", "got_it", "got_it"]);
    const summary = summarizeRetrievalRound(state);

    expect(summary.total).toBe(3);
    expect(summary.remembered + summary.shaky + summary.missed).toBe(3);
    expect(summary.remembered).toBeGreaterThan(0);
  });

  it("reports nothing unresolved when everything was retrieved", () => {
    const summary = summarizeRetrievalRound(runAll(3, ["got_it", "got_it", "got_it"]));
    expect(summary.unresolvedIndexes).toEqual([]);
  });

  it("reports what still needs another pass", () => {
    const state = runAll(2, ["missed", "got_it", "missed"]);
    expect(summarizeRetrievalRound(state).unresolvedIndexes).toContain(0);
  });

  it("handles an empty round without stalling", () => {
    const state = startRetrievalRound(0);
    expect(state.activeIndex).toBeNull();
    expect(isRetrievalRoundComplete(state)).toBe(true);
  });
});

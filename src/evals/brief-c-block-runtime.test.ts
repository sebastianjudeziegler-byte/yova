import { describe, expect, it } from "vitest";
import { blockFixture, BLOCK_ROUTE_ID } from "./brief-c-block-fixture";
import { WorkBlockSchema } from "@/lib/session-blocks/schema";
import { BlockActionSchema, advanceBlockProgress, blockCanComplete, blockCheckpointCounts, checkedBlockEvidence, initialBlockProgress, type BlockProgress } from "@/lib/session-blocks/progress";

function fixture(profile: 1 | 2 = 1) { return WorkBlockSchema.parse(blockFixture(profile).block); }
function completeCheck(profile: 1 | 2 = 1) {
  const block = fixture(profile);
  let progress = advanceBlockProgress(block, initialBlockProgress(block.id), { action: "source_complete", sourceId: block.sources[0]!.id });
  for (const question of block.questions) progress = advanceBlockProgress(block, progress, { action: "answer", questionId: question.id, answer: "A complete answer." }, {
    questionId: question.id, outcome: "secure", assisted: false, feedback: "You established the ATP products and the direction of energy transfer.",
  });
  return { block, progress: advanceBlockProgress(block, progress, { action: "complete" }) };
}

describe("Brief C checked block progress", () => {
  it("source completed is a progress event, never evidence or a finished block", () => {
    const block = fixture();
    const progress = advanceBlockProgress(block, initialBlockProgress(block.id), { action: "source_complete", sourceId: block.sources[0]!.id });
    expect(progress.sourceCompletedIds).toEqual([block.sources[0]!.id]);
    expect(blockCheckpointCounts(block, progress)).toEqual({ completedSteps: 1, totalSteps: 3, resumeStep: 1 });
    expect(blockCanComplete(block, progress)).toBe(false);
    expect(checkedBlockEvidence(block, progress, BLOCK_ROUTE_ID)).toEqual([]);
    expect(() => advanceBlockProgress(block, progress, { action: "complete" })).toThrow(/practice check/);
  });
  it("retains the saved questions and scored first response across resume and failed help", () => {
    const block = fixture();
    let progress = initialBlockProgress(block.id);
    progress = advanceBlockProgress(block, progress, { action: "answer", questionId: block.questions[0]!.id, answer: "ADP and inorganic phosphate" }, {
      questionId: block.questions[0]!.id, outcome: "secure", assisted: false, feedback: "You identified both products of ATP hydrolysis.",
    });
    const reopened = advanceBlockProgress(block, JSON.parse(JSON.stringify(progress)) as BlockProgress, { action: "state" });
    expect(reopened).toEqual(progress);
    expect(advanceBlockProgress(block, reopened, { action: "answer", questionId: block.questions[0]!.id, answer: "A changed answer" })).toEqual(progress);
    expect(block.questions[1]!.prompt).toMatch(/why can a cell couple/i);
    expect(() => advanceBlockProgress(block, { ...progress, blockId: crypto.randomUUID() }, { action: "state" })).toThrow(/another block/);
  });
  it("reveal and report let the learner continue without claiming understanding", () => {
    const block = fixture();
    let progress = advanceBlockProgress(block, initialBlockProgress(block.id), { action: "source_complete", sourceId: block.sources[0]!.id });
    progress = advanceBlockProgress(block, progress, { action: "reveal", questionId: block.questions[0]!.id });
    progress = advanceBlockProgress(block, progress, { action: "report", questionId: block.questions[1]!.id });
    progress = advanceBlockProgress(block, progress, { action: "complete" });
    expect(progress.attempts.every(attempt => attempt.outcome === "unscored")).toBe(true);
    expect(progress.attempts[1]!.feedback).toMatch(/can continue/);
    expect(checkedBlockEvidence(block, progress, BLOCK_ROUTE_ID)).toEqual([]);
    expect(progress.receipt).toMatch(/unverified|not yet demonstrated/);
  });
  it("a hint-supported response is not recorded as independent evidence", () => {
    const { block } = completeCheck();
    let progress = advanceBlockProgress(block, initialBlockProgress(block.id), { action: "hint", questionId: block.questions[0]!.id });
    progress = advanceBlockProgress(block, progress, { action: "answer", questionId: block.questions[0]!.id, answer: "ADP and inorganic phosphate" }, {
      questionId: block.questions[0]!.id, outcome: "secure", assisted: false, feedback: "Both products are present in your answer.",
    });
    expect(progress.hintCounts[block.questions[0]!.id]).toBe(1);
    expect(progress.attempts[0]!.assisted).toBe(true);
  });
  it("targeted help before checking cannot become independent evidence, including after resume", () => {
    const block = fixture(2); const question = block.questions[0]!;
    let progress = advanceBlockProgress(block, initialBlockProgress(block.id), BlockActionSchema.parse({ action: "help_requested", questionId: question.id }));
    progress = advanceBlockProgress(block, JSON.parse(JSON.stringify(progress)), { action: "answer", questionId: question.id, answer: "ADP and inorganic phosphate" }, {
      questionId: question.id, outcome: "secure", assisted: false, feedback: "Both products are present.",
    });
    expect(progress.attempts[0]!.assisted).toBe(true);
    expect(progress.complete).toBe(false);
  });
  it("reporting a checked bad question preserves the response but excludes it from evidence and the receipt", () => {
    const { block, progress: finished } = completeCheck();
    const before = { ...finished, complete: false, receipt: null };
    const reported = advanceBlockProgress(block, before, { action: "report", questionId: block.questions[0]!.id });
    expect(reported.attempts).toEqual(before.attempts);
    const complete = advanceBlockProgress(block, reported, { action: "complete" });
    expect(checkedBlockEvidence(block, complete, BLOCK_ROUTE_ID)).toHaveLength(1);
    expect(complete.receipt).toMatch(/demonstrated 1.*1 answer remains unverified/);
  });
  it("completed profile receipts explain the result, recorded change and next step", () => {
    const p1 = completeCheck(1); const p2 = completeCheck(2);
    expect(p1.progress.receipt).toMatch(/demonstrated 2.*short check.*recorded.*next planned block/);
    expect(p2.progress.receipt).toMatch(/demonstrated 3.*own words.*recorded.*next planned block/);
    expect(p1.progress.receipt).not.toBe(p2.progress.receipt);
    expect(checkedBlockEvidence(p1.block, p1.progress, BLOCK_ROUTE_ID)).toHaveLength(2);
  });
  it("rejects client outcomes, foreign sources, foreign questions and an unscored answer claim", () => {
    const block = fixture(); const progress = initialBlockProgress(block.id);
    expect(BlockActionSchema.safeParse({ action: "answer", questionId: block.questions[0]!.id, answer: "ATP", outcome: "secure" }).success).toBe(false);
    expect(BlockActionSchema.safeParse({ action: "complete", conceptEvidence: [{ outcome: "secure" }] }).success).toBe(false);
    expect(() => advanceBlockProgress(block, progress, { action: "source_complete", sourceId: "other-topic-pdf" })).toThrow(/not a required/);
    expect(() => advanceBlockProgress(block, progress, { action: "reveal", questionId: "other-topic-question" })).toThrow(/not in/);
    expect(() => advanceBlockProgress(block, progress, { action: "answer", questionId: block.questions[0]!.id, answer: "ATP" })).toThrow(/server-checked/);
  });
});

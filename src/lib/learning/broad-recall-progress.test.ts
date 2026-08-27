import { describe, expect, it } from "vitest";
import {
  broadRecallDurableStage,
  broadRecallProgressIsComplete,
  broadRecallProgressRank,
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  mergeBroadRecallProgress,
  readBroadRecallProgress,
  recordBroadRecallTransferEvaluation,
  startBroadRecallProgress,
  type BroadRecallGapStatus,
  type BroadRecallTransferResult,
} from "@/lib/learning/broad-recall-progress";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

const TARGET_A = "11111111-1111-4111-8111-111111111111";
const TARGET_B = "22222222-2222-4222-8222-222222222222";

const BINDINGS = [TARGET_A, TARGET_B].map((targetId) => ({
  targetId,
  evidenceId: blurtingFinalCheckEvidenceId(targetId),
}));

function start(overrides: {
  activityIndex?: number;
  gapCount?: number;
  bindings?: typeof BINDINGS;
} = {}) {
  const progress = startBroadRecallProgress({
    activityIndex: overrides.activityIndex ?? 2,
    gapCount: overrides.gapCount ?? 3,
    bindings: overrides.bindings ?? BINDINGS,
  });
  expect(progress).not.toBeNull();
  return progress!;
}

function compare(
  progress = start(),
  statuses: readonly BroadRecallGapStatus[] = ["covered", "partial", "missing"],
) {
  const next = completeBroadRecallComparison(progress, statuses);
  expect(next).not.toBeNull();
  return next!;
}

function correct(progress = compare()) {
  const next = completeBroadRecallCorrection(progress);
  expect(next).not.toBeNull();
  return next!;
}

function transfer(
  progress = correct(),
  results: readonly BroadRecallTransferResult[] = ["secure", "needs_review"],
) {
  const next = recordBroadRecallTransferEvaluation(progress, results);
  expect(next).not.toBeNull();
  return next!;
}

describe("broad-recall privacy-safe progress", () => {
  it("advances through the canonical durable stage prefix", () => {
    const initial = start();
    const afterComparison = compare(initial);
    const afterCorrection = correct(afterComparison);
    const complete = transfer(afterCorrection);

    expect([
      [broadRecallProgressRank(initial), broadRecallDurableStage(initial)],
      [broadRecallProgressRank(afterComparison), broadRecallDurableStage(afterComparison)],
      [broadRecallProgressRank(afterCorrection), broadRecallDurableStage(afterCorrection)],
      [broadRecallProgressRank(complete), broadRecallDurableStage(complete)],
    ]).toEqual([
      [0, "broad_attempt"],
      [1, "gap_repair"],
      [2, "closed_source_transfer"],
      [3, "complete"],
    ]);
    expect(broadRecallProgressIsComplete(initial)).toBe(false);
    expect(broadRecallProgressIsComplete(complete)).toBe(true);
    expect(complete.events).toEqual([
      {
        type: "comparison_completed",
        gapStatuses: ["covered", "partial", "missing"],
      },
      { type: "correction_completed" },
      { type: "transfer_evaluated", results: ["secure", "needs_review"] },
    ]);
  });

  it("never mutates an earlier prefix and deep-freezes every accepted value", () => {
    const initial = start();
    const initialSnapshot = structuredClone(initial);
    const afterComparison = compare(initial);
    const afterCorrection = correct(afterComparison);
    const complete = transfer(afterCorrection);

    expect(initial).toEqual(initialSnapshot);
    expect(initial.events).toEqual([]);
    expect(afterComparison.events).toHaveLength(1);
    expect(afterCorrection.events).toHaveLength(2);
    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.isFrozen(complete.bindings)).toBe(true);
    expect(Object.isFrozen(complete.bindings[0])).toBe(true);
    expect(Object.isFrozen(complete.events)).toBe(true);
    expect(Object.isFrozen(complete.events[0])).toBe(true);
    expect(Object.isFrozen(complete.events[2])).toBe(true);
    expect(Object.isFrozen(complete.events[2]?.type === "transfer_evaluated"
      ? complete.events[2].results
      : null)).toBe(true);
    expect(() => {
      (complete.bindings as Array<{ targetId: string; evidenceId: string }>).push(BINDINGS[0]!);
    }).toThrow(TypeError);
  });

  it("rejects raw learner or generated text at every persisted seam", () => {
    const privateText = "PRIVATE LEARNER ANSWER";
    const initial = start();

    expect(readBroadRecallProgress({ ...initial, answerDraft: privateText })).toBeNull();
    expect(readBroadRecallProgress({
      ...initial,
      bindings: [{ ...initial.bindings[0], learnerAnswer: privateText }],
    })).toBeNull();
    expect(readBroadRecallProgress({
      ...initial,
      events: [{
        type: "comparison_completed",
        gapStatuses: ["covered", "partial", "missing"],
        comparisonSourceText: privateText,
      }],
    })).toBeNull();
    expect(JSON.stringify(transfer())).not.toContain(privateText);
    expect(JSON.stringify(transfer())).not.toMatch(/answer|prompt|sourceText|concept/i);
  });

  it("requires exact unique final-check bindings", () => {
    expect(startBroadRecallProgress({
      activityIndex: 0,
      gapCount: 1,
      bindings: [{ targetId: TARGET_A, evidenceId: "different-evidence" }],
    })).toBeNull();
    expect(startBroadRecallProgress({
      activityIndex: 0,
      gapCount: 1,
      bindings: [BINDINGS[0]!, BINDINGS[0]!],
    })).toBeNull();
  });

  it("requires complete bounded event payloads in their exact order", () => {
    const initial = start();
    expect(completeBroadRecallComparison(initial, ["covered"])).toBeNull();
    expect(completeBroadRecallCorrection(initial)).toBeNull();
    expect(recordBroadRecallTransferEvaluation(initial, ["secure", "secure"])).toBeNull();

    const afterComparison = compare(initial);
    expect(completeBroadRecallComparison(afterComparison, [
      "covered",
      "partial",
      "missing",
    ])).toBeNull();
    expect(recordBroadRecallTransferEvaluation(afterComparison, ["secure", "secure"])).toBeNull();
    expect(recordBroadRecallTransferEvaluation(correct(afterComparison), ["secure"])).toBeNull();

    expect(readBroadRecallProgress({
      ...initial,
      events: [{ type: "correction_completed" }],
    })).toBeNull();
  });
});

describe("broad-recall progress merge", () => {
  it("is idempotent for equal immutable histories", () => {
    const progress = compare();
    const result = mergeBroadRecallProgress(progress, structuredClone(progress));

    expect(result).toMatchObject({ kind: "merged", source: "equal" });
    expect(result.kind === "merged" ? result.progress : null).toEqual(progress);
  });

  it("selects the structurally longer prefix regardless of argument order", () => {
    const shorter = compare();
    const longer = transfer(correct(shorter), ["unverified", "secure"]);

    const forward = mergeBroadRecallProgress(shorter, longer);
    const reverse = mergeBroadRecallProgress(longer, shorter);

    expect(forward).toMatchObject({ kind: "merged", source: "right", progress: longer });
    expect(reverse).toMatchObject({ kind: "merged", source: "left", progress: longer });
  });

  it("returns an explicit identity conflict rather than guessing", () => {
    const progress = compare();
    const differentActivity = compare(start({ activityIndex: 3 }));
    const reversedBindings = compare(start({ bindings: [...BINDINGS].reverse() }));

    expect(mergeBroadRecallProgress(progress, differentActivity)).toEqual({
      kind: "conflict",
      reason: "identity_mismatch",
    });
    expect(mergeBroadRecallProgress(progress, reversedBindings)).toEqual({
      kind: "conflict",
      reason: "identity_mismatch",
    });
  });

  it("rejects any divergence inside the shared event prefix", () => {
    const leftComparison = compare(start(), ["covered", "partial", "missing"]);
    const rightComparison = compare(start(), ["partial", "partial", "missing"]);
    const leftComplete = transfer(correct(leftComparison), ["secure", "needs_review"]);
    const rightComplete = transfer(correct(leftComparison), ["secure", "unverified"]);

    expect(mergeBroadRecallProgress(leftComparison, rightComparison)).toEqual({
      kind: "conflict",
      reason: "event_divergence",
    });
    expect(mergeBroadRecallProgress(leftComplete, rightComplete)).toEqual({
      kind: "conflict",
      reason: "event_divergence",
    });
  });

  it("does not mutate either input and returns deeply frozen progress", () => {
    const shorter = compare();
    const longer = correct(shorter);
    const shorterSnapshot = structuredClone(shorter);
    const longerSnapshot = structuredClone(longer);
    const result = mergeBroadRecallProgress(shorter, longer);

    expect(shorter).toEqual(shorterSnapshot);
    expect(longer).toEqual(longerSnapshot);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.progress)).toBe(true);
    expect(Object.isFrozen(result.progress.events)).toBe(true);
  });

  it("rejects malformed progress explicitly", () => {
    expect(mergeBroadRecallProgress(start(), { kind: "broad_recall" })).toEqual({
      kind: "conflict",
      reason: "invalid_progress",
    });
  });
});

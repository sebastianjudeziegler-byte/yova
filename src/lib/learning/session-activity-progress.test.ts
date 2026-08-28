import { describe, expect, it } from "vitest";
import {
  appendRetrievalRoundRating,
  isBroadRecallActivityProgress,
  mergeSessionActivityProgress,
  readSessionActivityProgress,
  retrievalRoundActivityProgressIsComplete,
  restoreRetrievalRoundActivityProgress,
  sessionActivityProgressIsResumable,
  sessionActivityProgressHasRequiredRouteIdentity,
  sessionActivityProgressRank,
  type SessionActivityProgress,
} from "@/lib/learning/session-activity-progress";
import {
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  startBroadRecallProgress,
} from "@/lib/learning/broad-recall-progress";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

function broadRecallProgress() {
  const progress = startBroadRecallProgress({
    activityIndex: 2,
    gapCount: 2,
    bindings: [{
      targetId: TARGET_ID,
      evidenceId: blurtingFinalCheckEvidenceId(TARGET_ID),
    }],
  });
  expect(progress).not.toBeNull();
  return progress!;
}

describe("session activity recovery progress", () => {
  it("restores the active prompt and retry queue from ratings alone", () => {
    const initial = restoreRetrievalRoundActivityProgress({
      progress: null,
      activityIndex: 2,
      promptCount: 3,
    });
    const afterPartial = appendRetrievalRoundRating(initial.progress, "partly");

    const restored = restoreRetrievalRoundActivityProgress({
      progress: afterPartial,
      activityIndex: 2,
      promptCount: 3,
    });

    expect(restored.state.activeIndex).toBe(1);
    expect(restored.state.queue).toEqual([2, 0]);
    expect(restored.state.prompts[0]).toMatchObject({
      attempts: 1,
      lastRecall: "partly",
      revealed: true,
    });
  });

  it("never accepts draft text or a rating after the round is complete", () => {
    expect(readSessionActivityProgress({
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: ["got_it", "got_it", "got_it"],
      answerDraft: "PRIVATE LEARNER ANSWER",
    })).toBeNull();
    expect(readSessionActivityProgress({
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: ["got_it", "got_it", "got_it", "missed"],
    })).toBeNull();
  });

  it("ignores progress from a different activity or generated prompt set", () => {
    const saved = {
      kind: "retrieval_round" as const,
      activityIndex: 1,
      promptCount: 3,
      ratings: ["missed" as const],
    };

    expect(restoreRetrievalRoundActivityProgress({
      progress: saved,
      activityIndex: 2,
      promptCount: 3,
    }).progress.ratings).toEqual([]);
    expect(restoreRetrievalRoundActivityProgress({
      progress: saved,
      activityIndex: 1,
      promptCount: 4,
    }).progress.ratings).toEqual([]);
  });

  it("unlocks the outer activity only after every queued recall is rated", () => {
    const progress: SessionActivityProgress = {
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: ["partly", "got_it", "got_it"],
    };

    expect(retrievalRoundActivityProgressIsComplete({
      progress,
      activityIndex: 0,
      promptCount: 3,
    })).toBe(false);
    expect(retrievalRoundActivityProgressIsComplete({
      progress: { ...progress, ratings: [...progress.ratings, "got_it"] },
      activityIndex: 0,
      promptCount: 3,
    })).toBe(true);
  });

  it("preserves the deployed retrieval marker shape byte-for-byte", () => {
    const legacy = {
      kind: "retrieval_round" as const,
      activityIndex: 1,
      promptCount: 3,
      ratings: ["partly" as const],
    };

    const restored = readSessionActivityProgress(legacy);

    expect(restored).toEqual(legacy);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(legacy));
    expect(restored).not.toHaveProperty("format");
    expect(restored).not.toHaveProperty("events");
  });

  it("reads strict broad-recall prefixes without assuming ratings", () => {
    const initial = broadRecallProgress();
    const compared = completeBroadRecallComparison(initial, ["covered", "missing"]);
    expect(compared).not.toBeNull();

    const restored = readSessionActivityProgress(structuredClone(compared));

    expect(isBroadRecallActivityProgress(restored)).toBe(true);
    expect(sessionActivityProgressRank(restored ?? undefined)).toBe(1);
    expect(sessionActivityProgressIsResumable(restored)).toBe(true);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.kind === "broad_recall" ? restored.events : null)).toBe(true);
    expect(readSessionActivityProgress({
      ...compared,
      answerDraft: "PRIVATE LEARNER ANSWER",
    })).toBeNull();
  });

  it("treats a bound empty broad prefix as resumable but keeps empty retrieval legacy behavior", () => {
    const broad = broadRecallProgress();
    const retrieval: SessionActivityProgress = {
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: [],
    };

    expect(sessionActivityProgressIsResumable(broad)).toBe(true);
    expect(sessionActivityProgressIsResumable(retrieval)).toBe(false);
    expect(sessionActivityProgressHasRequiredRouteIdentity(broad, undefined)).toBe(false);
    expect(sessionActivityProgressHasRequiredRouteIdentity(broad, "not-a-route-id")).toBe(false);
    expect(sessionActivityProgressHasRequiredRouteIdentity(
      broad,
      "00000000-0000-4000-8000-000000000101",
    )).toBe(true);
    expect(sessionActivityProgressHasRequiredRouteIdentity(retrieval, undefined)).toBe(true);
  });

  it("merges only compatible immutable prefixes and reports divergence explicitly", () => {
    const initial = broadRecallProgress();
    const compared = completeBroadRecallComparison(initial, ["covered", "missing"]);
    const corrected = compared ? completeBroadRecallCorrection(compared) : null;
    expect(compared).not.toBeNull();
    expect(corrected).not.toBeNull();

    expect(mergeSessionActivityProgress(compared, corrected)).toMatchObject({
      kind: "merged",
      source: "right",
      progress: corrected,
    });
    expect(mergeSessionActivityProgress(compared, {
      ...compared,
      activityIndex: 3,
    })).toEqual({
      kind: "conflict",
      reason: "identity_mismatch",
    });
    expect(mergeSessionActivityProgress(compared, {
      ...compared,
      events: [{
        type: "comparison_completed",
        gapStatuses: ["partial", "missing"],
      }],
    })).toEqual({
      kind: "conflict",
      reason: "event_divergence",
    });
    expect(mergeSessionActivityProgress(compared, {
      kind: "retrieval_round",
      activityIndex: 2,
      promptCount: 3,
      ratings: ["partly"],
    })).toEqual({
      kind: "conflict",
      reason: "identity_mismatch",
    });
  });

  it("distinguishes an absent marker from null or malformed persisted data", () => {
    const broad = broadRecallProgress();

    expect(mergeSessionActivityProgress(undefined, undefined)).toEqual({
      kind: "merged",
      source: "equal",
      progress: undefined,
    });
    expect(mergeSessionActivityProgress(undefined, broad)).toMatchObject({
      kind: "merged",
      source: "right",
      progress: broad,
    });
    expect(mergeSessionActivityProgress(null, broad)).toEqual({
      kind: "conflict",
      reason: "invalid_progress",
    });
    expect(mergeSessionActivityProgress({ kind: "broad_recall" }, undefined)).toEqual({
      kind: "conflict",
      reason: "invalid_progress",
    });
  });
});

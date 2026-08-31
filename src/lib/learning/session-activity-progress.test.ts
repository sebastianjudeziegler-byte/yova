import { describe, expect, it } from "vitest";
import {
  appendRetrievalRoundRating,
  isRetiredSessionActivityProgressMarker,
  mergeSessionActivityProgress,
  readSessionActivityProgress,
  retrievalRoundActivityProgressIsComplete,
  restoreRetrievalRoundActivityProgress,
  sessionActivityProgressIsResumable,
  sessionActivityProgressMatchesLessonRuntime,
  stripRetiredSessionActivityProgressMarker,
  type SessionActivityProgress,
} from "@/lib/learning/session-activity-progress";

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

  it("keeps empty retrieval markers non-resumable", () => {
    const retrieval: SessionActivityProgress = {
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: [],
    };

    expect(sessionActivityProgressIsResumable(retrieval)).toBe(false);
  });

  it("keeps recovery progress only for its exact generated runtime", () => {
    const retrieval: SessionActivityProgress = {
      kind: "retrieval_round",
      activityIndex: 1,
      promptCount: 3,
      ratings: ["partly"],
    };
    const retrievalActivities = [{ methodRuntime: null }, {
      sourceActivityIndex: 1,
      methodRuntime: {
        kind: "retrieval_round",
        prompts: [{}, {}, {}],
      },
    }];

    expect(sessionActivityProgressMatchesLessonRuntime(retrieval, retrievalActivities)).toBe(true);
    expect(sessionActivityProgressMatchesLessonRuntime(retrieval, [
      { methodRuntime: null },
      { methodRuntime: { kind: "retrieval_round", prompts: [{}, {}] } },
    ])).toBe(false);
  });

  it("merges only compatible immutable rating prefixes", () => {
    const shorter = {
      kind: "retrieval_round" as const,
      activityIndex: 2,
      promptCount: 3,
      ratings: ["partly" as const],
    };
    const longer = { ...shorter, ratings: ["partly" as const, "got_it" as const] };

    expect(mergeSessionActivityProgress(shorter, longer)).toMatchObject({
      kind: "merged",
      source: "right",
      progress: longer,
    });
    expect(mergeSessionActivityProgress(shorter, {
      ...shorter,
      activityIndex: 3,
    })).toEqual({
      kind: "conflict",
      reason: "identity_mismatch",
    });
    expect(mergeSessionActivityProgress(shorter, {
      ...shorter,
      ratings: ["missed"],
    })).toEqual({
      kind: "conflict",
      reason: "event_divergence",
    });
  });

  it("distinguishes an absent marker from null or malformed persisted data", () => {
    const retrieval = {
      kind: "retrieval_round" as const,
      activityIndex: 0,
      promptCount: 3,
      ratings: ["partly" as const],
    };

    expect(mergeSessionActivityProgress(undefined, undefined)).toEqual({
      kind: "merged",
      source: "equal",
      progress: undefined,
    });
    expect(mergeSessionActivityProgress(undefined, retrieval)).toMatchObject({
      kind: "merged",
      source: "right",
      progress: retrieval,
    });
    expect(mergeSessionActivityProgress(null, retrieval)).toEqual({
      kind: "conflict",
      reason: "invalid_progress",
    });
  });

  it("recognizes a retired raw marker only to remove it from its saved envelope", () => {
    const envelope = {
      id: "saved-exit",
      completedSteps: 0,
      activityProgress: {
        kind: "broad_recall",
        arbitraryLegacyPayload: "ignored",
      },
    };

    expect(isRetiredSessionActivityProgressMarker(envelope.activityProgress)).toBe(true);
    expect(readSessionActivityProgress(envelope.activityProgress)).toBeNull();
    expect(stripRetiredSessionActivityProgressMarker(envelope)).toEqual({
      id: "saved-exit",
      completedSteps: 0,
    });
    expect(envelope).toHaveProperty("activityProgress");
    expect(mergeSessionActivityProgress(envelope.activityProgress, undefined)).toEqual({
      kind: "conflict",
      reason: "invalid_progress",
    });
  });
});

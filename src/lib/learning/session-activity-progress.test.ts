import { describe, expect, it } from "vitest";
import {
  appendRetrievalRoundRating,
  readSessionActivityProgress,
  retrievalRoundActivityProgressIsComplete,
  restoreRetrievalRoundActivityProgress,
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
});

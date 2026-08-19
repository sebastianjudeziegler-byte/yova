import { describe, expect, it } from "vitest";
import {
  asUnguidedPracticeCompletion,
  completionCreatesTopicEvidence,
  normalizeSessionCompletionProvenance,
  normalizeSessionCompletionMode,
} from "@/lib/learning/session-completion-provenance";

describe("session completion provenance", () => {
  it("treats missing and unknown legacy provenance as guided", () => {
    expect(normalizeSessionCompletionMode(undefined)).toBe("guided");
    expect(normalizeSessionCompletionMode("future_value")).toBe("guided");
    expect(completionCreatesTopicEvidence({})).toBe(true);
  });

  it("keeps unguided practice outside the topic-evidence boundary", () => {
    expect(normalizeSessionCompletionMode("unguided_practice")).toBe("unguided_practice");
    expect(completionCreatesTopicEvidence({ completionMode: "unguided_practice" })).toBe(false);
  });

  it("force-clears every knowledge-bearing field for unguided practice", () => {
    const completion = asUnguidedPracticeCompletion({
      id: "10000000-1000-4000-8000-000000000001",
      planId: "10000000-1000-4000-8000-000000000002",
      planSessionId: "10000000-1000-4000-8000-000000000003",
      startedAt: "2026-08-19T18:00:00.000Z",
      completedAt: "2026-08-19T18:10:00.000Z",
      plannedMinutes: 10,
      actualMinutes: 10,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "Claimed evidence",
      conceptEvidence: [{
        concept: "Claimed evidence",
        outcome: "secure",
        activityType: "free_response",
      }],
      confidenceEvidence: [{
        concept: "Claimed evidence",
        confidence: "very_sure",
        correct: true,
        activityType: "free_response",
      }],
    });

    expect(completion).toMatchObject({
      completionMode: "unguided_practice",
      correctAnswers: 0,
      totalAnswers: 0,
      conceptEvidence: [],
      confidenceEvidence: [],
    });
    expect(normalizeSessionCompletionProvenance(completion)).toEqual(completion);
  });
});

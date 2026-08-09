import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion } from "@/lib/domain";
import {
  buildConceptReviewAgenda,
  buildConceptReviewSession,
} from "@/lib/learning/concept-review-agenda";

const now = new Date("2026-08-06T18:00:00.000Z");

function plan(status: LearningPlan["status"]): LearningPlan {
  return {
    id: "plan-1",
    learningItemId: "item-1",
    title: "AP Biology Unit 3",
    topic: "Cellular respiration",
    kind: "test",
    deadline: null,
    status,
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Prepare through retrieval and repair.",
    createdAt: "2026-08-01T18:00:00.000Z",
    sessions: [{
      id: "session-1",
      sequence: 1,
      title: "Focused retrieval",
      objective: "Retrieve the process.",
      method: "Retrieval practice",
      methodReason: "Produce evidence from memory.",
      scheduledFor: "2026-08-05T16:00:00.000Z",
      estimatedMinutes: 20,
      amountLabel: "20 min",
      learningMode: "study",
      status: "complete",
    }],
  };
}

function completion(): SessionCompletion {
  return {
    id: "completion-1",
    planId: "plan-1",
    planSessionId: "session-1",
    startedAt: "2026-08-05T15:40:00.000Z",
    completedAt: "2026-08-05T16:00:00.000Z",
    plannedMinutes: 20,
    actualMinutes: 20,
    correctAnswers: 0,
    totalAnswers: 1,
    feedback: "about_right",
    observedGap: "Electron transport chain",
    conceptEvidence: [{
      topicId: "11111111-1111-4111-8111-111111111111",
      concept: "Electron transport chain",
      outcome: "needs_review",
      activityType: "free_response",
    }],
    confidenceEvidence: [],
  };
}

describe("concept review agenda", () => {
  it("reopens a completed goal when its retrieval return is due", () => {
    const [item] = buildConceptReviewAgenda([plan("completed")], [completion()], now);
    expect(item).toMatchObject({
      concept: "Electron transport chain",
      timing: "due",
      action: "activate_review",
    });
  });

  it("routes a due concept into the next session of an active goal", () => {
    const [item] = buildConceptReviewAgenda([plan("active")], [completion()], now);
    expect(item.action).toBe("start_next_session");
  });

  it("builds one bounded review session on the original plan", () => {
    const [item] = buildConceptReviewAgenda([plan("completed")], [completion()], now);
    const session = buildConceptReviewSession(plan("completed"), item, now);

    expect(session).toMatchObject({
      sequence: 2,
      estimatedMinutes: 10,
      learningMode: "study",
      status: "ready",
      reviewConcept: "Electron transport chain",
      reviewType: "repair_and_retrieve",
      topicIds: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(session.methodReason).toContain("reopened this goal");
  });
});

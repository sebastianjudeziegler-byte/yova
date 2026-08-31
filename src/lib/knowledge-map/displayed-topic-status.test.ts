import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionCompletion } from "@/lib/domain";
import { displayedTopicStatus } from "@/lib/knowledge-map/displayed-topic-status";

const topicId = "10000000-1000-4000-8000-000000000001";
const sessionId = "10000000-1000-4000-8000-000000000002";

function plan(): LearningPlan {
  return {
    id: "10000000-1000-4000-8000-000000000003",
    learningItemId: "10000000-1000-4000-8000-000000000004",
    title: "Arbitrary topic",
    topic: "Understand an arbitrary topic",
    kind: "topic",
    deadline: null,
    status: "completed",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Complete one bounded session.",
    createdAt: "2026-08-19T18:00:00.000Z",
    sessions: [{
      id: sessionId,
      sequence: 1,
      title: "Practice the target",
      objective: "Practice the target with a chosen method.",
      method: "Self-explanation",
      methodReason: "Make the relationship explicit.",
      scheduledFor: "2026-08-19T18:00:00.000Z",
      estimatedMinutes: 15,
      amountLabel: "One bounded target",
      learningMode: "study",
      topicIds: [topicId],
      status: "complete",
    }],
  };
}

function completion(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    id: "10000000-1000-4000-8000-000000000005",
    planId: plan().id,
    planSessionId: sessionId,
    startedAt: "2026-08-19T18:00:00.000Z",
    completedAt: "2026-08-19T18:15:00.000Z",
    plannedMinutes: 15,
    actualMinutes: 15,
    correctAnswers: 0,
    totalAnswers: 0,
    feedback: "about_right",
    observedGap: "No topic evidence recorded.",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

describe("displayedTopicStatus", () => {
  it("leaves a topic unchanged after explicit unguided practice", () => {
    expect(displayedTopicStatus(topicId, "not_started", plan(), [completion({
      completionMode: "unguided_practice",
      conceptEvidence: [{
        topicId,
        concept: "Arbitrary topic",
        outcome: "secure",
        activityType: "free_response",
      }],
    })])).toBe("not_started");
  });

  it("keeps legacy guided completion behavior", () => {
    expect(displayedTopicStatus(topicId, "not_started", plan(), [completion()])).toBe("taught");
    expect(displayedTopicStatus(topicId, "not_started", plan(), [])).toBe("taught");
  });

  it("still derives evidence from a guided completion", () => {
    expect(displayedTopicStatus(topicId, "not_started", plan(), [completion({
      completionMode: "guided",
      conceptEvidence: [{
        topicId,
        concept: "Arbitrary topic",
        outcome: "needs_review",
        activityType: "free_response",
      }],
    })])).toBe("evidenced");
  });

  it("does not advance a topic from a correct pretest prediction", () => {
    const currentPlan = plan();
    currentPlan.sessions[0]!.status = "ready";

    expect(displayedTopicStatus(topicId, "not_started", currentPlan, [completion({
      completionMode: "guided",
      conceptEvidence: [{
        topicId,
        concept: "Arbitrary topic",
        outcome: "secure",
        activityType: "multiple_choice",
        methodPhase: "pretest",
      }],
    })])).toBe("not_started");
  });
});

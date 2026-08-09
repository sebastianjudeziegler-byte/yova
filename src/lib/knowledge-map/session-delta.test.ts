import { describe, expect, it } from "vitest";
import type { ConceptEvidence, LearningPlanSession } from "@/lib/domain";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { buildSessionMapDelta } from "@/lib/knowledge-map/session-delta";

const topicId = "10000000-1000-4000-8000-000000000001";

function map(status: "not_started" | "taught" | "evidenced" | "secure") {
  return PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Focused skill",
      minimumSessions: 1,
      recommendedSessions: 2,
      maximumSessions: 4,
      minimumTeachingSessions: 1,
      explanation: "The plan covers one bounded concept and the evidence needed to verify it.",
    },
    topics: [{
      id: topicId,
      title: "Photosynthesis",
      description: "Explain how light energy becomes stored chemical energy.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  });
}

function session(learningMode: "learn" | "study"): LearningPlanSession {
  return {
    id: "10000000-1000-4000-8000-000000000010",
    sequence: 1,
    title: "Build the model",
    objective: "Explain photosynthesis after the model is hidden.",
    method: "Guided explanation and self-explanation",
    methodReason: "A first model precedes independent evidence.",
    scheduledFor: "2026-08-09T17:00:00.000Z",
    estimatedMinutes: 20,
    amountLabel: "One topic and one check",
    learningMode,
    topicIds: [topicId],
    contentTargets: ["Photosynthesis"],
    completionEvidence: ["Explain the process without the model"],
    status: "ready",
  };
}

describe("post-session knowledge-map delta", () => {
  it("shows a taught movement after a teaching session without answer evidence", () => {
    expect(buildSessionMapDelta(map("not_started"), session("learn"), [])).toEqual([{
      topicId,
      title: "Photosynthesis",
      from: "not_started",
      to: "taught",
    }]);
  });

  it("shows evidence recorded when the learner produced concept evidence", () => {
    const evidence: ConceptEvidence[] = [{
      topicId,
      concept: "Photosynthesis",
      outcome: "needs_review",
      activityType: "free_response",
    }];
    expect(buildSessionMapDelta(map("taught"), session("study"), evidence)[0]).toMatchObject({
      from: "taught",
      to: "evidenced",
    });
  });

  it("shows nothing when the session did not move a mapped topic", () => {
    expect(buildSessionMapDelta(map("evidenced"), session("study"), [])).toEqual([]);
  });
});

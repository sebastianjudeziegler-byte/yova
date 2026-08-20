import { describe, expect, it } from "vitest";
import { accountForEveryKnowledgeMapTopic } from "@/lib/plan-generation/normalize-learning-contract";
import { describesLearnerAsAType } from "@/lib/plan-generation/quality-gate";
import type { GeneratedPlanDraft, PlanGenerationRequest } from "@/lib/plan-generation/schema";

const TOPIC = (n: number) => `10000000-1000-4000-8000-${String(n).padStart(12, "0")}`;

function request(topicCount: number): PlanGenerationRequest {
  return {
    knowledgeMap: {
      topics: Array.from({ length: topicCount }, (_unused, index) => ({ id: TOPIC(index + 1) })),
    },
  } as unknown as PlanGenerationRequest;
}

function draft(scheduled: string[][], deferred: string[] = []): GeneratedPlanDraft {
  return {
    sessions: scheduled.map((topicIds) => ({ topicIds })),
    deferredTopics: deferred.map((topicId) => ({ topicId, reason: "Model supplied reason for deferring." })),
  } as unknown as GeneratedPlanDraft;
}

describe("accounting for every knowledge-map topic", () => {
  it("leaves a plan alone when every topic is already accounted for", () => {
    const input = draft([[TOPIC(1)], [TOPIC(2)]], [TOPIC(3)]);
    expect(accountForEveryKnowledgeMapTopic(input, request(3))).toBe(input);
  });

  it("defers a topic the model forgot instead of failing the plan", () => {
    const result = accountForEveryKnowledgeMapTopic(draft([[TOPIC(1)]]), request(3));

    expect(result.deferredTopics.map((topic) => topic.topicId)).toEqual([TOPIC(2), TOPIC(3)]);
  });

  it("keeps the session when a topic is both scheduled and deferred", () => {
    const result = accountForEveryKnowledgeMapTopic(draft([[TOPIC(1)]], [TOPIC(1)]), request(1));

    expect(result.deferredTopics).toEqual([]);
  });

  it("gives every auto-deferred topic a learner-facing reason", () => {
    const result = accountForEveryKnowledgeMapTopic(draft([[TOPIC(1)]]), request(2));

    expect(result.deferredTopics[0]?.reason.length).toBeGreaterThan(8);
  });

  it("does nothing when the request carries no knowledge map", () => {
    const input = draft([[TOPIC(1)]]);
    expect(accountForEveryKnowledgeMapTopic(input, {} as PlanGenerationRequest)).toBe(input);
  });

  it("does not invent coverage for a session that maps to no topic", () => {
    // A session covering nothing is a misunderstanding, not lost bookkeeping,
    // and must still reach the quality gate as a failure.
    const result = accountForEveryKnowledgeMapTopic(draft([[]]), request(1));

    expect(result.sessions[0].topicIds).toEqual([]);
  });
});

describe("describing the learner as a type", () => {
  const claims: Array<[string, boolean]> = [
    ["You learn best from worked examples", true],
    ["Because of your ADHD this session is shorter", true],
    ["Your diagnosis means we will go slower", true],
    ["The diagnosis proves diagrams are the only useful format", true],
    ["This plan will diagnose the learner before teaching", true],
    ["Your visual learner profile shapes this plan", true],
    // Ordinary teaching language about diagnosing work, not people. Matching
    // the bare word "diagnose" rejected sound plans for saying this.
    ["Diagnose the error in your momentum calculation and correct it", false],
    ["Learn to diagnose why the units do not cancel", false],
    ["Use a short diagnostic check before the practice set", false],
    ["This starts with an example, which you said helps when something is new", false],
  ];

  it.each(claims)("%s -> flagged=%s", (text, flagged) => {
    expect(describesLearnerAsAType(text)).toBe(flagged);
  });
});

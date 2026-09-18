import { describe, expect, it } from "vitest";
import { TopicWorkloadSchema } from "@/lib/plan-generation/topic-plan-contract";
import { aggregateBaselineSegmentResults, type BaselineSegmentResult } from "./baseline-session-result";
import { baselineObservedGap } from "./continuation";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const single = (index: number) => ({ version: "topic_workload_v1" as const, topicSubtopics: [{ topicId: ids[index]!, subtopics: [index ? "Diffusion" : "Osmosis"] }], questionCount: 3, recallQuestionCount: 1, transferQuestionCount: 2, produceSteps: 1, sourceReadMinutes: 3, estimatedMinutes: 12, ceilingMinutes: 30, practicePlaceholder: false, practiceRound: 0, suggestedDate: true, ruleIds: ["L3.q6.map_it"] });
export const segmentedWorkloadFixture = TopicWorkloadSchema.parse({ ...single(0), topicSubtopics: [...single(0).topicSubtopics, ...single(1).topicSubtopics], questionCount: 6, recallQuestionCount: 2, transferQuestionCount: 4, produceSteps: 2, sourceReadMinutes: 6, estimatedMinutes: 24, segments: ids.map((_, index) => ({ segmentId: `segment-${index + 1}`, learningMode: "learn", taskType: "conceptual_learning", workload: single(index) })) });
const result = (index: number): BaselineSegmentResult => ({ shape: "A", methodName: "Concept Mapping", ruleIds: ["L3.q6.map_it"], noteRuleId: "L3.q6.map_it", correctAnswers: 3, totalAnswers: 3, keyPointOutcomes: [{ keyPointId: "k1", text: index ? "Diffusion follows a concentration gradient." : "Osmosis follows a water potential gradient.", sourceTopicId: ids[index], outcome: "secure" }], topicDone: true, escalated: false, produced: `Map ${index + 1}`, comparison: { feedback: "The submitted relationship matches the reference.", missing: [], incorrect: [] }, elapsedSeconds: 120 });

describe("whole-block segment completion", () => {
  it("requires both planned identities in order, with their executed question counts", () => {
    const first = { segmentId: "segment-1", result: result(0) };
    const second = { segmentId: "segment-2", result: result(1) };
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [first])).toBeNull();
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [first, first])).toBeNull();
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [second, first])).toBeNull();
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [first, { ...second, result: { ...second.result, correctAnswers: 0, totalAnswers: 0 } }])).toBeNull();
  });

  it("sums actual attempts and keeps both source origins and distinct keypoint identities", () => {
    const aggregate = aggregateBaselineSegmentResults(segmentedWorkloadFixture, [{ segmentId: "segment-1", result: result(0) }, { segmentId: "segment-2", result: { ...result(1), correctAnswers: 4, totalAnswers: 5, elapsedSeconds: 190, escalated: true, topicDone: false } }]);
    expect(aggregate).toMatchObject({ correctAnswers: 7, totalAnswers: 8, elapsedSeconds: 310, topicDone: false, escalated: true, produced: null, comparison: null });
    expect(aggregate?.keyPointOutcomes.map(outcome => [outcome.keyPointId, outcome.sourceTopicId])).toEqual([["segment-1:k1", ids[0]], ["segment-2:k1", ids[1]]]);
    expect(aggregate?.segments?.[0]?.result.produced).toBe("Map 1");
  });

  it("refuses to misattribute another segment's evidence", () => {
    const wrongOrigin = { ...result(1), keyPointOutcomes: result(0).keyPointOutcomes };
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [{ segmentId: "segment-1", result: result(0) }, { segmentId: "segment-2", result: wrongOrigin }])).toBeNull();
  });

  it.each([
    { keyPointOutcomes: [] },
    { elapsedSeconds: 1.5 },
    { elapsedSeconds: 21_601 },
    { correctAnswers: 193, totalAnswers: 193 },
    { totalAnswers: 3.5 },
  ])("refuses restored results the durable completion contract cannot accept: %j", patch => {
    expect(aggregateBaselineSegmentResults(segmentedWorkloadFixture, [{ segmentId: "segment-1", result: { ...result(0), ...patch } }, { segmentId: "segment-2", result: result(1) }])).toBeNull();
  });

  it("retains original and unchecked correction status for each activity's gap note", () => {
    const revised = { ...result(0), comparison: { feedback: "The arrow is reversed.", missing: [], incorrect: ["Reverse the water gradient."] }, revision: { status: "unchecked" as const, produced: "Corrected map", comparison: null } };
    const aggregate = aggregateBaselineSegmentResults(segmentedWorkloadFixture, [{ segmentId: "segment-1", result: revised }, { segmentId: "segment-2", result: result(1) }])!;
    expect(baselineObservedGap(aggregate, 4)).toContain("Activity 1: Correction unchecked. Original comparison: Reverse the water gradient.");
    expect(baselineObservedGap(aggregate, 4)).toContain("Activity 2: No remaining gap identified.");
  });
});

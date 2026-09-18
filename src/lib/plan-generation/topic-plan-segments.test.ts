import { validateTopicComposition } from "./topic-plan-validation";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { describe, expect, it } from "vitest";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { composeNormalPlanEnvelopes, type NormalPlanEnvelopeInput } from "./normal-plan-envelopes";
import { PlanGenerationRequestSchema } from "./schema";
import { TopicWorkloadSchema } from "./topic-plan-contract";
import { buildNormalPlanFromFixedEnvelope } from "./normal-plan-pipeline";
import { buildNormalPlanFallbackFill } from "./normal-plan-provider-fill";

export const segmentTopicId = (index: number) => `12000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export function segmentPlanInput(covered = true, count = 2): NormalPlanEnvelopeInput {
  return {
    now: new Date("2026-09-17T08:00:00Z"),
    learningIntentRecommendation: { intent: "learn", basis: "Use the accepted topic evidence." },
    durationContext: { profileVersion: "test:segments", profile: { sustainableMinutes: 60, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } }, recentOutcomes: [], onboardingAnswers: { ...emptyOnboardingAnswers(), answers: { session_length: "minutes_45_60", prove_knowing: "answer_questions" } } },
    request: PlanGenerationRequestSchema.parse({ intent: "plan", learningIntent: "learn", goal: "Memorize the French vocabulary terms and definitions for a recall quiz.", materialMode: "none", materials: [], studyMode: "inside", timeZone: "UTC", diagnosticResponses: [], profileSummary: "Use my saved learner profile.", availability: [{ day: "Every day", window: "Morning", minutes: 180 }], knowledgeMap: { version: 1, scopeJudgment: { band: "unit_or_exam", label: "French vocabulary", minimumSessions: 2, recommendedSessions: 4, maximumSessions: 8, minimumTeachingSessions: 1, explanation: "Learn and recall the French words and definitions." }, topics: Array.from({ length: count }, (_, index) => ({ id: segmentTopicId(index + 1), title: `French vocabulary group ${index + 1}`, description: "Recall the vocabulary terms and their exact definitions from memory.", subtopics: [`Vocabulary set ${index + 1}`], prerequisiteTopicIds: [], status: "not_started", initialEvidence: covered ? { source: "learner_report", outcome: "covered_elsewhere", checked: false } : null, sourceReferences: [], origin: "ai_generated", deferred: null })), placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } } }),
  };
}

describe("bounded within-block topic sweep", () => {
  it("fills the genuine 33/60 recall gap with the next distinct ready topic and consumes its queued chunk once", () => {
    const input = segmentPlanInput();
    const composition = composeNormalPlanEnvelopes(input);
    expect(composition.envelopes).toHaveLength(1);
    const block = composition.envelopes[0]!;
    expect(block.topicIds).toEqual([segmentTopicId(1), segmentTopicId(2)]);
    expect(block.workload?.segments).toHaveLength(2);
    expect(block.workload!.segments![0]!.workload.estimatedMinutes).toBe(33);
    expect(block.workload!.estimatedMinutes).toBe(56);
    expect(block.workload!.questionCount).toBe(54);
    expect(block.workload!.estimatedMinutes).toBeLessThanOrEqual(60);
    expect(block.workload!.questionCount).toBe(block.workload!.segments!.reduce((n, segment) => n + segment.workload.questionCount, 0));
    expect(block.workload!.segments!.every(segment => segment.workload.questionCount <= 32)).toBe(true);
    const plan = buildNormalPlanFromFixedEnvelope({ ...input, methodContext: deltaFixture(2).methodContext, composition, fill: buildNormalPlanFallbackFill({ request: input.request, composition }) });
    expect(plan.sessions[0]!.workload).toEqual(block.workload);
  });

  it("retains each independent learning chunk and its later practice without duplicate topic coverage", () => {
    const input = segmentPlanInput(false);
    const composition = composeNormalPlanEnvelopes(input);
    const learns = composition.envelopes.filter(block => block.learningMode === "learn");
    expect(learns).toHaveLength(1);
    expect(learns[0]!.workload!.segments).toHaveLength(2);
    expect(learns[0]!.workload!.segments!.every(segment => segment.workload.produceSteps === 0)).toBe(true);
    for (const topic of input.request.knowledgeMap!.topics) {
      expect(learns.flatMap(block => block.workload!.topicSubtopics.filter(part => part.topicId === topic.id).flatMap(part => part.subtopics))).toEqual(topic.subtopics);
      expect(composition.envelopes.filter(block => block.learningMode === "study" && block.topicIds.includes(topic.id))).toHaveLength(1);
    }
  });

  it("does not use segment one as a newly satisfied prerequisite", () => {
    const input = segmentPlanInput(false);
    input.request.knowledgeMap!.topics[1]!.prerequisiteTopicIds = [segmentTopicId(1)];
    const composition = composeNormalPlanEnvelopes(input);
    expect(composition.envelopes[0]!.workload?.segments).toBeUndefined();
  });

  it("never packs more than two topics or repeats a consumed chunk", () => {
    const composition = composeNormalPlanEnvelopes(segmentPlanInput(true, 5));
    expect(composition.envelopes.map(block => block.topicIds.length)).toEqual([2, 2, 1]);
    expect(composition.envelopes.flatMap(block => block.topicIds)).toEqual(Array.from({ length: 5 }, (_, index) => segmentTopicId(index + 1)));
  });

  it("keeps short-profile blocks and standalone Study Now contracts single", () => {
    const base = segmentPlanInput();
    const input = { ...base, durationContext: { ...base.durationContext, onboardingAnswers: { ...emptyOnboardingAnswers(), answers: { session_length: "minutes_10_15" } } } };
    const composition = composeNormalPlanEnvelopes(input);
    expect(composition.envelopes.every(block => !block.workload?.segments && block.workload!.estimatedMinutes <= 15)).toBe(true);
  });

  it("does not combine incompatible source paths or accepted evidence", () => {
    const sourced = segmentPlanInput();
    sourced.request.knowledgeMap!.topics[1]!.attachedSources = [{ url: "https://example.com/vocabulary" }];
    expect(composeNormalPlanEnvelopes(sourced).envelopes.every(block => !block.workload?.segments)).toBe(true);
    const evidence = segmentPlanInput();
    evidence.request.knowledgeMap!.topics[1]!.initialEvidence = null;
    evidence.request.knowledgeMap!.topics[1]!.status = "taught";
    expect(composeNormalPlanEnvelopes(evidence).envelopes.every(block => !block.workload?.segments)).toBe(true);
  });

  it("does not spend spare practice capacity on a topic whose own learning or spacing is not ready", () => {
    const input = segmentPlanInput();
    input.request.knowledgeMap!.topics[1]!.initialEvidence = null;
    const composition = composeNormalPlanEnvelopes(input);
    expect(composition.envelopes.find(block => block.learningMode === "study" && block.topicIds.includes(segmentTopicId(1)))!.workload?.segments).toBeUndefined();
  });

  it("rejects a forged packed practice date before either topic's spaced return is due", () => {
    const input = segmentPlanInput();
    const composition = structuredClone(composeNormalPlanEnvelopes(input));
    const block = composition.envelopes[0]!;
    const forged = { ...composition, envelopes: [{ ...block, scheduledFor: input.now.toISOString() }] };
    expect(() => validateTopicComposition(input.request, forged, input.now)).toThrow(/return was due/);
  });

  it("does not use another segment as an unlearned prerequisite at the provider boundary", () => {
    const input = segmentPlanInput(false);
    const composition = composeNormalPlanEnvelopes(input);
    const changedRequest = structuredClone(input.request);
    changedRequest.knowledgeMap!.topics[1]!.prerequisiteTopicIds = [segmentTopicId(1)];
    expect(() => validateTopicComposition(changedRequest, composition, input.now)).toThrow(/entry conditions|prerequisite/);
  });

  it("rejects parent totals that do not match the two isolated workloads", () => {
    const workload = composeNormalPlanEnvelopes(segmentPlanInput()).envelopes[0]!.workload!;
    expect(TopicWorkloadSchema.safeParse(workload).success).toBe(true);
    expect(TopicWorkloadSchema.safeParse({ ...workload, estimatedMinutes: workload.estimatedMinutes - 1 }).success).toBe(false);
    expect(TopicWorkloadSchema.safeParse({ ...workload, segments: [workload.segments![0], workload.segments![0]] }).success).toBe(false);
  });
  it("rebuilds a reviewed combined block as valid single-topic blocks without broadening either saved slice", async () => {
    const input = segmentPlanInput();
    const composition = composeNormalPlanEnvelopes(input);
    const plan = structuredClone(buildNormalPlanFromFixedEnvelope({ ...input, methodContext: deltaFixture(2).methodContext, composition, fill: buildNormalPlanFallbackFill({ request: input.request, composition }) }));
    // The accepted map may contain more material than this selected practice slice.
    const request = structuredClone(input.request);
    request.knowledgeMap!.topics.forEach(topic => topic.subtopics.push("Later unscheduled vocabulary"));
    plan.knowledgeMap = request.knowledgeMap;
    const proposal = await buildPlanRevision({ ...input, request, plan, methodContext: deltaFixture(2).methodContext,
      delta: { operations: [{ op: "attach_source", topic_id: segmentTopicId(1), url: "https://example.com/french-vocabulary" }] },
      controls: { excludedOperationIndexes: [], sessionEdits: [] }, protections: [], otherReservations: [], contextKind: "draft",
      fill: async fixed => buildNormalPlanFallbackFill(fixed),
    });
    expect(proposal.canApply, proposal.capacity.explanation).toBe(true);
    const active = proposal.after.sessions.filter(session => session.status !== "skipped");
    expect(active).toHaveLength(2);
    for (const before of plan.sessions[0]!.workload!.topicSubtopics) {
      expect(active.flatMap(session => session.workload!.topicSubtopics.filter(part => part.topicId === before.topicId))).toEqual([before]);
    }
    expect(active.every(session => !session.workload?.segments)).toBe(true);
  });

});

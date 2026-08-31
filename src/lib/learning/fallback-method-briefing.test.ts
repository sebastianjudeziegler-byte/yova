import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  buildCommittedRouteFallbackMethodBriefing,
  buildFallbackMethodBriefing,
  buildGenericInsideFallbackMethodBriefing,
} from "@/lib/learning/fallback-method-briefing";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import type { StudyRoute } from "@/lib/study-route/schema";

function makeSession(overrides: Partial<LearningPlanSession> = {}): LearningPlanSession {
  return {
    id: "session-1",
    sequence: 1,
    title: "Work through your source",
    objective: "Draft a comparative history thesis using textbook evidence.",
    method: "Retrieval-based outlining",
    methodReason: "Generate the claim before reopening the source so the evidence has a clear job.",
    scheduledFor: "2026-08-06T20:00:00.000Z",
    estimatedMinutes: 20,
    amountLabel: "One claim and evidence check",
    learningMode: "study",
    contentTargets: ["Comparative thesis and supporting evidence"],
    completionEvidence: ["Produce one claim with at least one verified piece of evidence"],
    status: "ready",
    ...overrides,
  };
}

function makePlan(session: LearningPlanSession, overrides: Partial<LearningPlan> = {}): LearningPlan {
  return {
    id: "plan-1",
    learningItemId: "item-1",
    title: "Comparative history thesis",
    topic: "Draft a comparative history thesis using my textbook evidence",
    kind: "skill",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "outside_yova",
    learningIntent: "study",
    rationale: "Use the learner's source while YOVA structures the work.",
    createdAt: "2026-08-06T19:00:00.000Z",
    sessions: [session],
    ...overrides,
  };
}

describe("buildFallbackMethodBriefing", () => {
  it("preserves a task-appropriate named method and explains its execution", () => {
    const session = makeSession();
    const briefing = buildFallbackMethodBriefing(makePlan(session), session);

    expect(briefing.taskType).toBe("writing_argumentation");
    expect(briefing.methodId).toBe("retrieval_based_outlining");
    expect(briefing.name).toBe("Outline from Memory");
    expect(briefing.how).toHaveLength(4);
    expect(briefing.completion).toContain("verified piece of evidence");
    expect(briefing.personalization.join(" ")).toContain("outside source remains the source of truth");
  });

  it("keeps the learner's own-source boundary when delivery-policy reasons are present", () => {
    const session = makeSession();
    const deliveryPolicy = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "A concrete example before the rule",
        memoryChallenge: "I forget it after a few days",
        supportPreference: "Give me a hint before the answer",
      },
      recentResults: [],
      recentInterruptions: [],
      learningMode: session.learningMode,
      estimatedMinutes: session.estimatedMinutes,
    });

    const briefing = buildFallbackMethodBriefing(makePlan(session), session, deliveryPolicy);

    expect(briefing.personalization).toHaveLength(3);
    expect(briefing.personalization[0]).toBe(
      "Your outside source remains the source of truth; YOVA provides the sequence and evidence check.",
    );
    expect(briefing.personalization.slice(1)).toEqual(deliveryPolicy.learnerFacingReasons.slice(0, 2));
  });

  it("deduplicates personalization before applying the three-reason bound", () => {
    const session = makeSession();
    const deliveryPolicy = buildSessionDeliveryPolicy({
      learnerProfile: { processingPreference: "A concrete example before the rule" },
      recentResults: [],
      recentInterruptions: [],
      learningMode: session.learningMode,
      estimatedMinutes: session.estimatedMinutes,
    });
    const repeatedReason = deliveryPolicy.learnerFacingReasons[0];

    const briefing = buildFallbackMethodBriefing(makePlan(session), session, {
      ...deliveryPolicy,
      learnerFacingReasons: [repeatedReason, `  ${repeatedReason}  `],
    });

    expect(briefing.personalization).toHaveLength(3);
    expect(briefing.personalization.filter((reason) => reason === repeatedReason)).toHaveLength(1);
    expect(new Set(briefing.personalization.map((reason) => reason.toLocaleLowerCase())).size).toBe(3);
  });

  it("replaces a mismatched free-text method with the task-appropriate default", () => {
    const session = makeSession({
      title: "Solve derivative problems",
      objective: "Apply the product rule to unfamiliar functions.",
      method: "Retrieval-based outlining",
    });
    const plan = makePlan(session, {
      title: "Calculus product rule",
      topic: "Product rule derivative problems",
      kind: "test",
      studyMode: "inside_yova",
    });

    const briefing = buildFallbackMethodBriefing(plan, session);

    expect(briefing.taskType).toBe("problem_solving");
    expect(briefing.methodId).toBe("worked_example_fading");
    expect(briefing.name).toBe("Worked Examples");
  });

  it("does not let the old method override what the learner is actually doing", () => {
    const session = makeSession({
      title: "Understand what mitochondria do",
      objective: "Explain the function of mitochondria in cellular respiration.",
      method: "Scaffolded coding",
      methodReason: "This stale method should be replaced.",
      learningMode: "learn",
    });
    const plan = makePlan(session, {
      title: "Cellular respiration",
      topic: "Learn the role of mitochondria in making ATP",
      kind: "topic",
      studyMode: "inside_yova",
    });

    const briefing = buildFallbackMethodBriefing(plan, session);

    expect(briefing.taskType).toBe("conceptual_learning");
    expect(briefing.methodId).toBe("self_explanation");
    expect(briefing.why).not.toContain("stale method");
    expect(briefing.why).toBe("Connecting steps, causes, and prior knowledge can expose shallow understanding and build a more useful mental model.");
  });

  it("replaces a review method when a conceptual session must teach first", () => {
    const session = makeSession({
      title: "Build the cellular respiration model",
      objective: "Explain how the stages of cellular respiration connect and produce ATP.",
      method: "Closed-note retrieval",
      methodReason: "The original plan named a review method.",
      learningMode: "learn",
    });
    const plan = makePlan(session, {
      title: "Cellular respiration",
      topic: "Understand cellular respiration and ATP production",
      kind: "topic",
      studyMode: "inside_yova",
      learningIntent: "learn",
    });

    const briefing = buildFallbackMethodBriefing(plan, session);

    expect(briefing.taskType).toBe("conceptual_learning");
    expect(briefing.methodId).toBe("self_explanation");
    expect(briefing.name).toBe("Feynman Technique");
  });

  it("does not reroute a committed fallback through the legacy task classifier", () => {
    const route = {
      approach: {
        mode: "learn",
        primaryMethodId: "worked_example_fading",
        visibleMethodName: "Self-explanation with worked example fading",
      },
      target: {
        taskFamily: "conceptual_learning",
      },
      timing: { activeMinutes: 25 },
      execution: {
        completionEvidence: [{
          description: "Explain the relationship independently after the faded example.",
        }],
      },
      explanation: {
        shortReason: "A concrete model should fade into an independent explanation.",
      },
    } as unknown as StudyRoute;

    const briefing = buildCommittedRouteFallbackMethodBriefing(route);

    expect(briefing).toMatchObject({
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "worked_example_fading",
      name: "Self-explanation with worked example fading",
      completion: "Explain the relationship independently after the faded example.",
    });
    expect(briefing.personalization.join(" ")).toContain(
      "keeps the committed Self-explanation with worked example fading route",
    );
  });

  it("does not start a learn-mode mixed assessment with a practice test", () => {
    const session = makeSession({
      title: "Build the ideas before the mixed exam",
      objective: "Learn the unfamiliar ideas that appear across the cumulative exam.",
      method: "Practice test and error repair",
      methodReason: "The original plan named an unsupported assessment.",
      learningMode: "learn",
    });
    const plan = makePlan(session, {
      title: "Cumulative exam",
      topic: "Learn unfamiliar material for a cumulative exam",
      kind: "test",
      studyMode: "outside_yova",
      learningIntent: "learn",
    });

    const briefing = buildFallbackMethodBriefing(plan, session);

    expect(briefing.taskType).toBe("mixed_assessment");
    expect(briefing.methodId).toBe("self_explanation");
    expect(briefing.how[0]).toBe("Study one concise explanation or example.");
    expect(briefing.why).not.toContain("unsupported assessment");
  });

  it("describes the generic inside fallback without claiming subject teaching", () => {
    const session = makeSession({
      title: "Trace how ocean currents move heat",
      objective: "Explain how ocean currents redistribute heat around Earth.",
      method: "Self-explanation",
      methodReason: "Build an accurate subject model before explaining it.",
      learningMode: "learn",
      completionEvidence: ["Apply one current mechanism to a concrete change"],
    });
    const plan = makePlan(session, {
      title: "Ocean currents",
      topic: "How ocean currents redistribute heat",
      studyMode: "inside_yova",
    });

    const briefing = buildGenericInsideFallbackMethodBriefing(plan, session);

    expect(briefing.name).toBe("Objective check and application");
    expect(briefing.why).toContain("does not invent a subject answer");
    expect(briefing.what).toContain("saved target criteria");
    expect(briefing.completion).toBe("Apply one current mechanism to a concrete change");
    expect(briefing.personalization.join(" ")).not.toContain("provides the content sequence");
  });
});

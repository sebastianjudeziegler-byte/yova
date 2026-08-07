import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildFallbackMethodBriefing } from "@/lib/learning/fallback-method-briefing";

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
    expect(briefing.name).toBe("Retrieval-based outlining");
    expect(briefing.how).toHaveLength(4);
    expect(briefing.completion).toContain("verified piece of evidence");
    expect(briefing.personalization.join(" ")).toContain("outside source remains the source of truth");
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
    expect(briefing.name).toBe("Worked example fading");
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
    expect(briefing.name).toBe("Self-explanation");
  });
});

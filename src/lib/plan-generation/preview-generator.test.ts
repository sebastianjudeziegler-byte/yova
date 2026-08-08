import { describe, expect, it } from "vitest";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

function requestWithMinutes(minutes: number) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Learn how the stages of cellular respiration connect before my biology test.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-14T23:59:00.000Z",
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "How well can you explain the process now?",
      answer: "I have not learned it yet",
      evaluation: "self_report",
    }],
    availability: [{ day: "Every day", window: "Evening", minutes }],
    profileSummary: "The learner prefers explicit structure, direct explanations, and bounded steps.",
  });
}

describe("preview plan time windows", () => {
  it("creates more bounded sessions when the same content must fit shorter windows", () => {
    const fortyFiveMinutePlan = generatePreviewPlan(requestWithMinutes(45));
    const fifteenMinutePlan = generatePreviewPlan(requestWithMinutes(15));

    expect(fifteenMinutePlan.sessions.length).toBeGreaterThan(fortyFiveMinutePlan.sessions.length);
    expect(fifteenMinutePlan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.contentTargets?.length)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.completionEvidence?.length)).toBe(true);
  });

  it("preserves an unrecognized goal as the topic instead of replacing it with a generic placeholder", () => {
    const request = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...request,
      goal: "Draft a comparative history thesis using my textbook evidence",
      studyMode: "outside",
    });

    expect(plan.topic).toBe("Draft a comparative history thesis using my textbook evidence");
    expect(plan.studyMode).toBe("outside_yova");
    expect(plan.sessions[0].method).toBe("Retrieval-based outlining");
    expect(plan.sessions[0].objective).toContain("Draft a comparative history thesis");
    expect(plan.sessions[0].objective).not.toContain("Recall the main ideas");
  });

  it("routes a new startup-funding learner into teaching before practice", () => {
    const request = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...request,
      intent: "study_now",
      goal: "Teach me startup funding stages, instruments, dilution, investors, and term sheets from the beginning.",
      deadline: null,
    });

    expect(plan.title).toBe("Startup Funding Foundations");
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]).toMatchObject({
      title: "Build the startup funding map",
      method: "Self-explanation with worked example fading",
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessions[0].contentTargets).toEqual([
      "How funding stages and investor types connect",
      "How common funding instruments change ownership or repayment",
      "How dilution and term-sheet terms affect founders and investors",
    ]);
    expect(plan.sessions[0].completionEvidence).toEqual(expect.arrayContaining([
      expect.stringMatching(/explain the central relationships/i),
    ]));
  });

  it("teaches before unsupported recall when a multi-session goal is new", () => {
    const plan = generatePreviewPlan(requestWithMinutes(25));
    expect(plan.sessions[0].learningMode).toBe("learn");
    expect(plan.sessions[0].method).toBe("Guided explanation and self-explanation");
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessions[0].completionEvidence?.[0]).toMatch(/after the model is hidden/i);
  });

  it("routes a familiar one-off topic into retrieval before repair", () => {
    const request = requestWithMinutes(15);
    const plan = generatePreviewPlan({
      ...request,
      intent: "study_now",
      learningIntent: "study",
      goal: "Review startup funding stages and test whether I remember the dilution tradeoff.",
      deadline: null,
    });

    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].method).toBe("Closed-note retrieval");
    expect(plan.sessions[0].objective).toMatch(/without notes/i);
    expect(plan.sessions[0].completionEvidence).toEqual(expect.arrayContaining([
      expect.stringMatching(/attempt each target without notes/i),
    ]));
  });

  it.each([
    ["history writing", "Draft a comparative history thesis using evidence from two primary sources", "outside", "Retrieval-based outlining"],
    ["close reading", "Read a short story and explain how the storm imagery changes the narrator", "outside", "Read, recall, and review"],
    ["programming", "Learn JavaScript array methods and use them in a small data transformation", "inside", "Guided explanation and self-explanation"],
    ["language", "Learn enough Spanish to introduce myself and ask basic follow-up questions", "inside", "Guided explanation and self-explanation"],
    ["general learning", "Understand how moral hazard changes incentives in insurance markets", "inside", "Guided explanation and self-explanation"],
  ] as const)("keeps the %s journey specific and method-led", (_label, goal, studyMode, expectedMethod) => {
    const request = requestWithMinutes(25);
    const plan = generatePreviewPlan({ ...request, goal, studyMode });
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions[0].method).toBe(expectedMethod);
    expect(plan.sessions[0].objective).not.toMatch(/first concept listed|relevant concept|current objective/i);
    expect(plan.sessions.every((item) => item.contentTargets?.length && item.completionEvidence?.length)).toBe(true);
  });
});

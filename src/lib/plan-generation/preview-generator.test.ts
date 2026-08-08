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
  it("maps one calculus skill to a short progression and all of calculus to a course pathway", () => {
    const base = requestWithMinutes(25);
    const productRule = generatePreviewPlan({
      ...base,
      goal: "Learn the product rule from scratch and use it independently.",
      deadline: null,
    });
    const fullCalculus = generatePreviewPlan({
      ...base,
      goal: "Learn all of calculus from the beginning.",
      deadline: null,
    });

    expect(productRule.kind).toBe("skill");
    expect(productRule.sessions).toHaveLength(4);
    expect(productRule.sessions.slice(0, 2).every((session) => session.learningMode === "learn")).toBe(true);
    expect(productRule.sessions.at(-1)?.learningMode).toBe("study");

    expect(fullCalculus.kind).toBe("course");
    expect(fullCalculus.sessions).toHaveLength(12);
    expect(fullCalculus.sessions.length).toBeGreaterThan(productRule.sessions.length);
    expect(fullCalculus.sessions.map((session) => session.title)).toEqual(expect.arrayContaining([
      "Understand limits as approaching behavior",
      "Build the derivative from first principles",
      "Build the accumulation and integral model",
      "Complete a cumulative calculus transfer",
    ]));
    expect(fullCalculus.sessions.filter((session) => session.learningMode === "learn").length).toBeGreaterThanOrEqual(4);
    expect(fullCalculus.sessions.map((session) => new Date(session.scheduledFor).getTime())).toEqual(
      [...fullCalculus.sessions]
        .map((session) => new Date(session.scheduledFor).getTime())
        .sort((left, right) => left - right),
    );
  });

  it("creates more bounded sessions when the same content must fit shorter windows", () => {
    const fortyFiveMinutePlan = generatePreviewPlan(requestWithMinutes(45));
    const fifteenMinutePlan = generatePreviewPlan(requestWithMinutes(15));

    expect(fifteenMinutePlan.sessions.length).toBeGreaterThan(fortyFiveMinutePlan.sessions.length);
    expect(fifteenMinutePlan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.contentTargets?.length)).toBe(true);
    expect(fifteenMinutePlan.sessions.every((session) => session.completionEvidence?.length)).toBe(true);
  });

  it("maps uploaded sections across sessions instead of compressing the whole guide", () => {
    const materialText = [
      "# Long-term causes",
      "# Alliance systems",
      "# The July Crisis",
      "# Mobilization",
      "# The Western Front",
      "# The Eastern Front",
      "# United States entry",
      "# The armistice",
      "# Consequences of the war",
    ].join("\n");
    const base = requestWithMinutes(15);
    const shortWindowPlan = generatePreviewPlan({
      ...base,
      goal: "Prepare for my World War I unit test from the beginning.",
      materialMode: "upload",
      materials: [{
        id: "10000000-1000-4000-8000-100000000003",
        name: "World War I study guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_000,
        textContent: materialText,
        processingStatus: "ready",
      }],
    });
    const longerWindowPlan = generatePreviewPlan({
      ...base,
      goal: "Prepare for my World War I unit test from the beginning.",
      availability: [{ day: "Every day", window: "Evening", minutes: 45 }],
      materialMode: "upload",
      materials: [{
        id: "10000000-1000-4000-8000-100000000003",
        name: "World War I study guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_000,
        textContent: materialText,
        processingStatus: "ready",
      }],
    });

    const mappedTargets = shortWindowPlan.sessions.flatMap((session) => session.contentTargets ?? []);
    expect(shortWindowPlan.sessions.length).toBeGreaterThan(longerWindowPlan.sessions.length);
    expect(shortWindowPlan.sessions.every((session) => (session.contentTargets?.length ?? 0) <= 2)).toBe(true);
    expect(mappedTargets).toEqual(expect.arrayContaining([
      "Long-term causes",
      "The July Crisis",
      "Consequences of the war",
    ]));
    expect(shortWindowPlan.sessions.at(-1)?.learningMode).toBe("study");
  });

  it("carries saved delivery preferences into the plan rationale and session reasons", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      profileSummary: "The learner prefers the big picture before the details, a small hint first after a miss, and forgets it after a few days.",
    });

    expect(plan.rationale).toContain("big picture first");
    expect(plan.rationale).toContain("hint before answer");
    expect(plan.sessions[0].methodReason).toContain("overall model before the details");
    expect(plan.sessions.at(-1)?.methodReason).toContain("fade after a few days");
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

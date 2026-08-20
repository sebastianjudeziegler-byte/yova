import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { deriveLearningTitle } from "@/lib/intake/interpret";
import { LEARNING_TITLE_CHARACTER_LIMIT } from "@/lib/learning/title-limits";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { builtInSessionFallbackKind } from "@/lib/session-generation/built-in-fallback";

function knowledgeMap(
  titles: string[],
  band: "focused_skill" | "unit_or_exam" | "broad_course",
  recommendedSessions: number,
): PlanKnowledgeMap {
  const minimumSessions = band === "broad_course" ? 10 : band === "focused_skill" ? 2 : 4;
  const maximumSessions = band === "broad_course" ? 14 : band === "focused_skill" ? 6 : 12;
  return {
    version: 1 as const,
    scopeJudgment: {
      band,
      label: band === "focused_skill" ? "Focused skill" : band === "broad_course" ? "Broad course" : "Unit or exam",
      minimumSessions,
      recommendedSessions,
      maximumSessions,
      minimumTeachingSessions: band === "broad_course" ? 4 : band === "focused_skill" ? 1 : 2,
      explanation: "The model scoped these topics to the learner's stated goal and ordered them by prerequisite structure.",
    },
    topics: titles.map((title, index) => ({
      id: `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title,
      description: `Learn and produce evidence for ${title}.`,
      subtopics: [],
      prerequisiteTopicIds: index === 0 ? [] : [`10000000-1000-4000-8000-${String(index).padStart(12, "0")}`],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
    })),
    placementCheck: { status: "skipped" as const, completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  };
}

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
    knowledgeMap: knowledgeMap([
      "Purpose and location of glycolysis",
      "Citric acid cycle inputs and outputs",
      "Electron transport and ATP production",
      "How the three stages connect",
    ], "unit_or_exam", 6),
  });
}

describe("preview plan time windows", () => {
  it("keeps a respiration-only one-off target narrower than the mixed biology subject", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      learningIntent: "study",
      goal: "Help me review cellular respiration and test what I remember.",
      deadline: null,
      knowledgeMap: undefined,
    });

    expect(plan.sessions[0].contentTargets).toEqual(["Cellular respiration sequence"]);
    const session = plan.sessions[0];
    expect(builtInSessionFallbackKind({
      planTopic: plan.topic,
      studyMode: plan.studyMode,
      sessionTitle: session.title,
      sessionObjective: session.objective,
      contentTargets: session.contentTargets ?? [],
    })).toBe("cellular_respiration_sequence");
  });

  it("keeps the personal-finance emergency lesson targets bounded to its curated scope", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      goal: "Help me understand compound growth and personal finance basics.",
      deadline: null,
      knowledgeMap: undefined,
    });

    expect(plan.sessions[0].contentTargets).toEqual(["Budgeting decisions", "Compound growth"]);
  });

  it("does not replace a credit-only goal with the budgeting and compounding scope", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      goal: "Help me understand credit scores and credit-card debt.",
      deadline: null,
      knowledgeMap: undefined,
    });

    expect(plan.sessions[0].contentTargets).toEqual(["Budgeting, credit, interest, and investing basics"]);
  });

  it("keeps a causes-only WWI one-off inside the outbreak lesson's scope", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      goal: "Teach me the causes of World War I and how the conflict spread across Europe.",
      deadline: null,
      knowledgeMap: undefined,
    });

    expect(plan.sessions[0].contentTargets).toEqual([
      "Long-term causes and the July Crisis",
      "How alliances and mobilization widened the war",
    ]);
  });

  it("keeps a mapped startup one-off objective within the persisted limit", () => {
    const base = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      goal: "Teach me startup funding stages, instruments, investors, dilution, and term sheets from the beginning.",
      deadline: null,
      knowledgeMap: undefined,
    });

    expect(plan.sessions[0].objective.length).toBeLessThanOrEqual(280);
    expect(plan.sessions[0].contentTargets).toEqual([
      "How funding stages and investor types connect",
      "How common funding instruments change ownership or repayment",
      "How dilution and term-sheet terms affect founders and investors",
    ]);
  });

  it("maps one calculus skill to a short progression and all of calculus to a course pathway", () => {
    const base = requestWithMinutes(25);
    const productRule = generatePreviewPlan({
      ...base,
      goal: "Learn the product rule from scratch and use it independently.",
      deadline: null,
      knowledgeMap: knowledgeMap([
        "Products of functions",
        "The product rule procedure",
        "Independent product rule selection",
      ], "focused_skill", 4),
    });
    const fullCalculus = generatePreviewPlan({
      ...base,
      goal: "Learn all of calculus from the beginning.",
      deadline: null,
      knowledgeMap: knowledgeMap([
        "Functions and graphical behavior",
        "Limits as approaching behavior",
        "Continuity and limit laws",
        "Derivative from first principles",
        "Core derivative rules",
        "Applications of derivatives",
        "Accumulation and area",
        "Definite integrals",
        "Fundamental theorem of calculus",
        "Cumulative calculus transfer",
      ], "broad_course", 12),
    });

    expect(productRule.kind).toBe("skill");
    expect(productRule.sessions).toHaveLength(4);
    expect(productRule.sessions.slice(0, 2).every((session) => session.learningMode === "learn")).toBe(true);
    expect(productRule.sessions.at(-1)?.learningMode).toBe("study");

    expect(fullCalculus.kind).toBe("course");
    expect(fullCalculus.sessions).toHaveLength(12);
    expect(fullCalculus.sessions.length).toBeGreaterThan(productRule.sessions.length);
    expect(fullCalculus.sessions.flatMap((session) => session.contentTargets ?? [])).toEqual(expect.arrayContaining([
      "Limits as approaching behavior",
      "Derivative from first principles",
      "Accumulation and area",
      "Cumulative calculus transfer",
    ]));
    expect(fullCalculus.sessions.every((session) => (session.topicIds?.length ?? 0) > 0)).toBe(true);
    expect(fullCalculus.sessions.filter((session) => session.learningMode === "learn").length).toBeGreaterThanOrEqual(4);
    expect(fullCalculus.sessions.map((session) => new Date(session.scheduledFor).getTime())).toEqual(
      [...fullCalculus.sessions]
        .map((session) => new Date(session.scheduledFor).getTime())
        .sort((left, right) => left - right),
    );
  });

  it("keeps every session inside the selected time and content budget", () => {
    const fortyFiveMinutePlan = generatePreviewPlan(requestWithMinutes(45));
    const fifteenMinutePlan = generatePreviewPlan(requestWithMinutes(15));

    expect(fifteenMinutePlan.sessions.length).toBeGreaterThanOrEqual(fortyFiveMinutePlan.sessions.length);
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
      knowledgeMap: knowledgeMap([
        "Long-term causes",
        "Alliance systems",
        "The July Crisis",
        "Mobilization",
        "The Western Front",
        "The Eastern Front",
        "United States entry",
        "The armistice",
        "Consequences of the war",
      ], "unit_or_exam", 8),
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
      knowledgeMap: knowledgeMap([
        "Long-term causes",
        "Alliance systems",
        "The July Crisis",
        "Mobilization",
        "The Western Front",
        "The Eastern Front",
        "United States entry",
        "The armistice",
        "Consequences of the war",
      ], "unit_or_exam", 8),
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
      knowledgeMap: knowledgeMap([
        "Comparative thesis criteria",
        "Selecting evidence from two historical contexts",
        "Connecting evidence to a defensible comparison",
      ], "focused_skill", 4),
    });

    expect(plan.topic).toBe("Draft a comparative history thesis using my textbook evidence");
    expect(plan.studyMode).toBe("outside_yova");
    expect(plan.sessions[0].method).toBe("Retrieval-based outlining");
    expect(plan.sessions[0].objective).toContain("Comparative thesis criteria");
    expect(plan.sessions[0].objective).not.toContain("Recall the main ideas");
  });

  it("turns an outside-session goal into a grammatical instruction without splicing the raw prompt", () => {
    const base = requestWithMinutes(15);
    const rawGoal = "I want to understand how the Krebs cycle actually produces NADH and FADH2";
    const plan = generatePreviewPlan({
      ...base,
      intent: "study_now",
      goal: rawGoal,
      deadline: null,
      studyMode: "outside",
      knowledgeMap: knowledgeMap([
        "Redox carriers in cellular respiration",
        "How NADH and FADH2 receive electrons",
      ], "focused_skill", 2),
    });

    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].objective).toMatch(/^Open your chosen source and work through Redox carriers/i);
    expect(plan.sessions[0].objective).not.toContain(rawGoal);
    expect(plan.sessions[0].objective).not.toMatch(/toward\s+I\s+(?:want|need|have)\b/i);
  });

  it("routes a new startup-funding learner into teaching before practice", () => {
    const request = requestWithMinutes(25);
    const plan = generatePreviewPlan({
      ...request,
      intent: "study_now",
      goal: "Teach me startup funding stages, instruments, dilution, investors, and term sheets from the beginning.",
      deadline: null,
      knowledgeMap: knowledgeMap([
        "Funding stages and investor types",
        "Funding instruments and their tradeoffs",
        "Ownership dilution",
        "Core term sheet provisions",
      ], "focused_skill", 4),
    });

    expect(plan.title).toMatch(/startup funding/i);
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]).toMatchObject({
      title: expect.stringMatching(/^Learn /),
      method: "Self-explanation",
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessions[0].contentTargets).toEqual([
      "Funding stages and investor types",
      "Funding instruments and their tradeoffs",
      "Ownership dilution",
    ]);
    expect(plan.knowledgeMap?.topics.find((topic) => topic.title === "Core term sheet provisions")?.deferred).not.toBeNull();
    expect(plan.sessions[0].completionEvidence).toEqual(expect.arrayContaining([
      expect.stringMatching(/each mapped topic after the model is hidden/i),
    ]));
  });

  it("teaches before unsupported recall when a multi-session goal is new", () => {
    const plan = generatePreviewPlan(requestWithMinutes(25));
    expect(plan.sessions[0].learningMode).toBe("learn");
    expect(plan.sessions[0].method).toBe("Guided explanation and self-explanation");
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessions[0].completionEvidence?.[0]).toMatch(/after the model is hidden/i);
  });

  it("teaches placement gaps and schedules demonstrated topics as short verification", () => {
    const base = requestWithMinutes(25);
    const mapped = knowledgeMap([
      "Purpose and location of glycolysis",
      "Citric acid cycle inputs and outputs",
      "Electron transport and ATP production",
      "How the three stages connect",
    ], "unit_or_exam", 6);
    const observedAt = "2026-08-09T18:00:00.000Z";
    mapped.placementCheck = {
      status: "completed",
      completedAt: observedAt,
      demonstratedTopicIds: [mapped.topics[0].id],
      gapTopicIds: [mapped.topics[1].id],
    };
    mapped.topics[0] = {
      ...mapped.topics[0],
      status: "evidenced",
      initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt },
    };
    mapped.topics[1] = {
      ...mapped.topics[1],
      status: "not_started",
      initialEvidence: { source: "placement_check", outcome: "gap", observedAt },
    };

    const plan = generatePreviewPlan({ ...base, knowledgeMap: mapped });
    const gapSession = plan.sessions.find((session) => session.topicIds?.includes(mapped.topics[1].id));
    const demonstratedSession = plan.sessions.find((session) => session.topicIds?.includes(mapped.topics[0].id));

    expect(gapSession?.learningMode).toBe("learn");
    expect(demonstratedSession?.learningMode).toBe("study");
    expect(demonstratedSession?.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(plan.rationale).toContain("You showed you already know Purpose and location of glycolysis");
    expect(plan.rationale).toContain("quick check, not a lesson");
    expect(plan.rationale).toContain("taught first because the placement check confirmed a gap");
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
    const plan = generatePreviewPlan({
      ...request,
      goal,
      studyMode,
      knowledgeMap: knowledgeMap([goal], "focused_skill", 4),
    });
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions[0].method).toBe(expectedMethod);
    expect(plan.sessions[0].objective).not.toMatch(/first concept listed|relevant concept|current objective/i);
    expect(plan.sessions.every((item) => item.contentTargets?.length && item.completionEvidence?.length)).toBe(true);
  });
});

describe("goals whose derived title runs long", () => {
  // The exact goal that returned a 500 in the browser: the derived title landed
  // between intake's old 100-character limit and the draft schema's 90.
  const longGoal = "Quiz me from memory on the products of glycolysis, the Krebs cycle, and the electron transport chain.";

  function studyNowRequest(goal: string) {
    return PlanGenerationRequestSchema.parse({
      intent: "study_now",
      learningIntent: "study",
      goal,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      deadline: null,
      timeZone: "America/Los_Angeles",
      diagnosticResponses: [],
      availability: [{ day: "Every day", window: "Evening", minutes: 15 }],
      profileSummary: "The learner wants to check what they can recall without notes.",
    });
  }

  it("derives a title the draft schema will accept", () => {
    expect(deriveLearningTitle(longGoal).length)
      .toBeLessThanOrEqual(LEARNING_TITLE_CHARACTER_LIMIT);
  });

  it("builds a one-off session plan instead of throwing", () => {
    expect(() => generatePreviewPlan(studyNowRequest(longGoal))).not.toThrow();
  });

  it("still produces a usable title rather than an empty one", () => {
    const plan = generatePreviewPlan(studyNowRequest(longGoal));
    expect(plan.title.trim().length).toBeGreaterThan(2);
  });

  it("handles a goal far longer than any title limit", () => {
    const rambling = `${longGoal} ${longGoal} ${longGoal}`;
    expect(() => generatePreviewPlan(studyNowRequest(rambling))).not.toThrow();
  });
});

describe("choosing the method for a one-off teaching session", () => {
  function studyNow(goal: string, topics: string[]) {
    return generatePreviewPlan({
      ...requestWithMinutes(20),
      intent: "study_now",
      goal,
      deadline: null,
      knowledgeMap: knowledgeMap(topics, "focused_skill", 2),
    });
  }

  it("gives a memorization goal a retrieval method, not self-explanation", () => {
    // This branch used to hardcode self-explanation for every one-off teaching
    // session, and the plan's named method is authoritative downstream, so the
    // wrong choice survived session generation instead of being corrected.
    const plan = studyNow(
      "Memorize the three states of matter and how they change between each other",
      ["Three states of matter", "Phase changes"],
    );

    expect(plan.sessions[0].method).toMatch(/retrieval/i);
  });

  it("still gives a conceptual goal an explanation-based method", () => {
    const plan = studyNow(
      "Understand why the greenhouse effect traps heat in the atmosphere",
      ["Greenhouse gases", "Radiation balance"],
    );

    expect(plan.sessions[0].method).toMatch(/explanation|worked example|read/i);
  });

  it("gives a procedural goal a worked-example method", () => {
    const plan = studyNow(
      "Practice solving two-step algebra equations step by step",
      ["Isolating the variable", "Checking the solution"],
    );

    expect(plan.sessions[0].method).toMatch(/worked example|scaffold/i);
  });
});

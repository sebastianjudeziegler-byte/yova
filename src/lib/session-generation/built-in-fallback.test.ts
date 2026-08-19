import { describe, expect, it, vi } from "vitest";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import {
  buildGenericInsideYovaFallbackLesson,
  buildOutsideYovaFallbackLesson,
  builtInFallbackSupportsAdjustment,
  builtInLessonCoversTarget,
  builtInLessonFitsTime,
  builtInSessionFallbackKind,
  builtInTopicEvidenceId,
  canUseBuiltInSessionFallback,
  genericInsideFallbackCoversTarget,
  type OutsideYovaFallbackLesson,
} from "@/lib/session-generation/built-in-fallback";
import { validateSessionTimeBudget } from "@/lib/session-generation/time-budget";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: vi.fn() } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

const base = {
  studyMode: "inside_yova" as const,
  sessionTitle: "Baseline Check and WWI Map",
  sessionObjective: "Understand the main prewar tensions and trace the July Crisis outbreak.",
  contentTargets: [
    "Prewar European alliances and tensions",
    "Sequence from the Sarajevo assassination to declarations of war",
    "Basic chronology from 1914 to 1918",
  ],
};

function outsideValidationDraft(
  lesson: Pick<OutsideYovaFallbackLesson, "learningMode" | "activities">,
) {
  return {
    methodBriefing: { learningMode: lesson.learningMode },
    activities: lesson.activities.map((activity) => ({
      topicId: activity.topicId ?? null,
      methodPhase: activity.methodPhase ?? "orient",
      estimatedMinutes: activity.estimatedMinutes ?? 1,
      requiredForCompletion: activity.requiredForCompletion !== false,
      type: activity.type,
      concept: activity.concept,
      label: activity.label,
      title: activity.title,
      body: activity.body,
      teaching: activity.teaching ?? null,
      choices: activity.question ?? [],
      correctAnswer: activity.correctAnswer,
      feedback: activity.feedback,
      practiceIntent: null,
      misconceptionSummary: null,
    })),
  } as unknown as GeneratedSessionDraft;
}

describe("built-in session fallback eligibility", () => {
  it("allows the curated WWI outbreak lesson for the matching current session", () => {
    expect(builtInSessionFallbackKind({ ...base, planTopic: "World War I Test Preparation" }))
      .toBe("wwi_outbreak");
  });

  it("does not use the WWI outbreak lesson for a later trench-warfare session", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "World War I Test Preparation",
      sessionTitle: "Life and combat in the trenches",
      sessionObjective: "Compare trench conditions and military technology on the Western Front.",
      contentTargets: ["Trench warfare", "Western Front technology"],
    })).toBeNull();
  });

  it("does not use the outbreak lesson for the later alliances-and-fronts session", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "World War I causes, escalation, major turning points, and consequences",
      sessionTitle: "Connect the alliances and major fronts",
      sessionObjective: "Connect alliance commitments to the major European fronts and explain how the fighting developed.",
      contentTargets: ["Alliances and major fronts"],
    })).toBeNull();
  });

  it("does not confuse World War II with World War I", () => {
    expect(builtInSessionFallbackKind({ ...base, planTopic: "World War II causes" })).toBeNull();
  });

  it("does not use WWI content for a WWII session inside a mixed-war plan", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "World War I and World War II",
      sessionTitle: "Outbreak of World War II",
      sessionObjective: "Explain the causes and outbreak of World War II.",
      contentTargets: ["World War II causes and outbreak"],
    })).toBeNull();
  });

  it("does not use cellular respiration for a photosynthesis-only session in a mixed plan", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Photosynthesis and cellular respiration",
      sessionTitle: "Light-dependent reactions",
      sessionObjective: "Explain how photosynthesis captures light energy in chloroplasts.",
      contentTargets: ["Photosystems", "ATP and NADPH production"],
    })).toBeNull();
  });

  it("allows cellular respiration only when the current session also names it", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Photosynthesis and cellular respiration",
      sessionTitle: "Trace cellular respiration",
      sessionObjective: "Connect glycolysis, the Krebs cycle, and the electron transport chain.",
      contentTargets: ["Cellular respiration sequence"],
    })).toBe("cellular_respiration_sequence");
  });

  it("does not replace a respiration-and-photosynthesis comparison with respiration alone", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Photosynthesis and cellular respiration",
      sessionTitle: "Connect respiration and photosynthesis",
      sessionObjective: "Explain how cellular respiration and photosynthesis transform and exchange energy and matter.",
      contentTargets: ["Relationship between photosynthesis and cellular respiration"],
    })).toBeNull();
  });

  it("uses the learner's respiration-only goal when a preview session has a broad biology label", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Help me review cellular respiration and test what I remember.",
      sessionTitle: "Retrieve and apply Photosynthesis and cellular respiration",
      sessionObjective: "Retrieve and apply Photosynthesis and cellular respiration without notes.",
      contentTargets: ["Photosynthesis and cellular respiration"],
    })).toBe("cellular_respiration_sequence");
  });

  it("does not treat political interest groups as personal finance", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Interest groups in American politics",
      sessionTitle: "Compare lobbying strategies",
      sessionObjective: "Explain how interest groups influence public policy.",
      contentTargets: ["Inside and outside lobbying"],
    })).toBeNull();
  });

  it("does not replace a credit-only session with budgeting and compounding", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Help me understand credit scores and credit-card debt",
      sessionTitle: "Learn credit scores and revolving debt",
      sessionObjective: "Explain how credit utilization and card balances affect a credit score.",
      contentTargets: ["Credit scores", "Credit-card debt"],
    })).toBeNull();
  });

  it("allows the combined budgeting and compound-growth lesson only for that exact scope", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Personal Finance Fundamentals",
      sessionTitle: "Budgeting, credit, interest, and investing basics",
      sessionObjective: "Use a budget and explain how compound growth changes money over time.",
      contentTargets: ["Budgeting decisions", "Compound growth"],
    })).toBe("budget_and_compound_growth");
  });

  it("recognizes the current mapped scopes produced by one-off preview plans", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Teach me startup funding stages, instruments, investors, dilution, and term sheets from the beginning",
      sessionTitle: "Learn How funding stages and investor types connect and 2 connected topics",
      sessionObjective: "Build an accurate first mental model of funding stages, instruments, ownership, repayment, dilution, and term sheets.",
      contentTargets: [
        "How funding stages and investor types connect",
        "How common funding instruments change ownership or repayment",
        "How dilution and term-sheet terms affect founders and investors",
      ],
    })).toBe("startup_funding");

    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "Help me understand compound growth and personal finance basics.",
      sessionTitle: "Learn Budgeting, credit, interest, and investing basics",
      sessionObjective: "Build an accurate first mental model of budgeting, credit, interest, and investing basics.",
      contentTargets: ["Budgeting, credit, interest, and investing basics"],
    })).toBe("budget_and_compound_growth");
  });

  it("always permits the source-bound outside-YOVA workflow", () => {
    expect(builtInSessionFallbackKind({
      ...base,
      planTopic: "A private textbook chapter",
      studyMode: "outside_yova",
    })).toBe("outside_source");
  });
});

describe("built-in fallback evidence attribution", () => {
  it("never attributes a procedural outside-source check to a subject topic", () => {
    expect(builtInTopicEvidenceId({
      studyMode: "outside_yova",
      topicIds: ["topic-1"],
      coversEntireScope: true,
    })).toBeNull();
  });

  it("attributes evidence only for one fully covered inside-YOVA topic", () => {
    expect(builtInTopicEvidenceId({
      studyMode: "inside_yova",
      topicIds: ["topic-1"],
      coversEntireScope: true,
    })).toBe("topic-1");
    expect(builtInTopicEvidenceId({
      studyMode: "inside_yova",
      topicIds: ["topic-1", "topic-2"],
      coversEntireScope: true,
    })).toBeNull();
    expect(builtInTopicEvidenceId({
      studyMode: "inside_yova",
      topicIds: ["topic-1"],
      coversEntireScope: false,
    })).toBeNull();
  });
});

describe("built-in fallback target coverage", () => {
  it("counts the substantive worked example for the exact mapped WWI scope", () => {
    const activities = [{
      teaching: {
        keyIdea: "World War I began when prewar European alliances and tensions interacted with a specific political crisis in 1914; its basic chronology then runs to the 1918 armistice.",
        explanation: "The assassination of Archduke Franz Ferdinand triggered the July Crisis, when leaders chose ultimatums, mobilization, and declarations of war that widened the conflict.",
        example: {
          setup: "Trace the sequence from the Sarajevo assassination and declarations of war to the basic chronology from 1914 to 1918.",
          steps: [
            "On June 28, 1914, a Bosnian Serb nationalist assassinated Archduke Franz Ferdinand in Sarajevo.",
            "Austria-Hungary issued an ultimatum to Serbia and declared war after Serbia did not accept every demand.",
          ],
          takeaway: "The assassination was the trigger, while government decisions during the July Crisis widened the war.",
        },
        commonMistake: {
          mistake: "The assassination alone made a world war inevitable.",
          correction: "Political choices, alliance commitments, and mobilization plans transformed the crisis into a wider war.",
        },
      },
    }];

    for (const target of base.contentTargets) {
      expect(builtInLessonCoversTarget(activities, target), target).toBe(true);
    }
  });

  it("does not count an incorrect distractor as lesson coverage", () => {
    const activities = [{
      title: "Which explanation best describes the outbreak of World War I?",
      body: "Separate background causes from the immediate crisis.",
      concept: "World War I causes and trigger",
      correctAnswer: "The July Crisis widened the assassination crisis into war",
      feedback: "Long-term pressures and government decisions provided the path into war.",
      question: [
        "The July Crisis widened the assassination crisis into war",
        "The Treaty of Versailles caused the war before it was signed",
      ],
    }];

    expect(builtInLessonCoversTarget(activities, "July Crisis")).toBe(true);
    expect(builtInLessonCoversTarget(activities, "Treaty of Versailles")).toBe(false);
  });

  it("does not count misconception text as lesson coverage", () => {
    const activities = [{
      teaching: {
        keyIdea: "Separate a mistaken claim from its correction.",
        explanation: "Only the correction supplies reliable lesson content.",
        commonMistake: {
          mistake: "The Treaty of Versailles caused World War I before it was signed.",
          correction: "The July Crisis widened the assassination crisis into war.",
        },
      },
    }];

    expect(builtInLessonCoversTarget(activities, "July Crisis")).toBe(true);
    expect(builtInLessonCoversTarget(activities, "Treaty of Versailles")).toBe(false);
  });
});

describe("outside-YOVA fallback lesson", () => {
  const input = {
    topic: "how the Krebs cycle produces NADH and FADH2",
    objective: "Explain how the Krebs cycle transfers energy to NADH and FADH2.",
    method: "Active retrieval with a source check",
    methodReason: "it lets you build the pathway once, check the exact gap, and explain the energy transfer",
    learningMode: "learn" as const,
  };

  it.each([
    { availableMinutes: 10, externalWorkMinutes: 5 },
    { availableMinutes: 15, externalWorkMinutes: 10 },
  ])("builds a complete learn workflow in $availableMinutes minutes", async ({
    availableMinutes,
    externalWorkMinutes,
  }) => {
    const lesson = buildOutsideYovaFallbackLesson({ ...input, availableMinutes });
    expect(lesson).not.toBeNull();
    if (!lesson) return;

    expect(lesson.activities).toHaveLength(3);
    expect(lesson.externalWorkMinutes).toBe(externalWorkMinutes);
    expect(lesson.activities.reduce(
      (total, activity) => total + (activity.estimatedMinutes ?? 0),
      0,
    )).toBe(availableMinutes);
    expect(builtInLessonFitsTime(lesson.activities, availableMinutes)).toBe(true);

    const outsideWork = lesson.activities.find((activity) => activity.methodPhase === "read_source");
    expect(outsideWork).toMatchObject({
      type: "instruction",
      estimatedMinutes: externalWorkMinutes,
    });
    expect(outsideWork?.body).toMatch(/open your textbook, class notes, or other trusted source/i);
    expect(outsideWork?.body).toMatch(/read .*then write/i);
    expect(outsideWork?.body).toContain(`Work there for ${externalWorkMinutes} minutes`);
    expect(outsideWork?.body).toMatch(/bring your notes back to YOVA/i);

    const draft = outsideValidationDraft(lesson);
    const {
      validateOutsideAppGuidance,
      validateStandardGuidedSessionActivityMix,
      validateSubstantiveTeaching,
    } = await import("@/lib/openai/session-generator");
    expect(validateOutsideAppGuidance(draft, "outside_yova")).toBeNull();
    expect(validateSubstantiveTeaching(draft)).toBeNull();
    expect(validateStandardGuidedSessionActivityMix(draft)).toBeNull();
    expect(validateSessionTimeBudget(draft, availableMinutes)).toBeNull();
  });

  it("supports the shortest study workflow without inventing a teaching block", async () => {
    const lesson = buildOutsideYovaFallbackLesson({
      ...input,
      learningMode: "study",
      availableMinutes: 10,
    });
    expect(lesson).not.toBeNull();
    if (!lesson) return;

    expect(lesson.activities).toHaveLength(3);
    expect(lesson.externalWorkMinutes).toBe(6);
    expect(lesson.activities.reduce(
      (total, activity) => total + (activity.estimatedMinutes ?? 0),
      0,
    )).toBe(10);
    expect(lesson.activities.every((activity) => !activity.teaching)).toBe(true);

    const { validateOutsideAppGuidance } = await import("@/lib/openai/session-generator");
    expect(validateOutsideAppGuidance(outsideValidationDraft(lesson), "outside_yova")).toBeNull();
  });

  it("fails closed below the shortest valid session duration", () => {
    expect(buildOutsideYovaFallbackLesson({ ...input, availableMinutes: 9 })).toBeNull();
    expect(buildOutsideYovaFallbackLesson({ ...input, availableMinutes: 10.5 })).toBeNull();
  });
});

describe("generic inside-YOVA fallback lesson", () => {
  const input = {
    objective: "Explain how competing constraints shape a city transportation policy.",
    contentTargets: [
      "Tradeoffs between travel time, access, and public space",
      "How one policy choice affects different groups",
    ],
    completionEvidence: [
      "Explain one tradeoff in your own words",
      "Apply the tradeoff to a concrete policy choice",
    ],
    learningMode: "study" as const,
  };

  it.each([10, 15, 30, 90])("builds a required topic-agnostic workflow in %i minutes", async (availableMinutes) => {
    const lesson = buildGenericInsideYovaFallbackLesson({ ...input, availableMinutes });
    expect(lesson).not.toBeNull();
    if (!lesson) return;

    expect(lesson.kind).toBe("generic_inside");
    expect(lesson.activities).toHaveLength(3);
    expect(lesson.activities.every((activity) => activity.requiredForCompletion)).toBe(true);
    expect(lesson.activities.reduce(
      (total, activity) => total + (activity.estimatedMinutes ?? 0),
      0,
    )).toBe(availableMinutes);
    expect(builtInLessonFitsTime(lesson.activities, availableMinutes)).toBe(true);

    const framing = lesson.activities[0];
    expect(framing.body).toContain(input.objective);
    for (const target of input.contentTargets) {
      expect(framing.body).toContain(target);
      expect(builtInLessonCoversTarget(lesson.activities, target)).toBe(true);
    }
    for (const evidence of input.completionEvidence) expect(framing.body).toContain(evidence);

    expect(lesson.activities[1]).toMatchObject({
      type: "free_response",
      methodPhase: "retrieve",
      requiredForCompletion: true,
    });
    expect(lesson.activities[1]?.body).toMatch(/without notes, hints, or outside help/i);
    expect(lesson.activities[1]?.correctAnswer).toMatch(/keep your own answer visible and compare/i);
    expect(lesson.activities[2]).toMatchObject({
      type: "free_response",
      methodPhase: "transfer",
      requiredForCompletion: true,
    });
    expect(lesson.activities[2]?.body).toMatch(/explanation|apply/i);

    const draft = outsideValidationDraft({ learningMode: "study", activities: lesson.activities });
    const { validateStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    expect(validateStandardGuidedSessionActivityMix(draft)).toBeNull();
    expect(validateSessionTimeBudget(draft, availableMinutes)).toBeNull();
  });

  it("uses the objective as the target and a neutral evidence check when optional arrays are empty", () => {
    const lesson = buildGenericInsideYovaFallbackLesson({
      objective: "Trace the logic of an unfamiliar proof.",
      contentTargets: [],
      completionEvidence: [],
      learningMode: "study",
      availableMinutes: 10,
    });

    expect(lesson?.activities[0]?.body).toContain("Trace the logic of an unfamiliar proof.");
    expect(lesson?.activities[2]?.correctAnswer).toMatch(/explain the main idea accurately or apply it/i);
  });

  it("covers exact saved targets even when the curated subject-token heuristic cannot", () => {
    const contentTargets = ["Explain this relationship", "DNA and RNA"];
    const lesson = buildGenericInsideYovaFallbackLesson({
      objective: "Compare two saved targets without inventing a subject answer.",
      contentTargets,
      completionEvidence: ["Explain or apply one target"],
      learningMode: "study",
      availableMinutes: 10,
    });
    expect(lesson).not.toBeNull();
    if (!lesson) return;

    for (const target of contentTargets) {
      expect(builtInLessonCoversTarget(lesson.activities, target)).toBe(false);
      expect(genericInsideFallbackCoversTarget(lesson, target)).toBe(true);
    }
    expect(genericInsideFallbackCoversTarget(lesson, "ATP and ADP")).toBe(false);
  });

  it("does not claim exact generic coverage when the saved target is absent from the emitted frame", () => {
    const lesson = buildGenericInsideYovaFallbackLesson({
      objective: "Explain this relationship.",
      contentTargets: ["Explain this relationship"],
      completionEvidence: ["Give a complete explanation"],
      learningMode: "study",
      availableMinutes: 10,
    });
    expect(lesson).not.toBeNull();
    if (!lesson) return;

    const withoutTargetFrame = {
      ...lesson,
      activities: lesson.activities.map((activity) => (
        activity.label === "SESSION TARGET" ? { ...activity, body: "Target unavailable." } : activity
      )),
    };
    expect(genericInsideFallbackCoversTarget(
      withoutTargetFrame,
      "Explain this relationship",
    )).toBe(false);
  });

  it("fails closed below the supported duration floor", () => {
    expect(buildGenericInsideYovaFallbackLesson({ ...input, availableMinutes: 9 })).toBeNull();
    expect(buildGenericInsideYovaFallbackLesson({ ...input, availableMinutes: 10.5 })).toBeNull();
  });

  it("fails closed for teaching-first sessions that need a subject model", () => {
    expect(buildGenericInsideYovaFallbackLesson({
      ...input,
      learningMode: "learn",
      availableMinutes: 15,
    })).toBeNull();
  });
});

describe("built-in fallback time bounds", () => {
  it("fails closed when the required curated lesson does not fit today's time", () => {
    const activities = [
      { estimatedMinutes: 7, requiredForCompletion: true },
      { estimatedMinutes: 3, requiredForCompletion: true },
      { estimatedMinutes: 5, requiredForCompletion: true },
    ];
    expect(builtInLessonFitsTime(activities, 10)).toBe(false);
    expect(builtInLessonFitsTime(activities, 15)).toBe(true);
  });
});

describe("built-in fallback adjustment fidelity", () => {
  it("fails closed when a learner adds requirements the curated lesson cannot verify", () => {
    expect(builtInFallbackSupportsAdjustment(null)).toBe(true);
    expect(builtInFallbackSupportsAdjustment({ note: "   " })).toBe(true);
    expect(builtInFallbackSupportsAdjustment({ note: "Must cover the quotient rule too." })).toBe(false);
  });

  it("allows only the planned structured starting point", () => {
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "as_planned",
      knownTargets: [],
      note: "",
    })).toBe(true);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "already_know",
      knownTargets: [],
      note: "",
    })).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "already_know",
      knownTargets: ["Product rule structure"],
      note: "",
    })).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "need_teaching",
      knownTargets: [],
      note: "",
    })).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "challenge_me",
      knownTargets: [],
      note: "",
    })).toBe(false);
  });

  it("allows need-teaching only with the matching learn fallback", () => {
    const learnFallback = buildOutsideYovaFallbackLesson({
      topic: "how the Krebs cycle produces NADH and FADH2",
      objective: "Explain how the cycle transfers energy to NADH and FADH2.",
      method: "Active retrieval with a source check",
      learningMode: "learn",
      availableMinutes: 10,
    });
    const studyFallback = buildOutsideYovaFallbackLesson({
      topic: "World War I causes",
      objective: "Review the sequence from the assassination to declarations of war.",
      method: "Active retrieval with a source check",
      learningMode: "study",
      availableMinutes: 10,
    });
    const adjustment = {
      familiarity: "need_teaching" as const,
      availableMinutes: 10,
      knownTargets: [],
      note: "",
    };

    expect(builtInFallbackSupportsAdjustment(adjustment, {
      outsideFallback: learnFallback,
    })).toBe(true);
    expect(builtInFallbackSupportsAdjustment(adjustment, {
      outsideFallback: studyFallback,
    })).toBe(false);
    expect(builtInFallbackSupportsAdjustment(adjustment, {
      outsideFallback: null,
    })).toBe(false);
    expect(builtInFallbackSupportsAdjustment({ ...adjustment, availableMinutes: 15 }, {
      outsideFallback: learnFallback,
    })).toBe(false);
  });

  it("still rejects material starting-point changes even when a learn fallback exists", () => {
    const outsideFallback = buildOutsideYovaFallbackLesson({
      topic: "DNA replication",
      objective: "Explain the direction and purpose of DNA replication.",
      method: "Read, recall, review",
      learningMode: "learn",
      availableMinutes: 10,
    });
    const context = { outsideFallback };

    expect(builtInFallbackSupportsAdjustment({
      familiarity: "need_teaching",
      availableMinutes: 10,
      knownTargets: ["DNA polymerase"],
      note: "",
    }, context)).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "need_teaching",
      availableMinutes: 10,
      knownTargets: [],
      note: "Use my worksheet instead.",
    }, context)).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "already_know",
      availableMinutes: 10,
      knownTargets: [],
      note: "",
    }, context)).toBe(false);
    expect(builtInFallbackSupportsAdjustment({
      familiarity: "challenge_me",
      availableMinutes: 10,
      knownTargets: [],
      note: "",
    }, context)).toBe(false);
  });
});

describe("built-in fallback request eligibility", () => {
  const eligible = {
    planStatus: "active",
    sourceMode: "yova_generated",
    responseStatus: 502,
    adjustment: null,
  };

  it("allows a curated lesson after a transient generation failure", () => {
    expect(canUseBuiltInSessionFallback(eligible)).toBe(true);
    expect(canUseBuiltInSessionFallback({ ...eligible, responseStatus: 503 })).toBe(true);
    expect(canUseBuiltInSessionFallback({ ...eligible, responseStatus: 504 })).toBe(true);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: null,
      adjustment: {
        familiarity: "as_planned",
        availableMinutes: 20,
        knownTargets: [],
        note: "",
      },
    })).toBe(true);
  });

  it("allows the offline fallback only for a classified durable allowance 429", () => {
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: 429,
      failureKind: "guided_session_allowance_exhausted",
    })).toBe(true);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: 429,
    })).toBe(false);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: 429,
      failureKind: null,
    })).toBe(false);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: 503,
      failureKind: "guided_session_allowance_exhausted",
    })).toBe(false);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      sourceMode: "user_materials",
      responseStatus: 429,
      failureKind: "guided_session_allowance_exhausted",
    })).toBe(false);
  });

  it("allows a need-teaching request only when the matching fallback is supplied", () => {
    const outsideFallback = buildOutsideYovaFallbackLesson({
      topic: "how the Krebs cycle produces NADH and FADH2",
      objective: "Explain how the cycle transfers energy to NADH and FADH2.",
      method: "Active retrieval with a source check",
      learningMode: "learn",
      availableMinutes: 10,
    });
    const request = {
      ...eligible,
      adjustment: {
        familiarity: "need_teaching" as const,
        availableMinutes: 10,
        knownTargets: [],
        note: "",
      },
    };

    expect(canUseBuiltInSessionFallback({ ...request, outsideFallback })).toBe(true);
    expect(canUseBuiltInSessionFallback({ ...request, outsideFallback: null })).toBe(false);
  });

  it("fails closed for material-grounded plans", () => {
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      sourceMode: "user_materials",
    })).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "fails closed after a %i client response",
    (responseStatus) => {
      expect(canUseBuiltInSessionFallback({
        ...eligible,
        responseStatus,
      })).toBe(false);
    },
  );

  it("fails closed when the server could not verify the plan state", () => {
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      responseStatus: 500,
    })).toBe(false);
  });

  it("fails closed when the current client plan is archived, deleted, or otherwise unavailable", () => {
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      planStatus: "archived",
    })).toBe(false);
    expect(canUseBuiltInSessionFallback({
      ...eligible,
      planStatus: undefined,
    })).toBe(false);
  });
});

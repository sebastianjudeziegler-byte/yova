import { describe, expect, it } from "vitest";
import {
  builtInFallbackSupportsAdjustment,
  builtInLessonCoversTarget,
  builtInLessonFitsTime,
  builtInSessionFallbackKind,
  builtInTopicEvidenceId,
} from "@/lib/session-generation/built-in-fallback";

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
});

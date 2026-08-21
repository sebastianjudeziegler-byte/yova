import { describe, expect, it } from "vitest";
import {
  deriveLearningTitle,
  interpretIntake,
  resolveLearningTitle,
  resolveLearningTopic,
} from "@/lib/intake/interpret";

const NOW = new Date("2026-08-07T12:00:00-07:00");

describe("universal Add intake", () => {
  it("keeps a deadline-only test specific without inventing materials", () => {
    const result = interpretIntake({
      description: "I have a World War I test in 2 weeks and I know nothing yet",
      materialNames: [],
      now: NOW,
    });
    expect(result.itemType).toBe("test");
    expect(result.title).toMatch(/world war i/i);
    expect(result.progress).toBe("Starting from the beginning");
    expect(result.dueAt).toBe("2026-08-22T06:59:59.999Z");
    expect(result.materialsSummary).toContain("No materials attached");
  });

  it("recognizes an assignment and preserves its real scope", () => {
    const result = interpretIntake({
      description: "My essay about the causes of World War I is due tomorrow",
      materialNames: ["essay-prompt.pdf"],
      now: NOW,
    });
    expect(result.itemType).toBe("assignment");
    expect(result.title).toContain("World War I");
    expect(result.objective).toContain("Complete the requested work");
    expect(result.materialsSummary).toContain("essay-prompt.pdf");
  });

  it("does not invent a due date for general learning", () => {
    const result = interpretIntake({
      description: "I want to learn startup funding from the beginning",
      materialNames: [],
      now: NOW,
    });
    expect(result.title).toMatch(/startup funding/i);
    expect(result.dueAt).toBeNull();
    expect(result.progress).toBe("Starting from the beginning");
  });

  it("understands common written deadlines without forcing calendar syntax", () => {
    const relative = interpretIntake({
      description: "I want to understand basic accounting before my internship in two weeks",
      materialNames: [],
      now: NOW,
    });
    const calendarDate = interpretIntake({
      description: "My lab report is due August 19",
      materialNames: [],
      now: NOW,
    });
    expect(relative.dueAt).toBe("2026-08-22T06:59:59.999Z");
    expect(calendarDate.dueAt).toBe("2026-08-20T06:59:59.999Z");
  });

  it("uses the learner's calendar day for relative deadlines late at night", () => {
    const result = interpretIntake({
      description: "I have a biology quiz on osmosis in one week",
      materialNames: [],
      now: new Date("2026-08-21T05:42:00.000Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(result.dueAt).toBe("2026-08-28T06:59:59.999Z");
  });

  it("keeps one focused skill distinct from a broad course", () => {
    const focused = interpretIntake({
      description: "Teach me the product rule",
      materialNames: [],
      now: NOW,
    });
    const broad = interpretIntake({
      description: "I want to learn all of calculus",
      materialNames: [],
      now: NOW,
    });
    expect(focused.itemType).toBe("skill");
    expect(focused.title).toMatch(/product rule/i);
    expect(focused.requestedMinutes).toBeNull();
    expect(broad.itemType).toBe("course");
    expect(broad.title).toMatch(/calculus/i);
  });

  it("preserves a one-off time request and recognizes outside work", () => {
    const focused = interpretIntake({
      description: "I need to understand the product rule in 20 minutes",
      materialNames: [],
      now: NOW,
    });
    const assignment = interpretIntake({
      description: "I need to complete 20 calculus problems from my textbook by Thursday",
      materialNames: [],
      now: NOW,
    });
    expect(focused.requestedMinutes).toBe(20);
    expect(focused.title).toBe("Understand the Product Rule");
    expect(assignment.itemType).toBe("assignment");
    expect(assignment.dueAt).not.toBeNull();
  });

  it("keeps scheduling details out of learner-derived titles", () => {
    expect(deriveLearningTitle("My lab report is due August 19, 2026", "assignment"))
      .toBe("Lab Report");
    expect(deriveLearningTitle("I have a biology test next Friday on cellular respiration", "test"))
      .toBe("Biology Test on Cellular Respiration");
    expect(resolveLearningTitle(
      "1,500-word History Essay Due and I Have Not Started",
      "1,500-word History Essay Due and I Have Not Started",
    )).toBe("1,500-word History Essay");
  });

  it("repairs generic saved plan names from their actual topic", () => {
    expect(resolveLearningTitle(
      "Personalized learning plan",
      "I want to learn new vocabulary words so I can be better in conversation",
    ))
      // The generic saved name must be replaced by something drawn from the
      // real topic; the exact wording is not the contract.
      .toMatch(/vocabulary/i);
  });

  it("does not replace a clean long title with a malformed topic fragment", () => {
    const title = "Biology Quiz on Osmosis and Tonicity Across Animal and Plant Cell Systems";
    const fragment = ", and the Effects on Animal and Plant Cells Using the Attached Notes";

    const resolved = resolveLearningTitle(title, fragment);

    expect(resolved).toMatch(/^Biology Quiz on Osmosis and Tonicity/i);
    expect(resolved).not.toMatch(/Effects on Animal/i);
    expect(resolved.length).toBeLessThanOrEqual(72);
    expect(resolveLearningTopic(fragment, title)).toBe(title);
  });

  it("turns sentence-like assignment names into a concise subject title", () => {
    const concise = resolveLearningTitle(
      "Thermodynamics Essay. I Have an Essay That I Have",
      "I have an essay about thermodynamics due next week",
    );
    expect(concise).toMatch(/thermodynamics/i);
    expect(concise).not.toMatch(/I Have an Essay That I Have/i);
    expect(concise.length).toBeLessThanOrEqual(72);
    expect(resolveLearningTitle(
      "1,500-word History Essay. I Have a 1,500-word History Essay",
      "due next Friday and I have not started yet",
    )).toBe("1,500-word History Essay");
  });

  it.each([
    ["Explain how NADH carries electrons between metabolic reactions", "NADH"],
    ["Explain how FADH2 carries electrons between metabolic reactions", "FADH2"],
    ["Learn why ATP stores usable cellular energy", "ATP"],
    ["Compare DNA replication and repair mechanisms", "DNA"],
  ])("preserves the acronym in %s", (description, acronym) => {
    expect(deriveLearningTitle(description)).toContain(acronym);
  });

  it("keeps a short coordinated acronym phrase intact past nine words", () => {
    expect(deriveLearningTitle("Understand how the Krebs cycle actually produces NADH and ATP"))
      .toBe("Understand How the Krebs Cycle Actually Produces NADH and ATP");
    expect(deriveLearningTitle("Understand how the Krebs cycle actually produces NADH and FADH2"))
      .toBe("Understand How the Krebs Cycle Actually Produces NADH and FADH2");
  });

  it("does not mistake a mathematical comparison term for a dangling preposition", () => {
    expect(deriveLearningTitle("Compare greater than and less than"))
      .toBe("Compare Greater Than and Less Than");
  });

  it.each([
    ["Learn how energy moves through ecosystems and", "Learn How Energy Moves Through Ecosystems"],
    ["Explore the", "Explore"],
    ["Understand the structure of", "Understand the Structure"],
    ["Learn how cells respond to", "Learn How Cells Respond"],
    ["Explore the effect on", "Explore the Effect"],
  ])("does not leave a dangling word in %s", (description, expected) => {
    expect(deriveLearningTitle(description)).toBe(expected);
  });

  it("backs a long title up to a complete clause", () => {
    expect(deriveLearningTitle(
      "Explore how ancient trade routes shaped societies, then compare their political and economic effects across several regions and eras",
    )).toBe("Explore How Ancient Trade Routes Shaped Societies");
  });

  it("recognizes a short sentence as the clean boundary in a long goal", () => {
    expect(deriveLearningTitle(
      "Compare cell systems. Investigate molecular structures across multiple organisms using detailed examples and experimental evidence from modern laboratories",
    )).toBe("Compare Cell Systems");
  });

  it("reserves room for the test-prep suffix instead of slicing it", () => {
    const title = deriveLearningTitle(
      "Analyze comparative political institutions across historical regions and evaluate their economic consequences using primary evidence and competing interpretations",
      "test",
    );

    expect(title).toMatch(/ Test Prep$/);
    expect(title.length).toBeLessThanOrEqual(100);
  });
});

describe("goals that keyword matching used to mislabel", () => {
  // Each of these produced a canned subject title that contradicted the goal.
  const misfires: Array<[string, RegExp, RegExp]> = [
    ["Finish my extra credit assignment about the Cold War arms race", /cold war/i, /personal finance/i],
    ["I want to budget my study time better before finals week arrives", /study time|budget/i, /personal finance/i],
    ["Plan how many credit hours to take next semester without burning out", /credit hours/i, /personal finance/i],
    ["Learn about investing time in deliberate practice for music", /deliberate practice|music/i, /personal finance/i],
    ["Understand the water cycle for my biology class test on Friday", /water cycle/i, /^biology (test prep|foundations)$/i],
    ["Learn new words in the vocabulary section of my SAT prep book", /sat/i, /conversation vocabulary builder/i],
  ];

  it.each(misfires)("keeps %s about what the learner asked", (goal, expected, canned) => {
    const title = deriveLearningTitle(goal);
    expect(title).toMatch(expected);
    expect(title).not.toMatch(canned);
  });

  it("never adds a subject the learner explicitly excluded", () => {
    const title = deriveLearningTitle("Understand only cellular respiration, not photosynthesis, for my exam");
    expect(title).toMatch(/cellular respiration/i);
    expect(title).not.toBe("Photosynthesis and Cellular Respiration");
  });

  it("keeps both rules when the learner named two", () => {
    const title = deriveLearningTitle("Learn the product rule and the quotient rule for derivatives");
    expect(title).toMatch(/quotient/i);
  });
});

it("does not append Test Prep to a title that already says prep", () => {
  expect(deriveLearningTitle("Learn new words in the vocabulary section of my SAT prep book"))
    .not.toMatch(/prep.*prep/i);
});

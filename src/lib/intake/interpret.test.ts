import { describe, expect, it } from "vitest";
import { deriveLearningTitle, interpretIntake, resolveLearningTitle } from "@/lib/intake/interpret";

const NOW = new Date("2026-08-07T12:00:00-07:00");

describe("universal Add intake", () => {
  it("keeps a deadline-only test specific without inventing materials", () => {
    const result = interpretIntake({
      description: "I have a World War I test in 2 weeks and I know nothing yet",
      materialNames: [],
      now: NOW,
    });
    expect(result.itemType).toBe("test");
    expect(result.title).toBe("World War I Test Prep");
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
    expect(result.title).toBe("Startup Funding Foundations");
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
    expect(focused.title).toBe("Calculus: Product Rule");
    expect(focused.requestedMinutes).toBeNull();
    expect(broad.itemType).toBe("course");
    expect(broad.title).toBe("Calculus Learning Path");
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
    expect(assignment.itemType).toBe("assignment");
    expect(assignment.dueAt).not.toBeNull();
  });

  it("repairs generic saved plan names from their actual topic", () => {
    expect(resolveLearningTitle(
      "Personalized learning plan",
      "I want to learn new vocabulary words so I can be better in conversation",
    )).toBe("Conversation Vocabulary Builder");
  });

  it("turns sentence-like assignment names into a concise subject title", () => {
    expect(resolveLearningTitle(
      "Thermodynamics Essay. I Have an Essay That I Have",
      "I have an essay about thermodynamics due next week",
    )).toBe("Thermodynamics Essay");
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

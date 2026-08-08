import { describe, expect, it } from "vitest";
import { interpretIntake } from "@/lib/intake/interpret";

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
});

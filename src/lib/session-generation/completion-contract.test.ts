import { describe, expect, it } from "vitest";
import { validateSessionCompletionContract } from "@/lib/session-generation/completion-contract";

const activities = [
  { type: "instruction" as const, concept: null, requiredForCompletion: true },
  { type: "multiple_choice" as const, concept: "ATP role", requiredForCompletion: true },
  { type: "free_response" as const, concept: "Stage connections", requiredForCompletion: true },
];

describe("session completion contract", () => {
  it("accepts a required check for every stated essential idea", () => {
    expect(validateSessionCompletionContract({
      essentialIdeas: ["ATP stores usable energy", "The stages pass products forward"],
      evidenceMap: [
        { essentialIdea: "ATP stores usable energy", activityConcept: "ATP role" },
        { essentialIdea: "The stages pass products forward", activityConcept: "Stage connections" },
      ],
      activities,
    })).toBeNull();
  });

  it("rejects an essential idea that is only stated but never checked", () => {
    expect(validateSessionCompletionContract({
      essentialIdeas: ["ATP stores usable energy", "The stages pass products forward"],
      evidenceMap: [
        { essentialIdea: "ATP stores usable energy", activityConcept: "ATP role" },
      ],
      activities,
    })).toContain("has no required knowledge check");
  });

  it("rejects a map pointing to an optional or nonexistent check", () => {
    expect(validateSessionCompletionContract({
      essentialIdeas: ["ATP stores usable energy"],
      evidenceMap: [
        { essentialIdea: "ATP stores usable energy", activityConcept: "Optional extension" },
      ],
      activities: [
        ...activities,
        { type: "free_response" as const, concept: "Optional extension", requiredForCompletion: false },
      ],
    })).toContain("no required knowledge check");
  });

  it("rejects invented and duplicate mappings", () => {
    expect(validateSessionCompletionContract({
      essentialIdeas: ["ATP stores usable energy"],
      evidenceMap: [
        { essentialIdea: "An unrelated target", activityConcept: "ATP role" },
      ],
      activities,
    })).toContain("not one of this session's essential ideas");

    expect(validateSessionCompletionContract({
      essentialIdeas: ["ATP stores usable energy"],
      evidenceMap: [
        { essentialIdea: "ATP stores usable energy", activityConcept: "ATP role" },
        { essentialIdea: "ATP stores usable energy", activityConcept: "ATP role" },
      ],
      activities,
    })).toContain("more than once");
  });
});

import { describe, expect, it } from "vitest";
import {
  groundSessionEvidenceMap,
  reconcileSessionCompletionMap,
  validateSessionCompletionContract,
} from "@/lib/session-generation/completion-contract";

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

  it("accepts one unambiguous longer version of the same concept label", () => {
    expect(validateSessionCompletionContract({
      essentialIdeas: ["Equity funding can dilute founder ownership"],
      evidenceMap: [{
        essentialIdea: "Equity funding can dilute founder ownership",
        activityConcept: "Dilution",
      }],
      activities: [{
        type: "multiple_choice",
        concept: "Equity dilution",
        requiredForCompletion: true,
      }],
    })).toBeNull();
  });

  it("reconciles a uniquely related model label to the question's stored concept", () => {
    const reconciled = reconcileSessionCompletionMap({
      coverage: {
        evidenceMap: [{
          essentialIdea: "Investment terms determine who gets what and under which conditions",
          activityConcept: "Term sheets",
        }],
      },
      activities: [
        { type: "multiple_choice" as const, concept: "Funding stages", requiredForCompletion: true },
        { type: "multiple_choice" as const, concept: "Investment terms", requiredForCompletion: true },
      ],
    });

    expect(reconciled.coverage.evidenceMap[0].activityConcept).toBe("Investment terms");
  });

  it("uses the actual question wording when a literary evidence label drifts", () => {
    const reconciled = reconcileSessionCompletionMap({
      coverage: {
        evidenceMap: [{
          essentialIdea: "The unopened door and Mara's closed posture suggest hesitation or uncertainty",
          activityConcept: "Door and posture meaning",
        }],
      },
      activities: [
        {
          type: "multiple_choice" as const,
          concept: "Setting and tension",
          requiredForCompletion: true,
          title: "What does the storm contribute?",
          body: "Choose the interpretation best supported by the storm pressing against the windows.",
          choices: ["Tension", "Relief", "Celebration"],
          correctAnswer: "Tension",
        },
        {
          type: "free_response" as const,
          concept: "Mara's hesitation",
          requiredForCompletion: true,
          title: "Connect the unopened door to Mara's posture",
          body: "Explain how the trembling handle and her hands in her pockets suggest hesitation.",
          choices: [],
          correctAnswer: "The closed posture and unopened door suggest that Mara is hesitant to act.",
        },
      ],
    });

    expect(reconciled.coverage.evidenceMap[0].activityConcept).toBe("Mara's hesitation");
  });

  it("replaces a generic study-guide label with the concrete WWI answer being checked", () => {
    const grounded = groundSessionEvidenceMap({
      coverage: {
        essentialIdeas: ["The overall relationship among the listed unit sections"],
        evidenceMap: [{
          essentialIdea: "The overall relationship among the listed unit sections",
          activityConcept: "Map the Study Guide",
        }],
        deferredContent: [],
      },
      activities: [{
        type: "multiple_choice" as const,
        concept: "Alliance commitments and mobilization",
        requiredForCompletion: true,
        title: "Why did a local crisis widen?",
        body: "Which factor helped turn the assassination of Franz Ferdinand into a wider European war?",
        choices: ["Alliance commitments and mobilization", "A peace treaty", "The invention of tanks"],
        correctAnswer: "Alliance commitments and mobilization",
      }],
    });

    expect(grounded.coverage.essentialIdeas).toEqual(["Alliance commitments and mobilization"]);
    expect(grounded.coverage.evidenceMap).toEqual([{
      essentialIdea: "Alliance commitments and mobilization",
      activityConcept: "Alliance commitments and mobilization",
    }]);
    expect(grounded.coverage.deferredContent).toContain(
      "The overall relationship among the listed unit sections",
    );
    expect(validateSessionCompletionContract({
      essentialIdeas: grounded.coverage.essentialIdeas,
      evidenceMap: grounded.coverage.evidenceMap,
      activities: grounded.activities,
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

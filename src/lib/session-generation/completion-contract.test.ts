import { describe, expect, it } from "vitest";
import {
  groundSessionEvidenceMap,
  reconcileSessionCompletionMap,
  validateSessionCompletionContract,
} from "@/lib/session-generation/completion-contract";

const activities = [
  { type: "instruction" as const, concept: null, requiredForCompletion: true },
  {
    type: "multiple_choice" as const,
    concept: "ATP role",
    requiredForCompletion: true,
    title: "Identify ATP's role",
    body: "Which statement explains how ATP stores usable energy?",
    choices: ["ATP stores usable energy", "ATP destroys all energy", "ATP is only structural"],
    correctAnswer: "ATP stores usable energy",
  },
  {
    type: "free_response" as const,
    concept: "Stage connections",
    requiredForCompletion: true,
    title: "Explain how the stages connect",
    body: "Explain how the stages pass products forward to the next stage.",
    correctAnswer: "Each stage passes products forward for the next stage to use.",
  },
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
        title: "Identify equity dilution",
        body: "What can happen to founder ownership when a company raises equity funding?",
        choices: ["Equity funding can dilute founder ownership", "Founder ownership always increases"],
        correctAnswer: "Equity funding can dilute founder ownership",
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

  it("does not attach a prewar-tensions idea to broad later-war chronology feedback", () => {
    const activeIdea = "Before 1914, Europe had rival alliance blocs and tensions that made a local crisis more dangerous.";
    const deferredChronology = "Later-war chronology, including U.S. entry in 1917 and the 1918 armistice.";
    const broadFeedback = "Correct: the assassination comes first, then the July Crisis, then the war opens in 1914, with U.S. entry in 1917 and the armistice in 1918. If you missed it, separate trigger, escalation, and later-war chronology.";
    const grounded = groundSessionEvidenceMap({
      coverage: {
        essentialIdeas: [activeIdea],
        evidenceMap: [{
          essentialIdea: activeIdea,
          activityConcept: "Prewar tensions",
        }],
        deferredContent: [deferredChronology],
      },
      activities: [{
        type: "multiple_choice" as const,
        concept: "World War I chronology",
        requiredForCompletion: true,
        title: "Put the cause chain in order",
        body: "Which sequence best orders the trigger, escalation, U.S. entry, and armistice?",
        choices: [
          "Assassination, July Crisis, war opens, U.S. entry, armistice",
          "U.S. entry, assassination, July Crisis, armistice",
          "Armistice, assassination, U.S. entry, July Crisis",
        ],
        correctAnswer: "Assassination, July Crisis, war opens, U.S. entry, armistice",
        feedback: broadFeedback,
      }],
    });

    expect(grounded.coverage.essentialIdeas).toEqual([activeIdea]);
    expect(grounded.coverage.evidenceMap).toEqual([{
      essentialIdea: activeIdea,
      activityConcept: "Prewar tensions",
    }]);
    expect(grounded.coverage.deferredContent).toContain(deferredChronology);
    expect(grounded.coverage.essentialIdeas).not.toContain(broadFeedback);
    expect(grounded.activities[0].feedback).toBe(broadFeedback);
    expect(validateSessionCompletionContract({
      essentialIdeas: grounded.coverage.essentialIdeas,
      evidenceMap: grounded.coverage.evidenceMap,
      activities: grounded.activities,
    })).toContain("no required knowledge check uses that concept");
  });

  it("defers an unmatched idea while preserving a semantically grounded active idea", () => {
    const julyCrisisIdea = "Alliance commitments and mobilization turned the July Crisis into declarations of war.";
    const laterChronologyIdea = "U.S. entry in 1917 preceded the armistice in 1918.";
    const grounded = groundSessionEvidenceMap({
      coverage: {
        essentialIdeas: [julyCrisisIdea, laterChronologyIdea],
        evidenceMap: [
          { essentialIdea: julyCrisisIdea, activityConcept: "Cause chain" },
          { essentialIdea: laterChronologyIdea, activityConcept: "Later chronology" },
        ],
        deferredContent: [],
      },
      activities: [{
        type: "free_response" as const,
        concept: "July Crisis escalation",
        requiredForCompletion: true,
        title: "Explain the July Crisis escalation",
        body: "Explain how alliance commitments and mobilization widened the crisis into declarations of war.",
        correctAnswer: "Alliance commitments connected powers, while mobilization escalated the July Crisis into declarations of war.",
        feedback: "Connect alliance commitments and mobilization directly to escalation.",
      }],
    });

    expect(grounded.coverage.essentialIdeas).toEqual([julyCrisisIdea]);
    expect(grounded.coverage.evidenceMap).toEqual([{
      essentialIdea: julyCrisisIdea,
      activityConcept: "July Crisis escalation",
    }]);
    expect(grounded.coverage.deferredContent).toContain(laterChronologyIdea);
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

  it("rejects an exact concept mapping when the required question tests unrelated chronology", () => {
    const activeIdea = "Alliance commitments and mobilization turned the July Crisis into declarations of war.";

    expect(validateSessionCompletionContract({
      essentialIdeas: [activeIdea],
      evidenceMap: [{
        essentialIdea: activeIdea,
        activityConcept: "July Crisis escalation",
      }],
      activities: [{
        type: "multiple_choice",
        concept: "July Crisis escalation",
        requiredForCompletion: true,
        title: "Identify the end of World War I",
        body: "Which event ended the fighting in 1918?",
        choices: ["The armistice", "U.S. entry", "The Battle of the Somme"],
        correctAnswer: "The armistice",
        feedback: "The armistice ended the fighting in 1918.",
      }],
    })).toContain("does not visibly assess that essential idea");
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

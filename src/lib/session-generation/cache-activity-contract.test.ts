import { describe, expect, it, vi } from "vitest";
import { cachedSessionActivityContractIssue } from "@/lib/session-generation/cache-activity-contract";
import type {
  GeneratedSessionActivity,
  GeneratedSessionDraft,
} from "@/lib/session-generation/schema";

vi.mock("server-only", () => ({}));

const topicId = "11111111-1111-4111-8111-111111111111";

function question(
  type: "multiple_choice" | "free_response",
  methodPhase: GeneratedSessionActivity["methodPhase"],
  concept = "Cell respiration",
): GeneratedSessionActivity {
  return {
    topicId,
    methodPhase,
    estimatedMinutes: 2,
    requiredForCompletion: true,
    label: "Check",
    title: "Explain the relationship",
    body: "Explain how this relationship changes the result in the stated example.",
    teaching: null,
    type,
    concept,
    choices: type === "multiple_choice" ? ["First", "Second", "Third"] : [],
    correctAnswer: type === "multiple_choice" ? "First" : "The relationship changes the result through the stated mechanism.",
    feedback: "The relationship changes the result through the mechanism described in the learning target.",
    practiceIntent: "independent_transfer",
    misconceptionSummary: null,
    methodRuntime: null,
  };
}

function draft(activities: GeneratedSessionActivity[]): GeneratedSessionDraft {
  return {
    topicIds: [topicId],
    rationale: "This session retrieves the target before repairing and checking the learner's explanation.",
    coverage: {
      focus: "Retrieve and explain the cell-respiration relationship.",
      essentialIdeas: ["Cell respiration links the mechanism to the observed result"],
      completionEvidence: ["Explain the mechanism independently in a typed response"],
      evidenceMap: [{
        essentialIdea: "Cell respiration links the mechanism to the observed result",
        activityConcept: "Cell respiration",
      }],
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "retrieval_practice",
      name: "Retrieval practice",
      what: "Retrieve the relationship before reviewing the explanation or correction.",
      why: "A first attempt makes the learner's current knowledge visible before any answer review.",
      how: ["Attempt the answer from memory.", "Repair the exposed gap with a fresh response."],
      completion: "The learner has attempted the relationship and repaired the exposed gap independently.",
      personalization: ["The current evidence supports a short retrieval attempt followed by a bounded repair."],
    },
    sourceGrounding: null,
    activities,
  };
}

describe("cached session activity contracts", () => {
  it("accepts an ordinary cached session with required typed recall and valid phases", () => {
    const session = draft([
      question("multiple_choice", "retrieve"),
      question("free_response", "repair"),
      question("free_response", "transfer"),
    ]);

    expect(cachedSessionActivityContractIssue(session, {
      reviewType: null,
      reviewConcept: null,
      estimatedMinutes: 15,
    })).toBeNull();
  });

  it("rejects an old all-multiple-choice ordinary cache", () => {
    const session = draft([
      question("multiple_choice", "retrieve"),
      question("multiple_choice", "repair"),
      question("multiple_choice", "transfer"),
    ]);

    expect(cachedSessionActivityContractIssue(session, {
      reviewType: null,
      reviewConcept: null,
      estimatedMinutes: 15,
    })).toMatch(/typed active-recall/i);
  });

  it("rejects an old cache that attaches an explain phase to multiple choice", () => {
    const session = draft([
      question("multiple_choice", "retrieve"),
      question("multiple_choice", "explain"),
      question("free_response", "repair"),
    ]);

    expect(cachedSessionActivityContractIssue(session, {
      reviewType: null,
      reviewConcept: null,
      estimatedMinutes: 15,
    })).toMatch(/cannot perform/i);
  });

  it("accepts only the exact three-question scheduled-review cache contract", () => {
    const scheduled = draft([
      question("multiple_choice", "retrieve", "Cell respiration"),
      question("multiple_choice", "discriminate", "Cell respiration"),
      question("multiple_choice", "transfer", "Cell respiration"),
    ]);

    expect(cachedSessionActivityContractIssue(scheduled, {
      reviewType: "verify",
      reviewConcept: "Cell respiration",
      estimatedMinutes: 10,
    })).toBeNull();

    expect(cachedSessionActivityContractIssue({
      ...scheduled,
      activities: [
        question("multiple_choice", "retrieve", "Cell respiration"),
        question("free_response", "repair", "Cell respiration"),
        question("multiple_choice", "transfer", "Cell respiration"),
      ],
    }, {
      reviewType: "verify",
      reviewConcept: "Cell respiration",
      estimatedMinutes: 10,
    })).toMatch(/multiple-choice questions only/i);
  });
});

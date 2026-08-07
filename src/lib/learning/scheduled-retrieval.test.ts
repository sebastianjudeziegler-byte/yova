import { describe, expect, it } from "vitest";
import {
  adaptDeliveryPolicyForScheduledRetrieval,
  inferScheduledRetrievalConcept,
  inferScheduledRetrievalType,
  scheduledRetrievalContract,
  validateScheduledRetrievalSession,
} from "@/lib/learning/scheduled-retrieval";
import { GeneratedSessionDraftSchema, type GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

const session = {
  learningMode: "study" as const,
  estimatedMinutes: 5,
  reviewConcept: "Electron transport chain",
  reviewType: "verify" as const,
};

const draft: GeneratedSessionDraft = {
  rationale: "A short delayed return checks whether the idea can be retrieved without turning review into another full lesson.",
  coverage: {
    focus: "Retrieve the core role of the electron transport chain after a delay.",
    essentialIdeas: ["The electron transport chain builds the gradient used for ATP production"],
    completionEvidence: ["Choose the electron transport chain relationship without opening prior notes"],
    evidenceMap: [{
      essentialIdea: "The electron transport chain builds the gradient used for ATP production",
      activityConcept: "Electron transport chain",
    }],
    deferredContent: [],
  },
  methodBriefing: {
    learningMode: "study",
    taskType: "conceptual_learning",
    methodId: "retrieval_practice",
    name: "Quick retrieval check",
    what: "Choose each answer from memory before seeing corrective feedback.",
    why: "A delayed retrieval shows whether the relationship is available after time has passed instead of only immediately after study.",
    how: [
      "Answer before opening notes or prior feedback.",
      "Read the explanation after each choice and repair only the exposed gap.",
    ],
    completion: "All three short questions have been attempted and any miss has been marked for another return.",
    personalization: ["YOVA is showing one multiple-choice question at a time to keep this scheduled return light."],
  },
  sourceGrounding: null,
  activities: [
    reviewQuestion("retrieve", "What does the electron transport chain directly build?", "A proton gradient"),
    reviewQuestion("discriminate", "Which relationship is accurate?", "Electron movement supports proton pumping"),
    reviewQuestion("transfer", "What would most directly weaken ATP synthase output?", "Loss of the proton gradient"),
  ],
};

const deliveryPolicy: SessionDeliveryPolicy = {
  schemaVersion: 1,
  evidenceStatus: "starting_hypothesis",
  presentation: { mode: "example_first", label: "Example first", instruction: "Use a concrete case before naming the general relationship." },
  repair: { mode: "hint_first", label: "Hint first", instruction: "Reveal one bounded cue before showing the complete correction." },
  retention: { mode: "delayed_retrieval", label: "Delayed retrieval", instruction: "Schedule another unsupported retrieval after a delay." },
  workspace: { mode: "full_path", label: "Full path", instruction: "Keep the full session path visible while the learner works." },
  pacing: { firstActionMinutes: 3, maximumActivities: 5, reason: "Use the standard pacing until YOVA has more evidence." },
  learnerFacingReasons: ["You asked for examples first, so YOVA normally begins new teaching with a concrete case."],
  signalsUsed: ["A concrete example first"],
};

describe("scheduled retrieval contract", () => {
  it("accepts a three-question multiple-choice return without typed recall", () => {
    expect(GeneratedSessionDraftSchema.safeParse(draft).success).toBe(true);
    expect(validateScheduledRetrievalSession(draft, session)).toBeNull();
    expect(scheduledRetrievalContract(session)?.learnerPromise).toContain("No typed response");
  });

  it("rejects a typed response inside a scheduled return", () => {
    const invalid: GeneratedSessionDraft = {
      ...draft,
      activities: [
        draft.activities[0],
        {
          ...draft.activities[1],
          type: "free_response",
          choices: [],
          correctAnswer: "Electron movement supports proton pumping.",
        },
        draft.activities[2],
      ],
    };

    expect(validateScheduledRetrievalSession(invalid, session)).toMatch(/multiple-choice questions only/i);
  });

  it("overrides a full-session delivery policy with a calm one-question-at-a-time format", () => {
    const result = adaptDeliveryPolicyForScheduledRetrieval(deliveryPolicy, session.reviewConcept);

    expect(result.retention.mode).toBe("retrieval");
    expect(result.workspace.mode).toBe("one_step");
    expect(result.pacing.maximumActivities).toBe(3);
    expect(result.learnerFacingReasons[0]).toMatch(/short multiple-choice check/i);
  });

  it("upgrades delayed checks created before explicit review metadata existed", () => {
    const legacySession = {
      title: "Repair and verify Electron transport chain",
      method: "Misconception repair and delayed transfer",
    };

    expect(inferScheduledRetrievalType(legacySession)).toBe("repair_and_retrieve");
    expect(inferScheduledRetrievalConcept(legacySession)).toBe("Electron transport chain");
  });
});

function reviewQuestion(
  methodPhase: "retrieve" | "discriminate" | "transfer",
  title: string,
  correctAnswer: string,
): GeneratedSessionDraft["activities"][number] {
  return {
    methodPhase,
    concept: "Electron transport chain",
    estimatedMinutes: methodPhase === "retrieve" ? 1 : 2,
    requiredForCompletion: true,
    label: "Quick check",
    title,
    body: "Choose the best answer from memory before reading the explanation.",
    teaching: null,
    type: "multiple_choice",
    choices: [correctAnswer, "Glucose", "Amino acids", "Carbon dioxide"],
    correctAnswer,
    feedback: "The electron transport chain uses electron movement to support proton pumping and the gradient that powers ATP synthase.",
  };
}

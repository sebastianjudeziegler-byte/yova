import { describe, expect, it } from "vitest";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import {
  buildPracticeVariationContract,
  validatePracticeVariation,
} from "@/lib/learning/practice-variation";

const gapId = "11111111-1111-4111-8111-111111111111";
const secureId = "22222222-2222-4222-8222-222222222222";

function topic(id: string, title: string, status: KnowledgeMapTopic["status"]): KnowledgeMapTopic {
  return {
    id,
    title,
    description: `The knowledge and performance needed for ${title}.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status,
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    curriculumReference: null,
  };
}

describe("evidence-driven practice variation", () => {
  it("weights a demonstrated gap ahead of secure knowledge and verifies secure knowledge lightly", () => {
    const contract = buildPracticeVariationContract({
      topics: [topic(secureId, "Cell structure", "secure"), topic(gapId, "Membrane transport", "taught")],
      conceptSignals: [{
        topicId: gapId,
        concept: "Membrane transport",
        attempts: 2,
        secureAttempts: 0,
        needsReviewAttempts: 2,
        lastOutcome: "needs_review",
        lastObservedAt: "2026-08-09T18:00:00.000Z",
        status: "needs_review",
      }],
      scaffoldSignals: [],
      calibrationSignals: [],
      maximumChecks: 2,
    });

    expect(contract.directives.map((directive) => [directive.topicId, directive.requiredIntent])).toEqual([
      [gapId, "develop_gap"],
      [secureId, "light_verification"],
    ]);
    expect(validatePracticeVariation({
      contract,
      isScheduledReview: false,
      activities: [
        { topicId: gapId, methodPhase: "independent_practice", type: "free_response", practiceIntent: "develop_gap" },
        { topicId: secureId, methodPhase: "retrieve", type: "multiple_choice", practiceIntent: "light_verification" },
      ],
    })).toBeNull();
  });

  it("requires the exact confident misconception context in a discrimination check", () => {
    const misconception = "Diffusion requires ATP whenever molecules cross a membrane.";
    const contract = buildPracticeVariationContract({
      topics: [topic(gapId, "Membrane transport", "taught")],
      conceptSignals: [],
      scaffoldSignals: [],
      calibrationSignals: [{
        topicId: gapId,
        concept: "Membrane transport",
        pattern: "possible_misconception",
        checkedAnswers: 1,
        highConfidenceMisses: 1,
        lowConfidenceSuccesses: 0,
        misconceptionSummary: misconception,
        feedback: "Directly distinguish passive transport from ATP-dependent active transport.",
      }],
      maximumChecks: 1,
    });
    const wrongContext = validatePracticeVariation({
      contract,
      isScheduledReview: false,
      activities: [{
        topicId: gapId,
        methodPhase: "discriminate",
        type: "multiple_choice",
        practiceIntent: "misconception_discrimination",
        misconceptionSummary: "A different generic mix-up.",
      }],
    });

    expect(wrongContext).toContain("specific misconception context");
    expect(validatePracticeVariation({
      contract,
      isScheduledReview: false,
      activities: [{
        topicId: gapId,
        methodPhase: "discriminate",
        type: "multiple_choice",
        practiceIntent: "misconception_discrimination",
        misconceptionSummary: misconception,
      }],
    })).toBeNull();
  });

  it("restores support after a miss and begins independently after repeated success", () => {
    const restoreContract = buildPracticeVariationContract({
      topics: [topic(gapId, "Membrane transport", "taught")],
      conceptSignals: [],
      scaffoldSignals: [{
        topicId: gapId,
        concept: "Membrane transport",
        checks: 2,
        supportedChecks: 1,
        independentChecks: 1,
        secureIndependentChecks: 0,
        latestOutcome: "needs_review",
        latestPhase: "independent_practice",
        status: "restore_support",
        evidence: "The latest independent check still needs review.",
        guidance: "Restore one bounded model before another attempt.",
      }],
      calibrationSignals: [],
      maximumChecks: 1,
    });
    expect(validatePracticeVariation({
      contract: restoreContract,
      isScheduledReview: false,
      activities: [{ topicId: gapId, methodPhase: "independent_practice", type: "free_response", practiceIntent: "supported_recheck" }],
    })).toContain("brief model or guided step");
    expect(validatePracticeVariation({
      contract: restoreContract,
      isScheduledReview: false,
      activities: [
        { topicId: null, methodPhase: "model", type: "instruction", practiceIntent: null },
        { topicId: gapId, methodPhase: "independent_practice", type: "free_response", practiceIntent: "supported_recheck" },
      ],
    })).toBeNull();
  });

  it("does not alter the strict scheduled-review contract", () => {
    const contract = buildPracticeVariationContract({
      topics: [topic(gapId, "Membrane transport", "taught")],
      conceptSignals: [],
      scaffoldSignals: [],
      calibrationSignals: [],
      maximumChecks: 1,
    });
    expect(validatePracticeVariation({ contract, activities: [], isScheduledReview: true })).toBeNull();
  });
});

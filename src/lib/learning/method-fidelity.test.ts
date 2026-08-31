import { describe, expect, it } from "vitest";
import {
  methodFidelityContractForPrompt,
  validateMethodFidelity,
  type MethodPhase,
} from "@/lib/learning/method-fidelity";

const activity = (methodPhase: MethodPhase, type: "instruction" | "multiple_choice" | "free_response" | "reflection" = "instruction", concept: string | null = null) => ({ methodPhase, type, concept });

describe("learning-method fidelity", () => {
  it("makes the recommended method contract explicit for the generator", () => {
    expect(methodFidelityContractForPrompt("read_recall_review", "learn")).toMatchObject({
      id: "read_recall_review",
      requiredPhases: ["model", "survey", "question", "read_source", "retrieve", "review"],
      orderedPhases: ["model", "survey", "question", "read_source", "retrieve", "review"],
    });
  });

  it("accepts a worked example that fades toward independent performance", () => {
    expect(validateMethodFidelity({
      methodId: "worked_example_fading",
      learningMode: "learn",
      activities: [activity("model"), activity("guided_practice", "multiple_choice", "Product rule setup"), activity("independent_practice", "free_response", "Product rule application")],
    })).toBeNull();
  });

  it("requires the explain phase to collect the learner's own words", () => {
    expect(validateMethodFidelity({
      methodId: "self_explanation",
      learningMode: "study",
      activities: [activity("model"), activity("explain", "multiple_choice", "Funding tradeoff"), activity("repair"), activity("reexplain", "free_response", "Funding tradeoff")],
    })).toMatch(/cannot perform that learning phase/i);

    expect(validateMethodFidelity({
      methodId: "self_explanation",
      learningMode: "study",
      activities: [activity("model"), activity("explain", "free_response", "Funding tradeoff"), activity("repair"), activity("reexplain", "free_response", "Funding tradeoff")],
    })).toBeNull();
  });

  it("rejects a worked example label attached to ordinary quiz questions", () => {
    expect(validateMethodFidelity({
      methodId: "worked_example_fading",
      learningMode: "learn",
      activities: [activity("orient"), activity("independent_practice", "multiple_choice", "Product rule"), activity("reflect", "reflection")],
    })).toMatch(/missing required learning phases/i);
  });

  it("rejects an independent-practice tag placed on passive instruction", () => {
    expect(validateMethodFidelity({
      methodId: "worked_example_fading",
      learningMode: "learn",
      activities: [activity("model"), activity("guided_practice", "multiple_choice", "Product rule setup"), activity("independent_practice")],
    })).toMatch(/cannot perform that learning phase/i);
  });

  it("requires interleaving to mix multiple categories", () => {
    expect(validateMethodFidelity({
      methodId: "interleaved_practice",
      learningMode: "study",
      activities: [activity("discriminate", "multiple_choice", "Product rule"), activity("independent_practice", "free_response", "Product rule")],
    })).toMatch(/distinct question categories/i);
  });

  it("requires the full SQ3R sequence", () => {
    expect(validateMethodFidelity({
      methodId: "read_recall_review",
      learningMode: "study",
      activities: [
        activity("survey"),
        activity("question", "free_response", "Guiding question"),
        activity("read_source"),
        activity("retrieve", "free_response", "Main claim"),
        activity("review", "reflection"),
      ],
    })).toBeNull();
  });

  it("keeps each new method structurally distinct", () => {
    expect(validateMethodFidelity({
      methodId: "pretesting",
      learningMode: "learn",
      activities: [activity("pretest", "multiple_choice"), activity("model"), activity("transfer", "free_response")],
    })).toBeNull();
    expect(validateMethodFidelity({
      methodId: "concept_mapping",
      learningMode: "study",
      activities: [activity("retrieve", "free_response"), activity("connect", "free_response"), activity("evidence_match", "free_response"), activity("repair")],
    })).toBeNull();
    expect(validateMethodFidelity({
      methodId: "practice_problems",
      learningMode: "study",
      activities: [activity("independent_practice", "free_response"), activity("transfer", "free_response")],
    })).toBeNull();
  });

  it("does not pre-author an error repair before the learner has made an error", () => {
    expect(validateMethodFidelity({
      methodId: "practice_problems",
      learningMode: "study",
      activities: [
        activity("independent_practice", "free_response", "Product rule application"),
        activity("repair", "free_response", "Product rule application"),
        activity("transfer", "free_response", "Changed product-rule application"),
      ],
    })).toMatch(/only after an observed learner miss at runtime/i);

    expect(validateMethodFidelity({
      methodId: "pretesting",
      learningMode: "learn",
      activities: [
        activity("pretest", "multiple_choice", "Product rule prediction"),
        activity("model"),
        activity("repair", "free_response", "Product rule prediction"),
        activity("transfer", "free_response", "Changed product-rule application"),
      ],
    })).toMatch(/only after an observed learner miss at runtime/i);
  });

  it("requires an accurate model before retrieval practice when the learner is still learning", () => {
    expect(validateMethodFidelity({
      methodId: "retrieval_practice",
      learningMode: "learn",
      activities: [activity("retrieve", "free_response", "Credit utilization"), activity("repair")],
    })).toMatch(/missing required learning phase.*model/i);

    expect(validateMethodFidelity({
      methodId: "retrieval_practice",
      learningMode: "learn",
      activities: [activity("model"), activity("retrieve", "free_response", "Credit utilization"), activity("repair")],
    })).toBeNull();
  });
});

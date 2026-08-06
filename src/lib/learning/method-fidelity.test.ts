import { describe, expect, it } from "vitest";
import { validateMethodFidelity, type MethodPhase } from "@/lib/learning/method-fidelity";

const activity = (methodPhase: MethodPhase, type: "instruction" | "multiple_choice" | "free_response" | "reflection" = "instruction", concept: string | null = null) => ({ methodPhase, type, concept });

describe("learning-method fidelity", () => {
  it("accepts a worked example that fades toward independent performance", () => {
    expect(validateMethodFidelity({
      methodId: "worked_example_fading",
      learningMode: "learn",
      activities: [activity("model"), activity("guided_practice", "multiple_choice", "Product rule setup"), activity("independent_practice", "free_response", "Product rule application")],
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

  it("makes practice-first reading retrieve before targeted rereading", () => {
    expect(validateMethodFidelity({
      methodId: "read_recall_review",
      learningMode: "study",
      activities: [activity("retrieve", "free_response", "Main claim"), activity("read_source"), activity("transfer", "multiple_choice", "Supporting evidence")],
    })).toBeNull();
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

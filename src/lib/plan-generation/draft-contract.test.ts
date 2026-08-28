import { describe, expect, it } from "vitest";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

describe("plan draft generation receipt contract", () => {
  it("keeps decision inputs while excluding source text and derived understanding", () => {
    const request = PlanGenerationRequestSchema.parse({
      intent: "study_now",
      learningIntent: "learn",
      goal: "Learn how supply and demand reach an equilibrium price.",
      startingContext: "I know the vocabulary but not the mechanism.",
      materialMode: "upload",
      materials: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Economics notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_024,
        textContent: "private extracted source text",
        processingStatus: "ready",
        understanding: null,
      }],
      studyMode: "inside",
      deadline: null,
      timeZone: "Europe/London",
      diagnosticResponses: [{
        question: "Where are you starting?",
        answer: "I know the terms",
        evaluation: "self_report",
      }],
      availability: [{ day: "Monday", window: "Now", minutes: 25 }],
      profileSummary: "Use a concise, example-first starting point.",
      methodChoice: { methodId: "self_explanation" },
    });

    const contract = normalizePlanDraftGenerationContract(request, {});

    expect(contract).toMatchObject({
      version: "plan_draft_generation_contract_v2",
      intent: "study_now",
      startingContext: "I know the vocabulary but not the mechanism.",
      knowledgeMap: null,
      mapCorrection: null,
      methodChoice: { methodId: "self_explanation" },
      materials: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Economics notes.pdf",
        sizeBytes: 1_024,
      }],
    });
    expect(contract.materials[0]).not.toHaveProperty("textContent");
    expect(contract.materials[0]).not.toHaveProperty("understanding");
    expect(contract.diagnosticResponses[0]).toMatchObject({
      questionId: null,
      topicId: null,
    });
  });
});

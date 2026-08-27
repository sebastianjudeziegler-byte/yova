import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

export const PLAN_DRAFT_GENERATION_CONTRACT_VERSION =
  "plan_draft_generation_contract_v2" as const;

/**
 * Produces the exact JSON-safe request projection authenticated by a server
 * draft receipt. Raw source text and derived material understanding stay out
 * of the receipt contract; the signed plan already owns the resulting map and
 * route decisions.
 */
export function normalizePlanDraftGenerationContract(
  request: PlanGenerationRequest,
  plan: Pick<LearningPlan, "knowledgeMap">,
) {
  return {
    version: PLAN_DRAFT_GENERATION_CONTRACT_VERSION,
    intent: request.intent,
    learningIntent: request.learningIntent,
    goal: request.goal,
    startingContext: request.startingContext ?? null,
    materialMode: request.materialMode,
    materials: request.materials.map((material) => ({
      id: material.id,
      name: material.name,
      mimeType: material.mimeType,
      sizeBytes: material.sizeBytes,
      processingStatus: material.processingStatus,
    })),
    studyMode: request.studyMode,
    deadline: request.deadline,
    timeZone: request.timeZone,
    diagnosticResponses: request.diagnosticResponses.map((response) => ({
      questionId: response.questionId ?? null,
      topicId: response.topicId ?? null,
      question: response.question,
      answer: response.answer,
      evaluation: response.evaluation,
    })),
    availability: request.availability.map((slot) => ({
      day: slot.day,
      window: slot.window,
      minutes: slot.minutes,
    })),
    profileSummary: request.profileSummary,
    methodChoice: request.methodChoice ?? null,
    knowledgeMap: plan.knowledgeMap ?? null,
    mapCorrection: request.mapCorrection ?? null,
  } as const;
}

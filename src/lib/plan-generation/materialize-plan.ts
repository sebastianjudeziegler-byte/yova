import { makeUuid, type LearningPlan } from "@/lib/domain";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

export function materializePlanDraft(
  untrustedDraft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): LearningPlan {
  const draft = GeneratedPlanDraftSchema.parse(untrustedDraft);
  const planId = makeUuid();

  return {
    id: planId,
    learningItemId: makeUuid(),
    title: draft.title,
    topic: draft.topic,
    kind: draft.kind,
    deadline: draft.deadline,
    status: "active",
    sourceMode: request.materialMode === "upload" ? "user_materials" : "yova_generated",
    studyMode: request.studyMode === "outside" ? "outside_yova" : "inside_yova",
    rationale: draft.rationale,
    createdAt: new Date().toISOString(),
    materials: request.materials.map((material) => ({
      ...material,
      textContent: null,
    })),
    sessions: draft.sessions.map((session, index) => ({
      id: makeUuid(),
      sequence: index + 1,
      ...session,
      status: index === 0 ? "ready" : "upcoming",
    })),
  };
}

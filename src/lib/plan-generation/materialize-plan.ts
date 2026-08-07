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
    deadline: request.intent === "study_now" ? null : request.deadline ?? draft.deadline,
    status: "draft",
    sourceMode: request.materialMode === "upload" ? "user_materials" : "yova_generated",
    studyMode: request.studyMode === "outside" ? "outside_yova" : "inside_yova",
    learningIntent: request.learningIntent,
    rationale: draft.rationale,
    createdAt: new Date().toISOString(),
    materials: request.materials.map((material) => ({
      ...material,
      textContent: null,
    })),
    sessions: (request.intent === "study_now" ? draft.sessions.slice(0, 1) : draft.sessions).map((session, index) => {
      const estimatedMinutes = request.intent === "study_now"
        ? Math.min(session.estimatedMinutes, request.availability[0]?.minutes ?? session.estimatedMinutes)
        : session.estimatedMinutes;

      return {
        id: makeUuid(),
        sequence: index + 1,
        ...session,
        scheduledFor: request.intent === "study_now" ? new Date().toISOString() : session.scheduledFor,
        estimatedMinutes,
        amountLabel: request.intent === "study_now" ? `Focused session · about ${estimatedMinutes} min` : session.amountLabel,
        learningMode: session.learningMode,
        contentTargets: session.contentTargets,
        completionEvidence: session.completionEvidence,
        status: index === 0 ? "ready" as const : "upcoming" as const,
      };
    }),
  };
}

import { makeUuid, type LearningPlan } from "@/lib/domain";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { teachingFirstSessionCopy } from "@/lib/learning/learning-intent";
import { deriveLearningTitle } from "@/lib/intake/interpret";

export function materializePlanDraft(
  untrustedDraft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): LearningPlan {
  const draft = GeneratedPlanDraftSchema.parse(untrustedDraft);
  const planId = makeUuid();
  const genericTitle = /^(personalized learning plan|learning plan|study plan|new learning goal)$/i.test(draft.title.trim());
  const title = genericTitle ? deriveLearningTitle(request.goal) : draft.title;
  const topic = /^(the goal and concepts described by the learner|learning topic|general topic)$/i.test(draft.topic.trim())
    ? request.goal.trim().slice(0, 300)
    : draft.topic;

  return {
    id: planId,
    learningItemId: makeUuid(),
    title,
    topic,
    kind: draft.kind,
    deadline: request.intent === "study_now" ? null : request.deadline ?? draft.deadline,
    status: "draft",
    sourceMode: request.materialMode === "upload" ? "user_materials" : "yova_generated",
    studyMode: request.studyMode === "outside" ? "outside_yova" : "inside_yova",
    learningIntent: request.learningIntent,
    creationIntent: request.intent,
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

      const learningMode = index === 0 ? request.learningIntent : session.learningMode;
      const repairedTeachingStart = learningMode === "learn" && session.learningMode !== "learn"
        ? teachingFirstSessionCopy(topic)
        : null;

      return {
        id: makeUuid(),
        sequence: index + 1,
        ...session,
        ...(repairedTeachingStart ?? {}),
        scheduledFor: request.intent === "study_now" ? new Date().toISOString() : session.scheduledFor,
        estimatedMinutes,
        amountLabel: request.intent === "study_now" ? `Focused session · about ${estimatedMinutes} min` : session.amountLabel,
        learningMode,
        contentTargets: session.contentTargets,
        completionEvidence: session.completionEvidence,
        status: index === 0 ? "ready" as const : "upcoming" as const,
      };
    }),
  };
}

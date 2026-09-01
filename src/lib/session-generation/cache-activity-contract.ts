import { validateMethodFidelity } from "@/lib/learning/method-fidelity";
import {
  validateScheduledRetrievalSession,
  type ScheduledRetrievalType,
} from "@/lib/learning/scheduled-retrieval";
import { validateAttachedMethodRuntimes } from "@/lib/session-generation/method-runtime";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { StudyMode } from "@/lib/domain";

type CachedSessionContractContext = {
  reviewType: ScheduledRetrievalType | null;
  reviewConcept: string | null;
  estimatedMinutes: number;
  executionEnvironment?: StudyMode;
};

/**
 * Schema parsing proves that a cached resource is structurally readable. This
 * second boundary proves that it still satisfies the current learner-facing
 * activity contract after an app upgrade. A stale cache is regenerated rather
 * than being grandfathered past a newly enforced generation invariant.
 */
export function cachedSessionActivityContractIssue(
  session: GeneratedSessionDraft,
  context: CachedSessionContractContext,
): string | null {
  if (context.reviewType) {
    return validateScheduledRetrievalSession(session, {
      learningMode: session.methodBriefing.learningMode,
      estimatedMinutes: context.estimatedMinutes,
      reviewConcept: context.reviewConcept,
      reviewType: context.reviewType,
    });
  }

  return validateStandardGuidedSessionActivityMix(session, {
    executionEnvironment: context.executionEnvironment,
  })
    ?? validateAttachedMethodRuntimes(
      session.methodBriefing.methodId,
      session.activities.map((activity) => activity.methodRuntime ?? null),
    )
    ?? validateMethodFidelity({
      methodId: session.methodBriefing.methodId,
      learningMode: session.methodBriefing.learningMode,
      activities: session.activities,
    });
}

export function validateStandardGuidedSessionActivityMix(
  draft: Pick<GeneratedSessionDraft, "activities" | "methodBriefing">,
  context: { executionEnvironment?: StudyMode } = {},
) {
  const hasRequiredTypedRecall = draft.activities.some((activity) => (
    activity.type === "free_response" && activity.requiredForCompletion
  ));
  if (!hasRequiredTypedRecall) {
    return "A full guided session needs at least one completion-required typed active-recall attempt. Only scheduled retrieval checks may be multiple-choice only.";
  }

  if (
    draft.methodBriefing.learningMode !== "learn"
    || draft.methodBriefing.taskType === "writing_argumentation"
    || context.executionEnvironment !== "inside_yova"
  ) {
    return null;
  }

  const finalTeachingIndex = draft.activities.findLastIndex((activity) => (
    activity.methodPhase === "model"
    && (
      Boolean(activity.teaching)
      || ("lessonBrief" in activity && Boolean(activity.lessonBrief))
    )
  ));
  const hasPostTeachingRecognitionCheck = finalTeachingIndex >= 0
    && draft.activities.some((activity, index) => (
      index > finalTeachingIndex
      && activity.type === "multiple_choice"
      && activity.requiredForCompletion
    ));

  return hasPostTeachingRecognitionCheck
    ? null
    : "A knowledge-focused Learn session needs at least one completion-required multiple-choice recall check after the final teaching block. A diagnostic check before teaching does not count.";
}

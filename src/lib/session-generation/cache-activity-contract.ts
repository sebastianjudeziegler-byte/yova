import { validateMethodFidelity } from "@/lib/learning/method-fidelity";
import {
  validateScheduledRetrievalSession,
  type ScheduledRetrievalType,
} from "@/lib/learning/scheduled-retrieval";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

type CachedSessionContractContext = {
  reviewType: ScheduledRetrievalType | null;
  reviewConcept: string | null;
  estimatedMinutes: number;
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

  return validateStandardGuidedSessionActivityMix(session)
    ?? validateMethodFidelity({
      methodId: session.methodBriefing.methodId,
      learningMode: session.methodBriefing.learningMode,
      activities: session.activities,
    });
}

export function validateStandardGuidedSessionActivityMix(
  draft: Pick<GeneratedSessionDraft, "activities">,
) {
  return draft.activities.some((activity) => (
    activity.type === "free_response" && activity.requiredForCompletion
  ))
    ? null
    : "A full guided session needs at least one completion-required typed active-recall attempt. Only scheduled retrieval checks may be multiple-choice only.";
}

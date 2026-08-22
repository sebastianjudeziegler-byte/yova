import type {
  LearningPlan,
  LearningPlanSession,
  SessionInterruption,
} from "@/lib/domain";
import {
  checkpointMatchesSessionResource,
  checkpointHandoffMatchesInterruption,
  checkpointToSessionResumePoint,
  chooseLatestSessionResumePoint,
  restoreExitProgressThroughCheckpoint,
  type ActiveSessionCheckpointResumePoint,
  type ActiveSessionCheckpointV1,
} from "@/lib/learning/active-session-checkpoint";
import { GENERIC_INSIDE_FALLBACK_METHOD_NAME } from "@/lib/learning/fallback-method-briefing";
import { canLoadBuiltInFallbackWithCompletion } from "@/lib/learning/unguided-verification";
import type { SessionAdjustment } from "@/lib/session-generation/schema";

export type SessionStartRecoveryDecision = {
  /** A checkpoint whose exact persisted work can be restored without AI. */
  resumePoint: ActiveSessionCheckpointResumePoint | null;
  /** True only when "Continue" is an honest description of the next action. */
  advertiseContinue: boolean;
  /** Allows the daily allowance guard to distinguish restore from new AI work. */
  canStartWithoutGeneration: boolean;
  /** The provider/reservation path is needed for this exact start request. */
  requiresGeneration: boolean;
  /** A persisted lesson can be opened from the beginning without new AI work. */
  cachedResourceRestorable: boolean;
};

function isActiveCheckpointResumePoint(
  value: SessionInterruption | ActiveSessionCheckpointResumePoint | null,
): value is ActiveSessionCheckpointResumePoint {
  return Boolean(value && "source" in value && value.source === "active_session_checkpoint");
}

function cachedResourceCanComplete(plan: LearningPlan, session: LearningPlanSession) {
  if (!session.resource) return false;
  const fallbackKind = session.resource.origin !== "built_in"
    ? null
    : session.resource.methodBriefing?.name === GENERIC_INSIDE_FALLBACK_METHOD_NAME
      ? "generic_inside" as const
      : plan.studyMode === "outside_yova"
        ? "outside_source" as const
        : "subject_specific" as const;

  return canLoadBuiltInFallbackWithCompletion({
    fallbackKind,
    session,
    planSessionCount: plan.sessions.length,
  });
}

/**
 * Decides whether a session start is a zero-AI restore or new generation.
 *
 * `restorableCheckpoints` must already have passed any plan-specific method
 * work validation. Resource-backed checkpoints are independently rechecked
 * here so labels, allowance handling, and launch use the same fail-closed rule.
 */
export function sessionStartRecoveryDecision({
  plan,
  session,
  interruptions,
  restorableCheckpoints,
  sessionAdjustment,
}: {
  plan: LearningPlan;
  session: LearningPlanSession;
  interruptions: readonly SessionInterruption[];
  restorableCheckpoints: readonly ActiveSessionCheckpointV1[];
  sessionAdjustment?: SessionAdjustment | null;
}): SessionStartRecoveryDecision {
  const selected = chooseLatestSessionResumePoint(
    session.id,
    [...interruptions],
    restorableCheckpoints,
  );
  const selectedCheckpoint = isActiveCheckpointResumePoint(selected)
    ? selected
    : selected
      ? restorableCheckpoints
        .map(checkpointToSessionResumePoint)
        .filter((checkpoint) => checkpointHandoffMatchesInterruption(checkpoint, selected))
        .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt))[0] ?? selected
      : null;
  const adjustmentKeepsPersistedContent = sessionAdjustment == null;
  const checkpointCanRestore = adjustmentKeepsPersistedContent
    && isActiveCheckpointResumePoint(selectedCheckpoint)
    && (
      (Boolean(selectedCheckpoint.methodWork) && selectedCheckpoint.resourceGeneratedAt === undefined)
      || Boolean(
        session.resource
        && checkpointMatchesSessionResource(selectedCheckpoint, session.resource),
      )
    );
  const resumePoint = checkpointCanRestore
    ? restoreExitProgressThroughCheckpoint(selectedCheckpoint, interruptions)
    : null;
  const cachedResourceRestorable = adjustmentKeepsPersistedContent
    && cachedResourceCanComplete(plan, session);

  return {
    resumePoint,
    advertiseContinue: Boolean(resumePoint),
    canStartWithoutGeneration: Boolean(resumePoint) || cachedResourceRestorable,
    requiresGeneration: !resumePoint && !cachedResourceRestorable,
    cachedResourceRestorable,
  };
}

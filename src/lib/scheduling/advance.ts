import type { LearningPlan, LearningPlanSession } from "@/lib/domain";

const EARLY_START_TOLERANCE_MINUTES = 5;

export type AdvancedScheduleUpdate = {
  planSessionId: string;
  previousScheduledFor: string;
  scheduledFor: string;
};

export function isSessionAheadOfSchedule(
  session: LearningPlanSession,
  now = new Date(),
  toleranceMinutes = EARLY_START_TOLERANCE_MINUTES,
) {
  const scheduledAt = new Date(session.scheduledFor).getTime();
  if (!Number.isFinite(scheduledAt)) return false;
  return scheduledAt > now.getTime() + Math.max(0, toleranceMinutes) * 60_000;
}

export function buildAdvancedSchedule(
  plan: LearningPlan,
  now = new Date(),
): AdvancedScheduleUpdate[] {
  const current = plan.sessions.find((session) => session.status === "ready");
  if (!current || !isSessionAheadOfSchedule(current, now)) return [];

  const currentScheduledAt = new Date(current.scheduledFor).getTime();
  const shiftMilliseconds = currentScheduledAt - now.getTime();

  return plan.sessions
    .filter((session) => (
      (session.status === "ready" || session.status === "upcoming")
      && session.sequence >= current.sequence
    ))
    .map((session) => {
      const scheduledAt = new Date(session.scheduledFor).getTime();
      const shiftedAt = Number.isFinite(scheduledAt)
        ? scheduledAt - shiftMilliseconds
        : now.getTime();
      return {
        planSessionId: session.id,
        previousScheduledFor: session.scheduledFor,
        scheduledFor: new Date(Math.max(now.getTime(), shiftedAt)).toISOString(),
      };
    });
}

export function applyAdvancedSchedule(
  plan: LearningPlan,
  updates: readonly Pick<AdvancedScheduleUpdate, "planSessionId" | "scheduledFor">[],
): LearningPlan {
  const bySessionId = new Map(updates.map((update) => [update.planSessionId, update.scheduledFor]));
  return {
    ...plan,
    sessions: plan.sessions.map((session) => {
      const scheduledFor = bySessionId.get(session.id);
      return scheduledFor ? { ...session, scheduledFor } : session;
    }),
  };
}

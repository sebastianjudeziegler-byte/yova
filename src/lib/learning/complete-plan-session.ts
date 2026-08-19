import type {
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
} from "@/lib/domain";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";

type CompletePlanSessionInput = {
  plan: LearningPlan;
  completedSessionId: string;
  completedAt: string;
  adaptation?: NextSessionAdaptation | null;
  followUpSession?: LearningPlanSession | null;
};

/**
 * Applies the learner-approved result of one completed session without
 * rewriting the curriculum that was already planned.
 */
export function completePlanSession({
  plan,
  completedSessionId,
  completedAt,
  adaptation = null,
  followUpSession = null,
}: CompletePlanSessionInput): LearningPlan {
  const completedSession = plan.sessions.find((session) => session.id === completedSessionId);
  if (!completedSession) return plan;

  const sessionsWithFollowUp = insertFollowUpOnce(plan.sessions, followUpSession);
  const nextSequence = completedSession.sequence + 1;
  const sessions = sessionsWithFollowUp.map((session) => {
    if (session.id === completedSession.id) {
      return { ...session, status: "complete" as const };
    }

    if (session.sequence !== nextSequence || !isPendingSession(session)) return session;

    if (adaptation?.planSessionId !== session.id) {
      return { ...session, status: "ready" as const };
    }

    return {
      ...session,
      title: adaptation.title,
      objective: adaptation.objective,
      method: adaptation.method,
      methodReason: adaptation.methodReason,
      estimatedMinutes: adaptation.estimatedMinutes,
      amountLabel: adaptation.amountLabel,
      learningMode: adaptation.learningMode,
      resource: undefined,
      adaptationNote: createSessionAdaptationNote(adaptation.explanation, completedAt),
      status: "ready" as const,
    };
  });
  const hasRemainingWork = sessions.some(isPendingSession);

  return {
    ...plan,
    status: hasRemainingWork ? "active" : "completed",
    sessions,
  };
}

function insertFollowUpOnce(
  sessions: LearningPlanSession[],
  followUpSession: LearningPlanSession | null,
) {
  if (!followUpSession) return sessions;
  if (sessions.some((session) => session.id === followUpSession.id)) return sessions;

  return [
    ...sessions.map((session) => session.sequence >= followUpSession.sequence
      ? { ...session, sequence: session.sequence + 1 }
      : session),
    followUpSession,
  ].sort((left, right) => left.sequence - right.sequence);
}

function isPendingSession(session: LearningPlanSession) {
  return session.status === "ready" || session.status === "upcoming";
}

import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  buildContentBasedReplacementSessions,
  learningPlanSessionToAdjustableRow,
  MAX_ADJUSTED_PLAN_SESSIONS,
  PlanAdjustmentPartLimitError,
} from "@/lib/learning/content-based-plan-adjustment";
import { isScheduledRetrievalSession } from "@/lib/learning/scheduled-retrieval";
import {
  buildGenericInsideYovaFallbackLesson,
  buildOutsideYovaFallbackLesson,
  builtInLessonFitsTime,
  genericInsideFallbackCoversTarget,
} from "@/lib/session-generation/built-in-fallback";

export function canOfferAgendaSessionSplit(input: {
  plan: LearningPlan;
  session: LearningPlanSession;
  targetMinutes: number;
  protectedSessionIds?: ReadonlySet<string>;
}) {
  const { plan, session, targetMinutes, protectedSessionIds = new Set<string>() } = input;
  if (plan.status !== "active") return false;
  if (plan.sourceMode !== "yova_generated") return false;
  const selectedSession = plan.sessions.find((candidate) => candidate.id === session.id);
  if (!selectedSession) return false;
  if (session.status !== "ready" && session.status !== "upcoming") return false;
  if (selectedSession.status !== "ready" && selectedSession.status !== "upcoming") return false;
  if (isScheduledRetrievalSession(session)) return false;
  if (session.resource || protectedSessionIds.has(session.id)) return false;
  if (session.estimatedMinutes !== selectedSession.estimatedMinutes) return false;
  if (!Number.isInteger(targetMinutes) || targetMinutes < 10) return false;
  if (targetMinutes >= selectedSession.estimatedMinutes) return false;

  const unfinishedSessions = plan.sessions.filter((candidate) => (
    candidate.status === "ready" || candidate.status === "upcoming"
  ));
  if (!unfinishedSessions.length) return false;
  if (unfinishedSessions.some(isScheduledRetrievalSession)) return false;
  if (unfinishedSessions.some((candidate) => (
    Boolean(candidate.resource) || protectedSessionIds.has(candidate.id)
  ))) return false;

  const settledSessions = plan.sessions.filter((candidate) => (
    candidate.status === "complete" || candidate.status === "skipped"
  ));
  const replacementCapacity = MAX_ADJUSTED_PLAN_SESSIONS - settledSessions.length;
  if (replacementCapacity <= 0) return false;

  let replacements: ReturnType<typeof buildContentBasedReplacementSessions>;
  try {
    replacements = buildContentBasedReplacementSessions(
      unfinishedSessions.map(learningPlanSessionToAdjustableRow),
      targetMinutes,
      Math.max(0, ...settledSessions.map((candidate) => candidate.sequence)) + 1,
      replacementCapacity,
    );
  } catch (error) {
    if (error instanceof PlanAdjustmentPartLimitError) return false;
    throw error;
  }

  if (!replacements.length) return false;
  if (replacements.some((candidate) => candidate.estimatedMinutes < 10)) return false;

  return replacements.every((candidate) => {
    if (plan.studyMode === "outside_yova") {
      const fallback = buildOutsideYovaFallbackLesson({
        topic: plan.topic,
        objective: candidate.objective,
        method: candidate.method,
        methodReason: candidate.methodReason,
        learningMode: candidate.learningMode,
        availableMinutes: candidate.estimatedMinutes,
      });
      return Boolean(
        fallback
        && builtInLessonFitsTime(fallback.activities, candidate.estimatedMinutes),
      );
    }

    // Subject-specific inside lessons remain preferable at runtime. The generic
    // lesson is the topic-independent safety floor that lets this gate prove
    // every projected part remains runnable before offering the rewrite.
    const fallback = buildGenericInsideYovaFallbackLesson({
      objective: candidate.objective,
      contentTargets: candidate.contentTargets ?? [],
      completionEvidence: candidate.completionEvidence ?? [],
      learningMode: candidate.learningMode,
      availableMinutes: candidate.estimatedMinutes,
    });

    return Boolean(
      fallback
      && builtInLessonFitsTime(fallback.activities, candidate.estimatedMinutes)
      && (candidate.contentTargets ?? []).every((target) => (
        genericInsideFallbackCoversTarget(fallback, target)
      )),
    );
  });
}

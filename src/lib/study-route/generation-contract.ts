import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { StudyRoute } from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

/**
 * Checks the route-owned semantics that a generated resource can prove
 * deterministically. Prose may vary; method, mode, targets, and phase order
 * may not vary under one immutable revision.
 */
export function generatedSessionStudyRouteIssue(
  session: GeneratedSessionDraft,
  route: StudyRoute | null | undefined,
): string | null {
  if (!route) return null;
  const expectedLearningMode = route.approach.mode === "learn" ? "learn" : "study";
  if (session.methodBriefing.learningMode !== expectedLearningMode) {
    return "The generated learning mode does not match the committed StudyRoute.";
  }
  if (session.methodBriefing.methodId !== route.approach.primaryMethodId) {
    return "The generated method does not match the committed StudyRoute.";
  }
  if (session.methodBriefing.name !== route.approach.visibleMethodName) {
    return "The generated method name does not match the committed StudyRoute.";
  }

  const expectedTargetIds = activeStudyRouteTargetIds(route);
  if (
    session.topicIds.length !== expectedTargetIds.length
    || session.topicIds.some((targetId, index) => targetId !== expectedTargetIds[index])
  ) {
    return "The generated targets do not match the committed StudyRoute.";
  }

  const expectedPhases = route.execution.orderedPhases.map((phase) => phase.methodPhase);
  const actualPhases = session.activities.map((activity) => activity.methodPhase);
  let matched = 0;
  for (const phase of actualPhases) {
    if (phase === expectedPhases[matched]) matched += 1;
  }
  if (matched !== expectedPhases.length) {
    return "The generated phase order does not match the committed StudyRoute.";
  }

  return null;
}

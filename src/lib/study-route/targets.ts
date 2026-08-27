import type { StudyRoute } from "@/lib/study-route/schema";

/**
 * A route may retain state for targets that no longer fit this session, but
 * only non-deferred targets belong to the executable recipe and its legacy
 * session projection.
 */
export function activeStudyRouteTargetStates(route: StudyRoute) {
  const deferredIds = new Set(
    route.execution.deferredTargets.map((target) => target.targetId),
  );
  return route.target.targetStates.filter((target) => !deferredIds.has(target.targetId));
}

export function activeStudyRouteTargetIds(route: StudyRoute) {
  return activeStudyRouteTargetStates(route).map((target) => target.targetId);
}

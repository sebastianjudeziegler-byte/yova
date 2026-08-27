import type { LearningPlan } from "@/lib/domain";
import { commitStudyRouteRevision } from "@/lib/study-route/revisions";
import { StudyRouteSchema } from "@/lib/study-route/schema";

/**
 * Commits the exact provisional revisions reviewed in the draft. Route IDs do
 * not change during activation, so retries and lost-response recovery can
 * compare the same decision identity.
 */
export function commitPlanStudyRoutes<TPlan extends LearningPlan>(
  plan: TPlan,
  committedAt: string,
): TPlan {
  return {
    ...plan,
    sessions: plan.sessions.map((session) => {
      const route = session.studyRoute;
      if (!route || route.identity.lifecycleStatus !== "provisional") return session;
      const safeCommittedAt = new Date(Math.max(
        Date.parse(committedAt),
        Date.parse(route.identity.createdAt),
      )).toISOString();
      const committed = commitStudyRouteRevision(route, safeCommittedAt);
      return {
        ...session,
        // Parse returns the normal mutable domain type while preserving the
        // deep-frozen revision helper as the mutation boundary itself.
        studyRoute: StudyRouteSchema.parse(committed),
      };
    }),
} as TPlan;
}

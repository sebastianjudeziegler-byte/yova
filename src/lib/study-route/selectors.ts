import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { adaptLegacySessionToStudyRoute, adaptSessionResourceToStudyRoute } from "@/lib/study-route/adapters";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

export type StudyRouteResolution = {
  route: StudyRoute | null;
  source: "stored" | "executed_resource" | "legacy_plan" | "legacy_scalar";
};

/**
 * Resolves the planned learner-facing promise. A canonical stored route wins;
 * otherwise the pure adapter supplies a parity-preserving legacy snapshot.
 */
export function resolvePlannedStudyRoute(
  plan: LearningPlan,
  session: LearningPlanSession,
): StudyRouteResolution {
  const stored = storedStudyRoute(session);
  if (stored) return { route: stored, source: "stored" };
  const legacy = adaptLegacySessionToStudyRoute({ plan, session }).route;
  return legacy
    ? { route: legacy, source: "legacy_plan" }
    : { route: null, source: "legacy_scalar" };
}

/**
 * Resolves the route actually executed. Old validated resources take
 * precedence only when no canonical route was stored; this prevents generated
 * output from silently rewriting a committed route.
 */
export function resolveExecutedStudyRoute(
  plan: LearningPlan,
  session: LearningPlanSession,
): StudyRouteResolution {
  const stored = storedStudyRoute(session);
  if (stored) return { route: stored, source: "stored" };
  if (session.resource) {
    const executed = adaptSessionResourceToStudyRoute({ plan, session }).route;
    if (executed) return { route: executed, source: "executed_resource" };
  }
  return resolvePlannedStudyRoute(plan, session);
}

export function selectSessionMethodName(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  return resolvePlannedStudyRoute(plan, session).route?.approach.visibleMethodName
    ?? session.method;
}

export function selectSessionMethodReason(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  return resolvePlannedStudyRoute(plan, session).route?.explanation.shortReason
    ?? session.methodReason;
}

export function selectSessionActiveMinutes(
  plan: LearningPlan,
  session: LearningPlanSession,
) {
  return resolvePlannedStudyRoute(plan, session).route?.timing.activeMinutes
    ?? session.estimatedMinutes;
}

export function selectSessionLearningMode(
  plan: LearningPlan,
  session: LearningPlanSession,
): LearningPlanSession["learningMode"] {
  const mode = resolvePlannedStudyRoute(plan, session).route?.approach.mode;
  return mode ? (mode === "learn" ? "learn" : "study") : session.learningMode;
}

export function selectSessionExecutionEnvironment(
  plan: LearningPlan,
  session: LearningPlanSession,
): LearningPlan["studyMode"] {
  return resolvePlannedStudyRoute(plan, session).route?.approach.executionEnvironment
    ?? plan.studyMode;
}

/**
 * Projects the canonical route back into the current legacy plan/session
 * contract at integration boundaries. This keeps existing generators and UI
 * components behavior-compatible while giving them one route authority.
 */
export function resolveStudyRouteSessionContract(
  plan: LearningPlan,
  session: LearningPlanSession,
): { plan: LearningPlan; session: LearningPlanSession; resolution: StudyRouteResolution } {
  const resolution = resolvePlannedStudyRoute(plan, session);
  const route = resolution.route;
  if (!route) return { plan, session, resolution };
  const projectedSession: LearningPlanSession = {
    ...session,
    method: route.approach.visibleMethodName,
    methodReason: route.explanation.shortReason,
    estimatedMinutes: route.timing.activeMinutes,
    learningMode: route.approach.mode === "learn" ? "learn" : "study",
    topicIds: activeStudyRouteTargetIds(route),
    completionEvidence: route.execution.completionEvidence.map((evidence) => evidence.description),
  };
  const executionEnvironment = route.approach.executionEnvironment;
  return {
    plan: plan.studyMode === executionEnvironment ? plan : { ...plan, studyMode: executionEnvironment },
    session: projectedSession,
    resolution,
  };
}

function storedStudyRoute(session: LearningPlanSession) {
  const candidate = (session as LearningPlanSession & { studyRoute?: unknown }).studyRoute;
  const parsed = StudyRouteSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

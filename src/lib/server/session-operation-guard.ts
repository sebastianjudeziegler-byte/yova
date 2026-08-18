import "server-only";
import type { PlanStatus, SessionStatus } from "@/lib/domain";
import { isOperationalPlanStatus } from "@/lib/learning/plan-visibility";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type SessionOperationFailureReason =
  | "not_found"
  | "inactive_plan"
  | "session_not_ready"
  | "verification_failed";

export type SessionOperationAccess =
  | { allowed: true }
  | { allowed: false; reason: SessionOperationFailureReason };

export const READY_SESSION_STATUSES = ["ready"] as const;
export const SCHEDULABLE_SESSION_STATUSES = ["ready", "upcoming"] as const;

export async function verifyOperationalPlanSession(
  supabase: SupabaseServerClient,
  {
    planId,
    planSessionId,
    allowedSessionStatuses = READY_SESSION_STATUSES,
  }: {
    planId?: string;
    planSessionId: string;
    allowedSessionStatuses?: readonly SessionStatus[];
  },
): Promise<SessionOperationAccess> {
  const sessionResult = await supabase
    .from("plan_sessions")
    .select("id,plan_id,status")
    .eq("id", planSessionId)
    .maybeSingle();
  if (sessionResult.error) {
    return { allowed: false, reason: "verification_failed" };
  }
  if (!sessionResult.data || (planId && sessionResult.data.plan_id !== planId)) {
    return { allowed: false, reason: "not_found" };
  }

  const requestedPlanId = planId ?? sessionResult.data.plan_id;
  const planResult = await supabase
    .from("plans")
    .select("id,status")
    .eq("id", requestedPlanId)
    .maybeSingle();
  if (planResult.error) {
    return { allowed: false, reason: "verification_failed" };
  }
  if (!planResult.data) return { allowed: false, reason: "not_found" };

  return classifyOperationalPlanSession({
    requestedPlanId,
    sessionPlanId: sessionResult.data.plan_id,
    planStatus: planResult.data.status,
    sessionStatus: sessionResult.data.status,
    allowedSessionStatuses,
  });
}

export function classifyOperationalPlanSession({
  requestedPlanId,
  sessionPlanId,
  planStatus,
  sessionStatus,
  allowedSessionStatuses = READY_SESSION_STATUSES,
}: {
  requestedPlanId: string;
  sessionPlanId: string;
  planStatus: PlanStatus | string | null | undefined;
  sessionStatus: SessionStatus | string | null | undefined;
  allowedSessionStatuses?: readonly SessionStatus[];
}): SessionOperationAccess {
  if (!requestedPlanId || sessionPlanId !== requestedPlanId) {
    return { allowed: false, reason: "not_found" };
  }
  if (!isOperationalPlanStatus(planStatus)) {
    return { allowed: false, reason: "inactive_plan" };
  }
  if (!allowedSessionStatuses.some((status) => status === sessionStatus)) {
    return { allowed: false, reason: "session_not_ready" };
  }
  return { allowed: true };
}

export function sessionOperationFailure(
  access: Exclude<SessionOperationAccess, { allowed: true }>,
) {
  if (access.reason === "not_found") {
    return { status: 404, error: "That learning session was not found." } as const;
  }
  if (access.reason === "inactive_plan") {
    return {
      status: 409,
      error: "This learning session is no longer available because its plan is not active.",
    } as const;
  }
  if (access.reason === "session_not_ready") {
    return {
      status: 409,
      error: "Only an unfinished session in the active plan can be used.",
    } as const;
  }
  return {
    status: 500,
    error: "YOVA could not verify this learning session.",
  } as const;
}

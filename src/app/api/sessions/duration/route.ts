import { NextResponse } from "next/server";
import {
  SessionDurationAdjustmentRequestSchema,
  SessionDurationAdjustmentResponseSchema,
} from "@/lib/scheduling/session-adjustment-schema";
import {
  SCHEDULABLE_SESSION_STATUSES,
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before changing a session." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The session adjustment was not valid JSON." }, { status: 400 });
  }

  const parsed = SessionDurationAdjustmentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Choose a session length between 10 and 90 minutes.",
      fields: parsed.error.flatten().fieldErrors,
    }, { status: 422 });
  }

  const operationAccess = await verifyOperationalPlanSession(supabase, {
    ...parsed.data,
    allowedSessionStatuses: SCHEDULABLE_SESSION_STATUSES,
  });
  if (!operationAccess.allowed) {
    const failure = sessionOperationFailure(operationAccess);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  const { data: routeBoundSession, error: routeBindingError } = await supabase
    .from("plan_sessions")
    .select("committed_route_revision_id")
    .eq("id", parsed.data.planSessionId)
    .maybeSingle();
  if (routeBindingError || !routeBoundSession) {
    return NextResponse.json({ error: "YOVA could not verify that session's study route." }, { status: 409 });
  }
  if (typeof routeBoundSession.committed_route_revision_id === "string") {
    return NextResponse.json({
      code: "session_duration_route_revision_required",
      error: "Change this routed session from the plan adjustment screen so YOVA can revise its method and duration together.",
    }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("adjust_plan_session_duration", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not change that session." }, { status: 409 });
  }

  const response = SessionDurationAdjustmentResponseSchema.safeParse({
    ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA changed the session but could not confirm the result." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

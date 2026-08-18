import { NextResponse } from "next/server";
import {
  RescheduleSessionRequestSchema,
  RescheduleSessionResponseSchema,
} from "@/lib/scheduling/schema";
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
    return NextResponse.json({ error: "Sign in before changing your agenda." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The schedule change was not valid JSON." }, { status: 400 });
  }

  const parsed = RescheduleSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Choose a valid upcoming date and time.",
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

  const { data, error } = await supabase.rpc("reschedule_plan_session", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not move that session." }, { status: 409 });
  }

  const response = RescheduleSessionResponseSchema.safeParse({
    planSessionId: readTextProperty(data, "planSessionId"),
    scheduledFor: readTextProperty(data, "scheduledFor"),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA moved the session but could not confirm the new time." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

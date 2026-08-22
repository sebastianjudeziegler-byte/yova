import { NextResponse } from "next/server";
import {
  ReschedulePlanSessionsRequestSchema,
  ReschedulePlanSessionsResponseSchema,
  RescheduleSessionRequestSchema,
  RescheduleSessionResponseSchema,
} from "@/lib/scheduling/schema";
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

  if (isBatchRequest(body)) {
    const parsed = ReschedulePlanSessionsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "Choose valid upcoming dates and times for this plan.",
        fields: parsed.error.flatten().fieldErrors,
      }, { status: 422 });
    }

    const { data, error } = await supabase.rpc("reschedule_plan_sessions", {
      payload: parsed.data,
    });
    if (error || !data) {
      return NextResponse.json({ error: schedulingFailure(error) }, { status: 409 });
    }

    const response = ReschedulePlanSessionsResponseSchema.safeParse({
      ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
      persistence: "supabase",
    });
    const authoritativeIds = response.success
      ? new Set(response.data.sessions.map((session) => session.planSessionId))
      : null;
    if (
      !response.success
      || response.data.planId !== parsed.data.planId
      || parsed.data.updates.some((update) => !authoritativeIds?.has(update.planSessionId))
    ) {
      return NextResponse.json({
        error: "YOVA moved the agenda but could not confirm every new time. Reload before making another change.",
        code: "schedule_committed_response_invalid",
        committed: true,
      }, { status: 500 });
    }

    return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
  }

  // Compatibility for a browser tab opened before the batch client shipped.
  // The database wrapper routes this shape through the same transactional core.
  const parsed = RescheduleSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Choose a valid upcoming date and time.",
      fields: parsed.error.flatten().fieldErrors,
    }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("reschedule_plan_session", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: schedulingFailure(error) }, { status: 409 });
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

function isBatchRequest(value: unknown) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && ("planId" in value || "updates" in value),
  );
}

function schedulingFailure(error: unknown) {
  const message = readTextProperty(error, "message");
  if (message.includes("schedule_plan_inactive")) {
    return "This learning session is no longer available because its plan is not active.";
  }
  if (message.includes("schedule_sequence_conflict")) {
    return "Choose a time after the previous session and before the next session.";
  }
  if (message.includes("schedule_deadline_conflict")) {
    return "Choose a time on or before this goal’s deadline.";
  }
  if (message.includes("schedule_session_unavailable") || message.includes("schedule_plan_not_found")) {
    return "This learning schedule changed elsewhere. Reload before moving it again.";
  }
  if (message.includes("schedule_time_out_of_range")) {
    return "Choose a time between now and one year from now.";
  }
  if (message.includes("schedule_time_in_past")) {
    return "Choose a future date and time.";
  }
  if (message.includes("schedule_unchanged")) {
    return "Choose a different date or time before saving.";
  }
  if (message.includes("schedule_unfinished_set_invalid")) {
    return "This plan’s unfinished schedule needs repair before it can be moved.";
  }
  return "YOVA could not move that learning schedule.";
}

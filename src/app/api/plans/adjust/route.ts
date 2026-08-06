import { NextResponse } from "next/server";
import {
  PlanAdjustmentRequestSchema,
  PlanAdjustmentResponseSchema,
} from "@/lib/learning/adjustment-schema";
import {
  buildContentBasedReplacementSessions,
  type AdjustableSessionRow,
} from "@/lib/learning/content-based-plan-adjustment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before adjusting a plan." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The plan adjustment was not valid JSON." }, { status: 400 });
  }

  const parsed = PlanAdjustmentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Review the deadline, study mode, and session length.",
      fields: parsed.error.flatten().fieldErrors,
    }, { status: 422 });
  }

  const { data: sessionRows, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data")
    .eq("plan_id", parsed.data.planId)
    .eq("user_id", user.id)
    .order("sequence", { ascending: true });
  if (sessionError || !sessionRows) {
    return NextResponse.json({ error: "YOVA could not load the unfinished content in that plan." }, { status: 409 });
  }
  const settledSequences = sessionRows
    .filter((session) => session.status === "complete" || session.status === "skipped")
    .map((session) => session.sequence);
  const unfinished = sessionRows.filter((session) => session.status === "ready" || session.status === "upcoming") as AdjustableSessionRow[];
  const replacementSessions = buildContentBasedReplacementSessions(
    unfinished,
    parsed.data.futureSessionMinutes,
    Math.max(0, ...settledSequences) + 1,
  );
  if (!replacementSessions.length) {
    return NextResponse.json({ error: "This plan has no unfinished content to adjust." }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("adjust_learning_plan", {
    payload: { ...parsed.data, sessions: replacementSessions },
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not adjust that plan." }, { status: 409 });
  }

  const response = PlanAdjustmentResponseSchema.safeParse({
    ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA updated the plan but could not confirm every change." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

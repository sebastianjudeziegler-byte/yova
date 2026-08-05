import { NextResponse } from "next/server";
import {
  PlanAdjustmentRequestSchema,
  PlanAdjustmentResponseSchema,
} from "@/lib/learning/adjustment-schema";
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

  const { data, error } = await supabase.rpc("adjust_learning_plan", {
    payload: parsed.data,
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

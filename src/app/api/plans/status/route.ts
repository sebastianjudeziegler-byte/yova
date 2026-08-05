import { NextResponse } from "next/server";
import {
  PlanArchiveRequestSchema,
  PlanArchiveResponseSchema,
} from "@/lib/learning/status-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before changing a learning goal." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The learning-goal change was not valid JSON." }, { status: 400 });
  }

  const parsed = PlanArchiveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid learning goal and action." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("set_learning_plan_archive_state", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not update that learning goal." }, { status: 409 });
  }

  const response = PlanArchiveResponseSchema.safeParse({
    planId: readTextProperty(data, "planId"),
    status: readTextProperty(data, "status"),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA updated the goal but could not confirm its new state." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

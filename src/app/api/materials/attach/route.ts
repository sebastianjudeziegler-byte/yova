import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
/** Files are staged by intake, then attached to a selected topic through the
 * signed plan revision. This legacy whole-plan writer can no longer mutate. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Sign in before attaching learning materials." }, { status: 401 });
  return NextResponse.json({ code: "plan_revision_preview_required",
    error: "Choose a topic using Add file or link on the plan, then confirm the source preview. Your plan is unchanged.",
  }, { status: 409 });
}

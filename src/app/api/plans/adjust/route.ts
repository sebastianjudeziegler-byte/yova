import { NextResponse } from "next/server";
import { resolveRequestNow } from "@/lib/server/test-clock";
import { undoPlanRevision } from "@/lib/plan-revision/undo-service";
import { applyPlanRevision } from "@/lib/plan-revision/apply-service";
import { RevisionConflict } from "@/lib/plan-revision/revision-patch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PlanRevisionPreviewRequestSchema, PlanRevisionApplyRequestSchema, PlanRevisionUndoRequestSchema } from "@/lib/plan-revision/revision-schema";
import { previewPlanRevision, PlanRevisionRequestError } from "@/lib/plan-revision/preview-service";
import { MapDeltaError } from "@/lib/plan-revision/map-delta";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function PATCH(request: Request) {
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
  if (!developmentPreview && (userError || !user)) {
    return NextResponse.json({ error: "Sign in before adjusting a plan." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The plan adjustment was not valid JSON." }, { status: 400 });
  }

  if (body && typeof body === "object" && "action" in body) {
    const revision = body.action === "undo" ? PlanRevisionUndoRequestSchema.safeParse(body) : body.action === "apply" ? PlanRevisionApplyRequestSchema.safeParse(body) : PlanRevisionPreviewRequestSchema.safeParse(body);
    if (!revision.success) return NextResponse.json({ error: "Review the topic changes and preview controls." }, { status: 422 });
    try {
      const dependencies = { supabase, userId: user?.id ?? null, developmentPreview, now: new Date(resolveRequestNow(request)) };
      const result = revision.data.action === "undo"
        ? await undoPlanRevision({ input: revision.data, ...dependencies })
        : revision.data.action === "apply"
        ? await applyPlanRevision({ input: revision.data, ...dependencies })
        : await previewPlanRevision({ input: revision.data, ...dependencies });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof RevisionConflict) return NextResponse.json({ error: error.message }, { status: 409 });
      if (error instanceof MapDeltaError || error instanceof PlanRevisionRequestError) return NextResponse.json({ error: error.message }, { status: error instanceof PlanRevisionRequestError ? error.status : 422 });
      console.error("Structured plan revision preview failed", error);
      return NextResponse.json({ error: "YOVA could not prepare that change. Your plan has not changed." }, { status: 503 });
    }
  }
  // Legacy callers cannot bypass a signed, editable preview. Free-text topic
  // direction stays rejected, including the Sept 7 photosynthesis guard.
  const direction = body && typeof body === "object" && "direction" in body ? body.direction : null;
  return NextResponse.json({
    code: typeof direction === "string" && direction.trim() ? "plan_direction_unverified" : "plan_revision_preview_required",
    error: "Your plan is unchanged. Open Adjust, choose a topic or schedule change, and confirm its preview.",
  }, { status: 409 });
}

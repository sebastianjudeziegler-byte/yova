import { NextResponse } from "next/server";
import {
  PlanActivationRequestSchema,
  PlanActivationResponseSchema,
} from "@/lib/plan-generation/schema";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  persistPlanForAuthenticatedUser,
  PlanPersistenceError,
} from "@/lib/supabase/plan-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };

  if (!developmentPreview && supabase && (userError || !user)) {
    return NextResponse.json(
      { error: "Sign in before activating a learning plan." },
      { status: 401, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The activation request was not valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  const parsed = PlanActivationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "This plan draft no longer matches its setup. Rebuild the draft before activating it." },
      { status: 422, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  const activePlan = { ...parsed.data.plan, status: "active" as const };
  // Both possible receipts are validated before the persistence RPC. A future
  // response-contract change therefore cannot commit a plan and then fall into
  // the catch branch that says nothing was activated.
  const responseByPersistence = {
    browser: PlanActivationResponseSchema.parse({
      plan: activePlan,
      activation: { persistence: "browser", requestId },
    }),
    supabase: PlanActivationResponseSchema.parse({
      plan: activePlan,
      activation: { persistence: "supabase", requestId },
    }),
  } as const;

  try {
    const persistence = developmentPreview
      ? "browser" as const
      : await persistPlanForAuthenticatedUser(activePlan, parsed.data.generationRequest);

    return NextResponse.json(responseByPersistence[persistence], {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  } catch (error) {
    console.error("YOVA plan activation failed", { requestId });
    const message = error instanceof PlanPersistenceError
      ? "YOVA could not save this plan safely. Nothing was activated; try again in a moment."
      : "YOVA could not activate this plan. Nothing was changed; try again in a moment.";
    return NextResponse.json(
      { error: message, code: "activation_failed", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
}

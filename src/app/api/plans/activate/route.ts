import { NextResponse } from "next/server";
import {
  PlanActivationRequestSchema,
  PlanActivationResponseSchema,
} from "@/lib/plan-generation/schema";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { verifyPlanDraftReceipt } from "@/lib/server/plan-draft-receipt";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  persistPlanForAuthenticatedUser,
  PlanPersistenceError,
} from "@/lib/supabase/plan-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";

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
  if (!developmentPreview && (!supabase || !user)) {
    return NextResponse.json({
      error: "YOVA cannot verify plan activation right now. Try again after the server connection is restored.",
      code: "draft_receipt_unavailable",
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
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

  let verifiedReceiptIssuedAt: string | null = null;
  if (!developmentPreview) {
    if (!parsed.data.draftReceipt) {
      return draftReceiptRejectedResponse("required", requestId);
    }
    const verification = verifyPlanDraftReceipt({
      receipt: parsed.data.draftReceipt,
      parsedPlan: parsed.data.plan,
      normalizedGenerationContract: normalizePlanDraftGenerationContract(
        parsed.data.generationRequest,
        parsed.data.plan,
      ),
      authenticatedUserId: user!.id,
    });
    if (!verification.ok) {
      if (verification.reason === "configuration_error") {
        return NextResponse.json({
          error: "YOVA cannot verify this plan draft right now. Try again after the server connection is restored.",
          code: "draft_receipt_unavailable",
        }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        });
      }
      return draftReceiptRejectedResponse(
        verification.reason === "expired" ? "expired" : "invalid",
        requestId,
      );
    }
    verifiedReceiptIssuedAt = verification.metadata.issuedAt;
  }

  const activePlan = commitPlanStudyRoutes(
    { ...parsed.data.plan, status: "active" as const },
    verifiedReceiptIssuedAt ?? new Date().toISOString(),
  );
  // Both possible response shapes are validated before the persistence RPC.
  // A future response-contract change therefore cannot commit a plan and then
  // fall into the catch branch that says nothing was activated.
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
      : await persistPlanForAuthenticatedUser(
          activePlan,
          parsed.data.generationRequest,
          verifiedReceiptIssuedAt!,
        );

    return NextResponse.json(responseByPersistence[persistence], {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  } catch (error) {
    console.error("YOVA plan activation failed", { requestId });
    if (error instanceof PlanPersistenceError && error.code === "material_staging_expired") {
      return NextResponse.json(
        {
          error: "A pending source expired before this plan could be activated. Add that source again and rebuild the draft.",
          code: "material_staging_expired",
          requestId,
        },
        { status: 410, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
      );
    }
    const message = error instanceof PlanPersistenceError
      ? "YOVA could not confirm this plan activation. Try again in a moment; the exact request is safe to replay."
      : "YOVA could not activate this plan. Nothing was changed; try again in a moment.";
    return NextResponse.json(
      { error: message, code: "activation_failed", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
}

function draftReceiptRejectedResponse(
  reason: "required" | "expired" | "invalid",
  requestId: string,
) {
  const message = reason === "expired"
    ? "This plan draft expired before it was activated. Rebuild it to use the latest routing decisions."
    : reason === "required"
      ? "This older plan draft cannot be verified. Rebuild it before activating it."
      : "This plan draft no longer matches the version YOVA generated. Rebuild it before activating it.";
  return NextResponse.json({
    error: message,
    code: `draft_receipt_${reason}`,
  }, {
    status: 422,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

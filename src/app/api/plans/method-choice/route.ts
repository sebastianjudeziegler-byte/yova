import { NextResponse } from "next/server";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import {
  PlanActivationRequestSchema,
  PlanDraftMethodChoiceResponseSchema,
  PlanDraftMethodChoiceSelectionSchema,
} from "@/lib/plan-generation/schema";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import {
  issuePlanDraftReceipt,
  PlanDraftReceiptConfigurationError,
  verifyPlanDraftReceipt,
  type PlanDraftReceiptMetadata,
} from "@/lib/server/plan-draft-receipt";
import {
  DraftMethodChoiceError,
  reviseDraftSessionMethod,
} from "@/lib/study-route/draft-method-choice";
import {
  resolveBoundedOtherMethodRequest,
  type AgencyMethodRequestResolution,
} from "@/lib/study-route/agency-mode-controller";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Deterministically revises one still-provisional method recipe. This route
 * never calls the planning model: it verifies the exact current draft,
 * accepts an exact stored alternative or an I'll Customize method from that
 * route's immutable eligible cohort, and authenticates the whole replacement
 * draft before returning it to the browser.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };

  if (!developmentPreview && supabase && (userError || !user)) {
    return json(
      { error: "Sign in before changing a plan method." },
      401,
      requestId,
    );
  }
  if (!developmentPreview && (!supabase || !user)) {
    return unavailable(requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: "The method-change request was not valid JSON." },
      400,
      requestId,
    );
  }

  const draft = PlanActivationRequestSchema.safeParse(body);
  const selection = PlanDraftMethodChoiceSelectionSchema.safeParse(
    objectField(body, "selection"),
  );
  if (!draft.success || !selection.success) {
    return json({
      error: "This plan draft no longer matches the method choice shown. Review the latest draft and try again.",
      code: "draft_method_choice_invalid",
    }, 422, requestId);
  }

  const normalizedGenerationContract = normalizePlanDraftGenerationContract(
    draft.data.generationRequest,
    draft.data.plan,
  );
  let verifiedReceipt: PlanDraftReceiptMetadata | null = null;

  if (!developmentPreview) {
    if (!draft.data.draftReceipt) {
      return receiptRejected("required", requestId);
    }
    const verification = verifyPlanDraftReceipt({
      receipt: draft.data.draftReceipt,
      parsedPlan: draft.data.plan,
      normalizedGenerationContract,
      authenticatedUserId: user!.id,
    });
    if (!verification.ok) {
      if (verification.reason === "configuration_error") return unavailable(requestId);
      return receiptRejected(
        verification.reason === "expired" ? "expired" : "invalid",
        requestId,
      );
    }
    verifiedReceipt = verification.metadata;
  }

  try {
    let methodRequestResolution: AgencyMethodRequestResolution | null = null;
    let methodId = selection.data.methodId;
    if (selection.data.choiceScope === "other_eligible_method") {
      const selectedSession = draft.data.plan.sessions.find((session) => (
        session.id === selection.data.sessionId
      ));
      if (!selectedSession?.studyRoute) {
        throw new DraftMethodChoiceError(
          "route_required",
          "Other methods requires the exact provisional StudyRoute.",
        );
      }
      try {
        methodRequestResolution = resolveBoundedOtherMethodRequest({
          route: selectedSession.studyRoute,
          requestedMethod: selection.data.requestedMethod!,
        });
      } catch {
        throw new DraftMethodChoiceError(
          "method_not_offered",
          "The requested Other method could not be mapped inside this route's eligible set.",
        );
      }
      methodId = methodRequestResolution.selectedMethodId;
    }
    if (!methodId) {
      throw new DraftMethodChoiceError(
        "method_not_offered",
        "A draft method choice requires one authorized method.",
      );
    }
    const revision = reviseDraftSessionMethod({
      plan: draft.data.plan,
      selection: {
        sessionId: selection.data.sessionId,
        expectedRouteRevisionId: selection.data.expectedRouteRevisionId,
        methodId,
        choiceScope: selection.data.choiceScope ?? "stored_alternative",
      },
      changedAt: new Date().toISOString(),
    });

    let draftReceipt = draft.data.draftReceipt;
    if (revision.status === "updated") {
      if (developmentPreview) {
        draftReceipt = null;
      } else {
        const issued = issuePlanDraftReceipt({
          parsedPlan: revision.plan,
          normalizedGenerationContract: normalizePlanDraftGenerationContract(
            draft.data.generationRequest,
            revision.plan,
          ),
          authenticatedUserId: user!.id,
          // A method toggle cannot keep an otherwise stale plan alive. The
          // replacement receipt retains the original validity window.
          issuedAt: verifiedReceipt!.issuedAt,
          expiresAt: verifiedReceipt!.expiresAt,
        });
        draftReceipt = issued.receipt;
      }
    }

    const response = PlanDraftMethodChoiceResponseSchema.parse({
      plan: revision.plan,
      draftReceipt: draftReceipt ?? null,
      revision: { status: revision.status, requestId },
      ...(methodRequestResolution ? { methodRequestResolution } : {}),
    });
    return NextResponse.json(response, {
      headers: responseHeaders(requestId),
    });
  } catch (error) {
    if (error instanceof DraftMethodChoiceError) {
      return json({
        error: "That method is not available for the latest version of this session. Review its current options and try again.",
        code: error.code,
      }, 422, requestId);
    }
    if (error instanceof PlanDraftReceiptConfigurationError) {
      return unavailable(requestId);
    }
    console.error("YOVA draft method revision failed", { requestId });
    return json({
      error: "YOVA could not change this method safely. Your current plan draft was not changed.",
      code: "draft_method_choice_failed",
    }, 500, requestId);
  }
}

function objectField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function receiptRejected(
  reason: "required" | "expired" | "invalid",
  requestId: string,
) {
  const error = reason === "expired"
    ? "This plan draft expired. Rebuild it before changing a method."
    : reason === "required"
      ? "This older plan draft cannot be verified. Rebuild it before changing a method."
      : "This plan draft no longer matches the version YOVA generated. Rebuild it before changing a method.";
  return json({ error, code: `draft_receipt_${reason}` }, 422, requestId);
}

function unavailable(requestId: string) {
  return json({
    error: "YOVA cannot verify this plan change right now. Try again after the server connection is restored.",
    code: "draft_receipt_unavailable",
  }, 503, requestId);
}

function json(body: object, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(requestId),
  });
}

function responseHeaders(requestId: string) {
  return {
    "Cache-Control": "no-store",
    "X-Yova-Request-Id": requestId,
  };
}

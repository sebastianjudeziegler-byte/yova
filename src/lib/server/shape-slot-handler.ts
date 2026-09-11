import "server-only";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import { fillShapeSlot, ShapeSlotGenerationError, type SlotProvider } from "@/lib/openai/shape-slot-generator";
import {
  consumeAIRequestClaimAfterProviderFailure,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import type { AIUsageAction } from "@/lib/server/ai-usage-policy";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkLessonGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { sessionOperationFailure, verifyOperationalPlanSession } from "@/lib/server/session-operation-guard";
import {
  SHAPE_SLOT_HONEST_ERROR,
  ShapeSlotRequestSchema,
  type ShapeSlotError,
  type ShapeSlotRequest,
} from "@/lib/session-shapes/slots-schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The four bounded AI slots of the baseline session shapes. One request, one
 * slot. Structure never comes from here: the shape state machines in the
 * browser decide what step comes next, and this handler only fills the slot
 * they ask for. See docs/redesign/04-AI-SLOTS.md.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export type ShapeSlotHandlerDependencies = {
  /** null means the provider is not configured; the route resolves the real one. */
  provider: SlotProvider | null;
};

function failure(status: number, body: ShapeSlotError, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Slots 1, 2 and 4 are lesson-shaped work; Slot 3 is a formative evaluation. */
export function shapeSlotUsageAction(request: Pick<ShapeSlotRequest, "action">): AIUsageAction {
  return request.action === "compare" ? "answer_evaluation" : "lesson_generation";
}

export async function handleShapeSlotRequest(request: Request, { provider }: ShapeSlotHandlerDependencies) {
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (!developmentPreview && (!supabase || userError || !user)) {
    return failure(401, { error: "Sign in to continue this session.", code: "unauthorized" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, { error: "The session request was not valid JSON.", code: "invalid_request" });
  }
  const parsed = ShapeSlotRequestSchema.safeParse(body);
  if (!parsed.success) {
    return failure(422, { error: "YOVA could not read this session step.", code: "invalid_request" });
  }
  const slotRequest = parsed.data;

  if (!developmentPreview && supabase) {
    const operationAccess = await verifyOperationalPlanSession(supabase, {
      planId: slotRequest.planId,
      planSessionId: slotRequest.planSessionId,
    });
    if (!operationAccess.allowed) {
      const denied = sessionOperationFailure(operationAccess);
      return failure(denied.status, { error: denied.error, code: "not_operational" });
    }
  }

  const rateLimit = checkLessonGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return failure(429, { error: "YOVA is receiving too many requests from you right now. Wait a moment and try again.", code: "rate_limited" }, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  }

  // Slot 1 is honest without a provider (a template naming the learner's own
  // material). Every other slot needs the provider, so say so before billing.
  if (!provider && slotRequest.action !== "direction") {
    return failure(503, { error: SHAPE_SLOT_HONEST_ERROR, code: "provider_unavailable" });
  }

  let claimId: string | null = null;
  if (!developmentPreview && supabase && provider) {
    const action = shapeSlotUsageAction(slotRequest);
    try {
      const reservation = await reserveAIRequest(supabase, action, slotRequest.requestId, slotRequest.recoveryKey);
      if (!reservation.allowed) {
        const conflict = aiUsageReservationConflict(reservation);
        if (conflict) {
          return failure(409, { error: conflict.error, code: "invalid_request" }, conflict.retryAfterSeconds === null ? {} : { "Retry-After": String(conflict.retryAfterSeconds) });
        }
        return failure(429, { error: "You have used today's AI allowance for sessions. It resets later today.", code: "allowance_exhausted" }, { "Retry-After": String(reservation.retryAfterSeconds) });
      }
      claimId = reservation.claimId;
    } catch {
      try {
        await refundAIRequestReservationBeforeProvider(supabase, action, slotRequest.requestId, slotRequest.recoveryKey);
      } catch {
        // The reservation could not be confirmed either way; the learner retries with a new request id.
      }
      return failure(503, { error: "YOVA could not verify your AI allowance. Try again.", code: "provider_unavailable" });
    }
  }

  try {
    const response = await fillShapeSlot(slotRequest, provider);
    if (claimId && supabase) await settleAIRequestClaim(supabase, claimId).catch(() => undefined);
    return Response.json(response, { headers: { ...NO_STORE, "X-Yova-Request-Id": slotRequest.requestId } });
  } catch (error) {
    if (claimId && supabase) await consumeAIRequestClaimAfterProviderFailure(supabase, claimId).catch(() => undefined);
    if (error instanceof ShapeSlotGenerationError) {
      return failure(error.code === "provider_unavailable" ? 503 : 502, { error: error.message, code: error.code }, { "X-Yova-Slot-Attempts": String(error.attempts) });
    }
    return failure(502, { error: SHAPE_SLOT_HONEST_ERROR, code: "generation_failed" });
  }
}

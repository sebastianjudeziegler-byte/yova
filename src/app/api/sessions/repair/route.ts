import { NextResponse } from "next/server";
import { isOpenAIAnswerEvaluationConfigured } from "@/lib/openai/config";
import { generateRuntimeRepairWithOpenAI } from "@/lib/openai/runtime-repair-generator";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import {
  consumeAIRequestClaimAfterProviderFailure,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkAnswerEvaluationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import { buildFallbackRuntimeRepair } from "@/lib/session-repair/fallback";
import {
  RuntimeRepairRequestSchema,
  RuntimeRepairResponseSchema,
} from "@/lib/session-repair/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return response({ error: "The repair request was not valid JSON." }, requestId, 400);
  }

  const parsed = RuntimeRepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: "YOVA needs a valid missed activity to build the next repair." }, requestId, 422);
  }

  const rateLimit = checkAnswerEvaluationRateLimit(requestRateLimitKey(request));
  if (!rateLimit.allowed) {
    return response({ error: "YOVA is adapting too many responses at once. Wait a moment and try again." }, requestId, 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  if (developmentPreview) {
    return response(RuntimeRepairResponseSchema.parse({
      repair: buildFallbackRuntimeRepair(parsed.data),
      generation: { mode: "preview" },
    }), requestId);
  }

  if (!isSupabaseConfigured()) {
    return response({ error: "Adaptive repair needs YOVA's secure cloud connection." }, requestId, 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return response({ error: "Sign in to adapt this session." }, requestId, 401);

  const operationAccess = await verifyOperationalPlanSession(supabase, parsed.data);
  if (!operationAccess.allowed) {
    const failure = sessionOperationFailure(operationAccess);
    return response({ error: failure.error }, requestId, failure.status);
  }

  if (!isOpenAIAnswerEvaluationConfigured()) {
    return response(RuntimeRepairResponseSchema.parse({
      repair: buildFallbackRuntimeRepair(parsed.data),
      generation: { mode: "fallback" },
    }), requestId);
  }

  let aiUsageClaimId: string | null = null;
  try {
    let durableLimit: Awaited<ReturnType<typeof reserveAIRequest>>;
    const aiUsageRecoveryKey = crypto.randomUUID();
    try {
      durableLimit = await reserveAIRequest(supabase, "answer_evaluation", requestId, aiUsageRecoveryKey);
    } catch {
      await recoverUnknownRepairReservation(supabase, requestId, aiUsageRecoveryKey);
      return response(RuntimeRepairResponseSchema.parse({
        repair: buildFallbackRuntimeRepair(parsed.data),
        generation: { mode: "fallback" },
      }), requestId);
    }
    if (!durableLimit.allowed) {
      const conflict = aiUsageReservationConflict(durableLimit);
      if (conflict) {
        return response(
          { code: conflict.code, error: conflict.error, retryable: conflict.retryable },
          requestId,
          409,
          conflict.retryAfterSeconds === null
            ? {}
            : { "Retry-After": String(conflict.retryAfterSeconds) },
        );
      }
      return response(RuntimeRepairResponseSchema.parse({
        repair: buildFallbackRuntimeRepair(parsed.data),
        generation: { mode: "fallback" },
      }), requestId);
    }
    aiUsageClaimId = durableLimit.claimId;
    const repair = await generateRuntimeRepairWithOpenAI(parsed.data);
    const learnerResponse = RuntimeRepairResponseSchema.parse({
      repair,
      generation: { mode: "openai" },
    });
    await settleSuccessfulRepairClaim(supabase, aiUsageClaimId, requestId);
    return response(learnerResponse, requestId);
  } catch (error) {
    await consumeFailedRepairClaim(supabase, aiUsageClaimId, requestId);
    console.error("YOVA runtime repair generation failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return response(RuntimeRepairResponseSchema.parse({
      repair: buildFallbackRuntimeRepair(parsed.data),
      generation: { mode: "fallback" },
    }), requestId);
  }
}

async function settleSuccessfulRepairClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful repair allowance claim", { requestId });
    }
  } catch {
    console.error("YOVA could not settle a successful repair allowance claim", { requestId });
  }
}

async function consumeFailedRepairClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string | null,
  requestId: string,
) {
  if (!claimId) return;
  try {
    await consumeAIRequestClaimAfterProviderFailure(supabase, claimId);
  } catch {
    console.error("YOVA could not consume a failed repair allowance claim", { requestId });
  }
}

async function recoverUnknownRepairReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(supabase, "answer_evaluation", operationKey, recoveryKey);
  } catch {
    // Its short database lease remains the final recovery boundary.
  }
}

function response(
  body: unknown,
  requestId: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Yova-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}

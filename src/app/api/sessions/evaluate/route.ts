import { NextResponse } from "next/server";
import { evaluateAnswerWithOpenAI } from "@/lib/openai/answer-evaluator";
import { isOpenAIAnswerEvaluationConfigured } from "@/lib/openai/config";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import {
  releaseAIRequestClaim,
  releaseAIRequestReservation,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkAnswerEvaluationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import { evaluatePreviewAnswer } from "@/lib/session-evaluation/preview";
import {
  AnswerEvaluationRequestSchema,
  AnswerEvaluationResponseSchema,
} from "@/lib/session-evaluation/schema";
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
    return response({ error: "The answer check was not valid JSON." }, requestId, 400);
  }

  const parsed = AnswerEvaluationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: "YOVA needs a valid learning response to check." }, requestId, 422);
  }

  const rateLimit = checkAnswerEvaluationRateLimit(requestRateLimitKey(request));
  if (!rateLimit.allowed) {
    return response(
      { error: "YOVA is checking too many responses at once. Wait a moment and try again." },
      requestId,
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  if (developmentPreview) {
    return response(AnswerEvaluationResponseSchema.parse({
      ...evaluatePreviewAnswer(parsed.data),
      mode: "preview",
    }), requestId);
  }

  if (!isSupabaseConfigured()) {
    return response({ error: "Answer checking needs YOVA's secure cloud connection." }, requestId, 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return response({ error: "Sign in to check this response." }, requestId, 401);
  }

  const operationAccess = await verifyOperationalPlanSession(supabase, parsed.data);
  if (!operationAccess.allowed) {
    const failure = sessionOperationFailure(operationAccess);
    return response({ error: failure.error }, requestId, failure.status);
  }

  if (!isOpenAIAnswerEvaluationConfigured()) {
    return response({ error: "Live answer feedback is not connected yet." }, requestId, 503);
  }

  let aiUsageClaimId: string | null = null;
  try {
    let durableLimit: Awaited<ReturnType<typeof reserveAIRequest>>;
    const aiUsageRecoveryKey = crypto.randomUUID();
    try {
      durableLimit = await reserveAIRequest(supabase, "answer_evaluation", requestId, aiUsageRecoveryKey);
    } catch {
      await recoverUnknownEvaluationReservation(supabase, requestId, aiUsageRecoveryKey);
      return response(
        { error: "YOVA could not verify the answer-checking allowance right now." },
        requestId,
        503,
      );
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
      return response(
        { error: "This account has reached its answer-checking allowance. Compare with the reference answer for now." },
        requestId,
        429,
        { "Retry-After": String(durableLimit.retryAfterSeconds) },
      );
    }
    aiUsageClaimId = durableLimit.claimId;

    const evaluation = await evaluateAnswerWithOpenAI(parsed.data);
    const learnerResponse = AnswerEvaluationResponseSchema.parse({
      ...evaluation,
      mode: "openai",
    });
    await settleSuccessfulEvaluationClaim(supabase, aiUsageClaimId, requestId);
    return response(learnerResponse, requestId);
  } catch (error) {
    await releaseFailedEvaluationClaim(supabase, aiUsageClaimId, requestId);
    console.error("YOVA answer evaluation failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return response({ error: "YOVA could not check this explanation right now. Compare it with the reference answer instead." }, requestId, 502);
  }
}

async function settleSuccessfulEvaluationClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful answer-checking allowance claim", { requestId });
    }
  } catch {
    console.error("YOVA could not settle a successful answer-checking allowance claim", { requestId });
  }
}

async function releaseFailedEvaluationClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string | null,
  requestId: string,
) {
  if (!claimId) return;
  try {
    await releaseAIRequestClaim(supabase, claimId);
  } catch {
    console.error("YOVA could not return a failed answer-checking allowance claim", { requestId });
  }
}

async function recoverUnknownEvaluationReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await releaseAIRequestReservation(supabase, "answer_evaluation", operationKey, recoveryKey);
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

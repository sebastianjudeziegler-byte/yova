import { NextResponse } from "next/server";
import { evaluateAnswerWithOpenAI } from "@/lib/openai/answer-evaluator";
import { isOpenAIAnswerEvaluationConfigured } from "@/lib/openai/config";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkAnswerEvaluationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
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

  const { data: planSession, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,plan_id")
    .eq("id", parsed.data.planSessionId)
    .maybeSingle();
  if (sessionError) return response({ error: "YOVA could not verify this learning session." }, requestId, 500);
  if (!planSession || planSession.plan_id !== parsed.data.planId) {
    return response({ error: "That learning session was not found." }, requestId, 404);
  }

  if (!isOpenAIAnswerEvaluationConfigured()) {
    return response({ error: "Live answer feedback is not connected yet." }, requestId, 503);
  }

  try {
    const durableLimit = await claimAIRequest(supabase, "answer_evaluation");
    if (!durableLimit.allowed) {
      return response(
        { error: "This account has reached its answer-checking allowance. Compare with the reference answer for now." },
        requestId,
        429,
        { "Retry-After": String(durableLimit.retryAfterSeconds) },
      );
    }

    const evaluation = await evaluateAnswerWithOpenAI(parsed.data);
    return response(AnswerEvaluationResponseSchema.parse({
      ...evaluation,
      mode: "openai",
    }), requestId);
  } catch (error) {
    console.error("YOVA answer evaluation failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return response({ error: "YOVA could not check this explanation right now. Compare it with the reference answer instead." }, requestId, 502);
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

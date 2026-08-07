import { NextResponse } from "next/server";
import { isOpenAIAnswerEvaluationConfigured } from "@/lib/openai/config";
import { generateRuntimeRepairWithOpenAI } from "@/lib/openai/runtime-repair-generator";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkAnswerEvaluationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
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
    return response(RuntimeRepairResponseSchema.parse({
      repair: buildFallbackRuntimeRepair(parsed.data),
      generation: { mode: "fallback" },
    }), requestId);
  }

  try {
    const durableLimit = await claimAIRequest(supabase, "answer_evaluation");
    if (!durableLimit.allowed) {
      return response(RuntimeRepairResponseSchema.parse({
        repair: buildFallbackRuntimeRepair(parsed.data),
        generation: { mode: "fallback" },
      }), requestId);
    }
    const repair = await generateRuntimeRepairWithOpenAI(parsed.data);
    return response(RuntimeRepairResponseSchema.parse({
      repair,
      generation: { mode: "openai" },
    }), requestId);
  } catch (error) {
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

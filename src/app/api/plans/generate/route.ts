import { NextResponse } from "next/server";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { generatePlanWithOpenAI, OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import {
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
} from "@/lib/plan-generation/schema";
import { checkPlanGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { persistPlanForAuthenticatedUser } from "@/lib/supabase/plan-repository";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The plan request was not valid JSON." },
      { status: 400, headers: { "X-Yova-Request-Id": requestId } },
    );
  }

  const parsedRequest = PlanGenerationRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: "YOVA needs a little more valid information before building the plan.",
        fields: parsedRequest.error.flatten().fieldErrors,
      },
      { status: 422, headers: { "X-Yova-Request-Id": requestId } },
    );
  }

  if (isOpenAIPlanConfigured()) {
    const rateLimit = checkPlanGenerationRateLimit(requestRateLimitKey(request));
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many plans were requested at once. Wait a moment and try again.", code: "rate_limited", requestId },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimit.retryAfterSeconds),
            "X-Yova-Request-Id": requestId,
          },
        },
      );
    }

    try {
      const generated = await generatePlanWithOpenAI(parsedRequest.data);
      const plan = materializePlanDraft(generated.draft, parsedRequest.data);
      let persistence: "browser" | "supabase" = "browser";

      try {
        persistence = await persistPlanForAuthenticatedUser(plan, parsedRequest.data);
      } catch {
        console.error("YOVA plan persistence failed", { requestId });
      }

      const response = PlanGenerationResponseSchema.parse({
        plan,
        generation: {
          mode: "openai",
          model: generated.model,
          notice: null,
          requestId,
          durationMs: Date.now() - startedAt,
          persistence,
        },
      });

      return NextResponse.json(response, {
        headers: {
          "Cache-Control": "no-store",
          "X-Yova-Request-Id": requestId,
        },
      });
    } catch (error) {
      const reason = error instanceof OpenAIPlanGenerationError ? error.reason : "provider_error";
      console.error("YOVA plan generation failed", { requestId, reason });
      return NextResponse.json(
        {
          error: "YOVA could not generate this plan right now. Your information was not saved; try again in a moment.",
          code: "generation_failed",
          requestId,
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        },
      );
    }
  }

  const previewPlan = generatePreviewPlan(parsedRequest.data);
  let previewPersistence: "browser" | "supabase" = "browser";

  try {
    previewPersistence = await persistPlanForAuthenticatedUser(previewPlan, parsedRequest.data);
  } catch {
    console.error("YOVA preview-plan persistence failed", { requestId });
  }

  const response = PlanGenerationResponseSchema.parse({
    plan: previewPlan,
    generation: {
      mode: "preview",
      model: null,
      notice: "This plan used YOVA's validated preview engine. Live AI generation becomes available when the server API key is connected.",
      requestId,
      durationMs: Date.now() - startedAt,
      persistence: previewPersistence,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

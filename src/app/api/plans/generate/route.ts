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
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { persistPlanForAuthenticatedUser, PlanPersistenceError } from "@/lib/supabase/plan-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };

  if (supabase && (userError || !user)) {
    return NextResponse.json({ error: "Sign in before generating a learning plan." }, { status: 401 });
  }

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

  let planRequest = parsedRequest.data;
  if (planRequest.materialMode === "upload") {
    if (!supabase || !user) {
      return NextResponse.json({ error: "Secure material uploads are not connected yet." }, { status: 503 });
    }

    const requestedIds = planRequest.materials.map((material) => material.id);
    const { data: uploadedMaterials, error: materialError } = await supabase
      .from("material_uploads")
      .select("id,filename,mime_type,byte_size,processing_status,extracted_text")
      .in("id", requestedIds);

    if (materialError) {
      return NextResponse.json({ error: "YOVA could not load your uploaded materials." }, { status: 500 });
    }

    const materialById = new Map((uploadedMaterials ?? []).map((material) => [material.id, material]));
    const hydratedMaterials = planRequest.materials.map((requested) => {
      const stored = materialById.get(requested.id);
      if (!stored || stored.processing_status !== "ready" || !stored.extracted_text) return null;
      return {
        id: stored.id,
        name: stored.filename,
        mimeType: stored.mime_type,
        sizeBytes: stored.byte_size,
        textContent: stored.extracted_text,
        processingStatus: "ready" as const,
      };
    });

    if (hydratedMaterials.some((material) => material === null)) {
      return NextResponse.json({ error: "One or more materials are missing, expired, or not ready." }, { status: 422 });
    }

    planRequest = {
      ...planRequest,
      materials: hydratedMaterials.filter((material) => material !== null),
    };
  }

  if (isOpenAIPlanConfigured()) {
    const rateLimit = checkPlanGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
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

    if (supabase && user) {
      let durableLimit: Awaited<ReturnType<typeof claimAIRequest>>;
      try {
        durableLimit = await claimAIRequest(supabase, "plan_generation");
      } catch {
        return NextResponse.json(
          { error: "YOVA paused before using OpenAI because it could not verify the account’s AI budget.", code: "usage_gate_unavailable", requestId },
          { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
        );
      }
      if (!durableLimit.allowed) {
        return NextResponse.json(
          { error: "This account has reached its plan-generation allowance. Try again after the limit resets.", code: "rate_limited", requestId },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(durableLimit.retryAfterSeconds),
              "X-Yova-Request-Id": requestId,
            },
          },
        );
      }
    }

    try {
      const generated = await generatePlanWithOpenAI(planRequest);
      const plan = materializePlanDraft(generated.draft, planRequest);
      const persistence = await persistPlanForAuthenticatedUser(plan, planRequest);

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
      if (error instanceof PlanPersistenceError) {
        console.error("YOVA plan persistence failed", { requestId });
        return NextResponse.json(
          {
            error: "YOVA created the plan but could not save it safely. Nothing was activated; try again in a moment.",
            code: "persistence_failed",
            requestId,
          },
          {
            status: 503,
            headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
          },
        );
      }
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

  const previewPlan = generatePreviewPlan(planRequest);
  let previewPersistence: "browser" | "supabase";

  try {
    previewPersistence = await persistPlanForAuthenticatedUser(previewPlan, planRequest);
  } catch (error) {
    console.error("YOVA preview-plan persistence failed", { requestId });
    if (error instanceof PlanPersistenceError) {
      return NextResponse.json(
        {
          error: "YOVA created the plan but could not save it safely. Nothing was activated; try again in a moment.",
          code: "persistence_failed",
          requestId,
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        },
      );
    }
    return NextResponse.json(
      { error: "YOVA could not save the plan safely. Nothing was activated; try again in a moment.", code: "persistence_failed", requestId },
      { status: 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
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

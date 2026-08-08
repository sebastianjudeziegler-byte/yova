import { NextResponse } from "next/server";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { assessGoalContext } from "@/lib/learning/goal-context";
import { generatePlanWithOpenAI, OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import {
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
} from "@/lib/plan-generation/schema";
import { checkPlanGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };

  if (!developmentPreview && supabase && (userError || !user)) {
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

  const goalContext = assessGoalContext(
    parsedRequest.data.goal,
    parsedRequest.data.materialMode === "upload" && parsedRequest.data.materials.length > 0,
  );
  if (!goalContext.hasEnoughContext) {
    return NextResponse.json(
      {
        error: goalContext.message,
        code: "goal_needs_detail",
      },
      { status: 422, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
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

  // A one-off session does not need an AI-generated multi-day plan. The
  // deterministic router can define its target and learning approach
  // immediately; the session generator still creates the subject teaching,
  // examples, and checks that follow.
  if (planRequest.intent === "study_now") {
    const focusedPlan = generatePreviewPlan(planRequest);
    const response = PlanGenerationResponseSchema.parse({
      plan: focusedPlan,
      generation: {
        mode: "system",
        model: null,
        notice: null,
        requestId,
        durationMs: Date.now() - startedAt,
        persistence: "draft",
      },
    });

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }

  if (isOpenAIPlanConfigured()) {
    const rateLimit = checkPlanGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
    if (!rateLimit.allowed) {
      return reliableDraftResponse(
        planRequest,
        requestId,
        startedAt,
        "YOVA used its reliable planning engine because live AI planning was temporarily busy. Review the draft before saving it; the guided sessions will still teach and check the exact topic.",
      );
    }

    if (supabase && user) {
      let durableLimit: Awaited<ReturnType<typeof claimAIRequest>>;
      try {
        durableLimit = await claimAIRequest(supabase, "plan_generation");
      } catch {
        return reliableDraftResponse(
          planRequest,
          requestId,
          startedAt,
          "YOVA used its reliable planning engine because live AI planning was temporarily unavailable. Review the draft before saving it; the guided sessions will still teach and check the exact topic.",
        );
      }
      if (!durableLimit.allowed) {
        return reliableDraftResponse(
          planRequest,
          requestId,
          startedAt,
          "YOVA used its reliable planning engine because this account's live AI planning allowance is currently unavailable. Review the draft before saving it; the guided sessions will still teach and check the exact topic.",
        );
      }
    }

    try {
      const generated = await generatePlanWithOpenAI(planRequest);
      const plan = materializePlanDraft(generated.draft, planRequest);

      const response = PlanGenerationResponseSchema.parse({
        plan,
        generation: {
          mode: "openai",
          model: generated.model,
          notice: null,
          requestId,
          durationMs: Date.now() - startedAt,
          persistence: "draft",
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
      return reliableDraftResponse(
        planRequest,
        requestId,
        startedAt,
        "YOVA used its reliable planning engine for this first draft. Review the plan before saving it; each guided session will still create teaching and practice for the exact topic.",
      );
    }
  }

  const previewPlan = generatePreviewPlan(planRequest);
  const response = PlanGenerationResponseSchema.parse({
    plan: previewPlan,
    generation: {
      mode: "preview",
      model: null,
      notice: "This plan used YOVA's validated preview engine. Live AI generation becomes available when the server API key is connected.",
      requestId,
      durationMs: Date.now() - startedAt,
      persistence: "draft",
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function reliableDraftResponse(
  planRequest: Parameters<typeof generatePreviewPlan>[0],
  requestId: string,
  startedAt: number,
  notice: string,
) {
  const reliablePlan = generatePreviewPlan(planRequest);
  const response = PlanGenerationResponseSchema.parse({
    plan: reliablePlan,
    generation: {
      mode: "system",
      model: null,
      notice,
      requestId,
      durationMs: Date.now() - startedAt,
      persistence: "draft",
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

import { NextResponse } from "next/server";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { assessGoalContext } from "@/lib/learning/goal-context";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import { generatePlanKnowledgeMap, KnowledgeMapGenerationError } from "@/lib/knowledge-map/generate-plan-map";
import { generateMapDiagnostic, MapDiagnosticGenerationError } from "@/lib/diagnostics/map-diagnostic";
import { mapAndPersistMaterial } from "@/lib/materials/material-understanding";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import { generatePlanWithOpenAI, OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import {
  PlanGenerationRequestSchema,
  PlanDiagnosticPreparationResponseSchema,
  PlanGenerationResponseSchema,
} from "@/lib/plan-generation/schema";
import { checkPlanGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Broad learning pathways can require one complete structured generation plus
// one bounded educational-quality repair. Keep enough server time for both.
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const diagnosticOnly = new URL(request.url).searchParams.get("mode") === "diagnostic";
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

  const resolvedApproach = resolveLearningIntent({
    goal: parsedRequest.data.goal,
    startingPoint: parsedRequest.data.startingContext,
    diagnosticResponses: parsedRequest.data.diagnosticResponses,
  });
  let planRequest = {
    ...parsedRequest.data,
    learningIntent: resolvedApproach.intent,
  };
  if (planRequest.materialMode === "upload") {
    if (!supabase || !user) {
      return NextResponse.json({ error: "Secure material uploads are not connected yet." }, { status: 503 });
    }

    const requestedIds = planRequest.materials.map((material) => material.id);
    const { data: uploadedMaterials, error: materialError } = await supabase
      .from("material_uploads")
      .select("id,filename,mime_type,byte_size,processing_status,extracted_text,metadata")
      .in("id", requestedIds);

    if (materialError) {
      return NextResponse.json({ error: "YOVA could not load your uploaded materials." }, { status: 500 });
    }

    const materialById = new Map((uploadedMaterials ?? []).map((material) => [material.id, material]));
    const hydratedMaterials = await Promise.all(planRequest.materials.map(async (requested) => {
      const stored = materialById.get(requested.id);
      if (!stored || stored.processing_status !== "ready" || !stored.extracted_text) return null;
      const existingUnderstanding = readMaterialUnderstanding(stored.metadata);
      const understanding = existingUnderstanding ?? await mapAndPersistMaterial({
        supabase,
        userId: user.id,
        materialId: stored.id,
        filename: stored.filename,
        text: stored.extracted_text,
      }).catch(() => null);
      if (!understanding) return null;
      return {
        id: stored.id,
        name: stored.filename,
        mimeType: stored.mime_type,
        sizeBytes: stored.byte_size,
        textContent: stored.extracted_text,
        processingStatus: "ready" as const,
        understanding,
      };
    }));

    if (hydratedMaterials.some((material) => material === null)) {
      return NextResponse.json({ error: "YOVA is still mapping one of your materials. Try again in a moment." }, { status: 409 });
    }

    planRequest = {
      ...planRequest,
      materials: hydratedMaterials.filter((material) => material !== null),
    };
  }

  try {
    const mapped = planRequest.knowledgeMap
      ? null
      : !isOpenAIPlanConfigured() && (developmentPreview || process.env.NODE_ENV === "development")
        ? buildDevelopmentPreviewKnowledgeMap(planRequest)
        : await generatePlanKnowledgeMap(planRequest);
    if (mapped) planRequest = { ...planRequest, knowledgeMap: mapped.map };
    if (mapped) {
    await recordGenerationObservation(supabase, user?.id, {
      generationType: "knowledge_map",
      environment: generationEnvironment(),
      finalOutcome: "success",
      firstAttemptPassed: mapped.stats.firstAttemptPassed,
      failedValidator: mapped.stats.failedValidator,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: mapped.stats.elapsedMs,
      attempts: mapped.stats.attempts,
      inputTokens: mapped.stats.inputTokens,
      cachedInputTokens: mapped.stats.cachedInputTokens,
      cacheWriteTokens: mapped.stats.cacheWriteTokens,
      outputTokens: mapped.stats.outputTokens,
      model: mapped.stats.model,
      diagnostics: { topicCount: mapped.map.topics.length, scopeBand: mapped.map.scopeJudgment.band },
    });
    }
  } catch (error) {
    const validator = error instanceof KnowledgeMapGenerationError
      ? error.failedValidator
      : "knowledge_map_provider_request" as const;
    await recordGenerationObservation(supabase, user?.id, {
      generationType: "knowledge_map",
      environment: generationEnvironment(),
      finalOutcome: "failure",
      firstAttemptPassed: false,
      failedValidator: validator,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      model: null,
    });
    return NextResponse.json(
      { error: "YOVA could not map this learning goal yet. Try again in a moment.", code: "knowledge_map_failed" },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  if (diagnosticOnly && planRequest.knowledgeMap) {
    const diagnosticStartedAt = Date.now();
    try {
      const generated = await generateMapDiagnostic(planRequest.knowledgeMap, planRequest.goal);
      await recordGenerationObservation(supabase, user?.id, {
        generationType: "diagnostic",
        environment: generationEnvironment(),
        finalOutcome: "success",
        firstAttemptPassed: generated.stats.firstAttemptPassed,
        failedValidator: generated.stats.failedValidator,
        repairAttempted: false,
        repairSucceeded: null,
        elapsedMs: generated.stats.elapsedMs,
        attempts: generated.stats.attempts,
        inputTokens: generated.stats.inputTokens,
        cachedInputTokens: generated.stats.cachedInputTokens,
        cacheWriteTokens: generated.stats.cacheWriteTokens,
        outputTokens: generated.stats.outputTokens,
        model: generated.stats.model,
        diagnostics: { questionCount: generated.questions.length, topicCount: planRequest.knowledgeMap.topics.length },
      });
      return NextResponse.json(PlanDiagnosticPreparationResponseSchema.parse({
        knowledgeMap: planRequest.knowledgeMap,
        questions: generated.questions,
        generation: {
          requestId,
          durationMs: Date.now() - diagnosticStartedAt,
          mode: generated.stats.model ? "openai" : "preview",
        },
      }), { headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
    } catch (error) {
      const failedValidator = error instanceof MapDiagnosticGenerationError
        ? error.failedValidator
        : "diagnostic_provider_request" as const;
      await recordGenerationObservation(supabase, user?.id, {
        ...emptyPlanObservation(Date.now() - diagnosticStartedAt),
        generationType: "diagnostic",
        environment: generationEnvironment(),
        finalOutcome: "failure",
        firstAttemptPassed: false,
        failedValidator,
      });
      return NextResponse.json({ error: "YOVA could not prepare the placement check yet. You can skip it and continue." }, { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
    }
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

    await recordGenerationObservation(supabase, user?.id, {
      ...emptyPlanObservation(Date.now() - startedAt),
      generationType: "plan",
      environment: generationEnvironment(),
      finalOutcome: "success",
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
        supabase,
        user?.id,
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
          supabase,
          user?.id,
        );
      }
      if (!durableLimit.allowed) {
        return reliableDraftResponse(
          planRequest,
          requestId,
          startedAt,
          "YOVA used its reliable planning engine because this account's live AI planning allowance is currently unavailable. Review the draft before saving it; the guided sessions will still teach and check the exact topic.",
          supabase,
          user?.id,
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

      await recordGenerationObservation(supabase, user?.id, {
        generationType: "plan",
        environment: generationEnvironment(),
        finalOutcome: "success",
        firstAttemptPassed: generated.generationStats.firstAttemptPassed,
        failedValidator: generated.generationStats.failedValidator,
        repairAttempted: generated.generationStats.repairAttempted,
        repairSucceeded: generated.generationStats.repairSucceeded,
        elapsedMs: generated.generationStats.elapsedMs,
        attempts: generated.generationStats.attempts,
        inputTokens: generated.generationStats.inputTokens,
        cachedInputTokens: generated.generationStats.cachedInputTokens,
        cacheWriteTokens: generated.generationStats.cacheWriteTokens,
        outputTokens: generated.generationStats.outputTokens,
        model: generated.model,
        diagnostics: { scopeBand: planRequest.knowledgeMap?.scopeJudgment.band },
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
        supabase,
        user?.id,
        error instanceof OpenAIPlanGenerationError ? error.generationStats : undefined,
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

  await recordGenerationObservation(supabase, user?.id, {
    ...emptyPlanObservation(Date.now() - startedAt),
    generationType: "plan",
    environment: generationEnvironment(),
    finalOutcome: "success",
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function readMaterialUnderstanding(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = MaterialUnderstandingSchema.safeParse((metadata as Record<string, unknown>).materialUnderstanding);
  return parsed.success ? parsed.data : null;
}

function buildDevelopmentPreviewKnowledgeMap(
  request: Parameters<typeof generatePreviewPlan>[0],
): Awaited<ReturnType<typeof generatePlanKnowledgeMap>> {
  const preview = generatePreviewPlan(request);
  const titles = Array.from(new Set(
    preview.sessions.flatMap((session) => session.contentTargets ?? [])
      .map((title) => title.trim().slice(0, 140))
      .filter((title) => title.length >= 2),
  )).slice(0, 40);
  const topicTitles = titles.length ? titles : [preview.topic.trim().slice(0, 140)];
  const ids = topicTitles.map(() => crypto.randomUUID());
  const map: PlanKnowledgeMap = PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: inferPlanScopeContract(request),
    topics: topicTitles.map((title, index) => ({
      id: ids[index],
      title,
      description: `The knowledge and performance needed for ${title}.`.slice(0, 400),
      subtopics: [],
      prerequisiteTopicIds: index > 0 ? [ids[index - 1]] : [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    })),
  });
  return {
    map,
    stats: {
      elapsedMs: 0,
      attempts: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      firstAttemptPassed: true,
      failedValidator: null,
      model: null,
    },
  };
}

async function reliableDraftResponse(
  planRequest: Parameters<typeof generatePreviewPlan>[0],
  requestId: string,
  startedAt: number,
  notice: string,
  supabase: Parameters<typeof recordGenerationObservation>[0],
  userId: string | null | undefined,
  failedStats?: OpenAIPlanGenerationError["generationStats"],
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

  await recordGenerationObservation(supabase, userId, failedStats ? {
    generationType: "plan",
    environment: generationEnvironment(),
    finalOutcome: "fallback",
    firstAttemptPassed: failedStats.firstAttemptPassed,
    failedValidator: failedStats.failedValidator,
    repairAttempted: failedStats.repairAttempted,
    repairSucceeded: failedStats.repairSucceeded,
    elapsedMs: failedStats.elapsedMs,
    attempts: failedStats.attempts,
    inputTokens: failedStats.inputTokens,
    cachedInputTokens: failedStats.cachedInputTokens,
    cacheWriteTokens: failedStats.cacheWriteTokens,
    outputTokens: failedStats.outputTokens,
    model: null,
  } : {
    ...emptyPlanObservation(Date.now() - startedAt),
    generationType: "plan",
    environment: generationEnvironment(),
    finalOutcome: "fallback",
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function emptyPlanObservation(elapsedMs: number) {
  return {
    firstAttemptPassed: null,
    failedValidator: null,
    repairAttempted: false,
    repairSucceeded: null,
    elapsedMs,
    attempts: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    model: null,
  } as const;
}

import { NextResponse } from "next/server";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { assessGoalContext } from "@/lib/learning/goal-context";
import {
  CanonicalMethodSelectionError,
  selectCanonicalStudyMethod,
} from "@/lib/learning/canonical-method-selection";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import { generatePlanKnowledgeMap, KnowledgeMapGenerationError } from "@/lib/knowledge-map/generate-plan-map";
import { generateMapDiagnostic, MapDiagnosticGenerationError } from "@/lib/diagnostics/map-diagnostic";
import { mapAndPersistMaterial } from "@/lib/materials/material-understanding";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import {
  generateNormalPlanFillWithOpenAI,
  OpenAINormalPlanFillError,
} from "@/lib/openai/normal-plan-fill-generator";
import type { OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";
import { planFailureDiagnostics } from "@/lib/openai/plan-failure-observation";
import {
  composeNormalPlanEnvelopes,
  NormalPlanEnvelopeComposerError,
} from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { PlanScheduleCapacityError } from "@/lib/plan-generation/schedule-plan";
import { resolvePlanRequestSubjectBoundary } from "@/lib/plan-generation/subject-boundary";
import { studyDayWindowForInstant } from "@/lib/scheduling/study-window";
import {
  PlanGenerationRequestSchema,
  PlanDiagnosticPreparationResponseSchema,
  PlanGenerationResponseSchema,
  type PlanGenerationRequest,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";
import {
  projectPreviewPreferredMethodsForGeneration,
} from "@/lib/personalization/personalization-generation";
import { checkPlanGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  aiUsageReservationConflict,
  releaseAIRequestClaim,
  releaseAIRequestReservation,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import {
  assertPlanDraftReceiptConfigured,
  issuePlanDraftReceipt,
  PlanDraftReceiptConfigurationError,
} from "@/lib/server/plan-draft-receipt";
import { loadAuthorizedNormalDurationContext } from "@/lib/study-route/duration-context-server";
import { NORMAL_STUDY_DURATION_LEVELS } from "@/lib/study-route/duration-precedence";
import { integrateInitialPlanMethodRoutes } from "@/lib/study-route/initial-plan-method-routing";
import { methodSelectionContextForStudyRoute } from "@/lib/study-route/method-plan-integration";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { reconcileStudyNowDuration } from "@/lib/study-route/study-now-duration";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// The ordinary-plan path makes at most one bounded prose-only provider call.
// The remaining route time covers mapping and deterministic composition.
export const maxDuration = 120;
const PLAN_GENERATION_DEADLINE_BUFFER_MS = 10_000;
const PLAN_DRAFT_RECEIPT_LIFETIME_MS = 60 * 60 * 1_000;

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

  if (!diagnosticOnly && !developmentPreview) {
    if (!supabase || !user) {
      return draftReceiptUnavailableResponse(requestId);
    }
    try {
      assertPlanDraftReceiptConfigured();
    } catch (error) {
      if (error instanceof PlanDraftReceiptConfigurationError) {
        return draftReceiptUnavailableResponse(requestId);
      }
      throw error;
    }
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

  if (
    parsedRequest.data.previewPreferredMethodIds !== undefined
    && !developmentPreview
  ) {
    return NextResponse.json(
      {
        error: "Preview method preferences are available only in the local development preview.",
        code: "preview_method_preferences_not_allowed",
        fields: {
          previewPreferredMethodIds: [
            "Remove this development-preview-only field before generating a cloud plan.",
          ],
        },
      },
      {
        status: 422,
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      },
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
  if (
    planRequest.intent === "study_now"
    && planRequest.availability[0]!.minutes < NORMAL_STUDY_DURATION_LEVELS[0]
  ) {
    return insufficientNormalSessionTimeResponse(
      planRequest.availability[0]!.minutes,
      requestId,
    );
  }
  if (planRequest.materialMode === "upload") {
    if (!supabase || !user) {
      return NextResponse.json({ error: "Secure material uploads are not connected yet." }, { status: 503 });
    }

    const requestedIds = planRequest.materials.map((material) => material.id);
    const { data: uploadedMaterials, error: materialError } = await supabase
      .from("material_uploads")
      .select("id,filename,mime_type,byte_size,processing_status,extracted_text,metadata,expires_at")
      .in("id", requestedIds)
      .gt("expires_at", new Date().toISOString());

    if (materialError) {
      return NextResponse.json({ error: "YOVA could not load your uploaded materials." }, { status: 500 });
    }

    const materialById = new Map((uploadedMaterials ?? []).map((material) => [material.id, material]));
    if (requestedIds.some((id) => !materialById.has(id))) {
      return expiredMaterialResponse(requestId);
    }
    const hydratedMaterials = await Promise.all(planRequest.materials.map(async (requested) => {
      const stored = materialById.get(requested.id);
      if (!stored || stored.processing_status !== "ready" || !stored.extracted_text) return null;
      const existingUnderstanding = readMaterialUnderstanding(stored.metadata);
      const understanding = existingUnderstanding ?? await mapAndPersistMaterial({
        supabase,
        materialId: stored.id,
        filename: stored.filename,
        text: stored.extracted_text,
        deadlineAt: startedAt + 45_000,
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
      if ((uploadedMaterials ?? []).some((material) => (
        typeof material.expires_at === "string"
        && new Date(material.expires_at).getTime() <= Date.now()
      ))) return expiredMaterialResponse(requestId);
      return NextResponse.json({ error: "YOVA is still mapping one of your materials. Try again in a moment." }, { status: 409 });
    }

    planRequest = {
      ...planRequest,
      materials: hydratedMaterials.filter((material) => material !== null),
    };
  }

  // One plan-generation reservation covers the complete learner-facing AI
  // operation: topic mapping plus either the placement diagnostic or the plan
  // itself. Reserving only immediately before generatePlanWithOpenAI left the
  // earlier knowledge-map/diagnostic calls outside both durable and in-memory
  // limits. Material-understanding repair above remains part of the separate
  // upload/mapping lifecycle.
  let aiUsageClaimId: string | null = null;
  let forcedNormalPlanFallbackNotice: string | null = null;
  const aiUsageRecoveryKey = crypto.randomUUID();
  const canUseAcceptedMapNormalFallback = planRequest.intent === "plan"
    && !diagnosticOnly
    && Boolean(planRequest.knowledgeMap);
  const meteredPlanProviderWork = isOpenAIPlanConfigured()
    && (
      !planRequest.knowledgeMap
      || diagnosticOnly
      || planRequest.intent !== "study_now"
    );
  if (meteredPlanProviderWork) {
    const rateLimit = checkPlanGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
    if (!rateLimit.allowed) {
      if (diagnosticOnly) {
        return NextResponse.json(
          { error: "YOVA is preparing too many placement checks at once. Wait a moment, or skip this check and continue." },
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
      const notice = "Live AI planning is temporarily busy, so YOVA created a basic fallback draft from your saved inputs. Retry live planning, or review this fallback carefully before saving it.";
      if (canUseAcceptedMapNormalFallback) {
        forcedNormalPlanFallbackNotice = notice;
      } else {
        return reliableDraftResponse(
          planRequest,
          requestId,
          startedAt,
          notice,
          supabase,
          user?.id,
          undefined,
          developmentPreview,
        );
      }
    }

    if (!forcedNormalPlanFallbackNotice && supabase && user) {
      let durableLimit: Awaited<ReturnType<typeof reserveAIRequest>> | null = null;
      try {
        durableLimit = await reserveAIRequest(
          supabase,
          "plan_generation",
          requestId,
          aiUsageRecoveryKey,
        );
      } catch {
        await recoverUnknownPlanReservation(supabase, requestId, aiUsageRecoveryKey);
        if (diagnosticOnly) {
          return NextResponse.json(
            { error: "YOVA could not verify the placement-check allowance. Skip this check or try again in a moment." },
            {
              status: 503,
              headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
            },
          );
        }
        const notice = "Live AI planning is temporarily unavailable, so YOVA created a basic fallback draft from your saved inputs. Retry live planning, or review this fallback carefully before saving it.";
        if (canUseAcceptedMapNormalFallback) {
          forcedNormalPlanFallbackNotice = notice;
        } else {
          return reliableDraftResponse(
            planRequest,
            requestId,
            startedAt,
            notice,
            supabase,
            user?.id,
            undefined,
            developmentPreview,
          );
        }
      }
      if (durableLimit && !durableLimit.allowed) {
        const conflict = aiUsageReservationConflict(durableLimit);
        if (conflict) {
          return NextResponse.json(
            { code: conflict.code, error: conflict.error, retryable: conflict.retryable },
            {
              status: 409,
              headers: {
                "Cache-Control": "no-store",
                ...(conflict.retryAfterSeconds === null ? {} : {
                  "Retry-After": String(conflict.retryAfterSeconds),
                }),
                "X-Yova-Request-Id": requestId,
              },
            },
          );
        }
        if (diagnosticOnly) {
          return NextResponse.json(
            { error: "This account has reached its planning allowance. Skip the placement check or return after the allowance resets." },
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
        const notice = "Live AI planning is unavailable for this account right now, so YOVA created a basic fallback draft from your saved inputs. Retry later, or review this fallback carefully before saving it.";
        if (canUseAcceptedMapNormalFallback) {
          forcedNormalPlanFallbackNotice = notice;
        } else {
          return reliableDraftResponse(
            planRequest,
            requestId,
            startedAt,
            notice,
            supabase,
            user?.id,
            undefined,
            developmentPreview,
          );
        }
      }
      if (durableLimit?.allowed) aiUsageClaimId = durableLimit.claimId;
    }
  }

  try {
    const mapped = planRequest.knowledgeMap
      ? null
      : !isOpenAIPlanConfigured() && (developmentPreview || process.env.NODE_ENV === "development")
        ? buildDevelopmentPreviewKnowledgeMap(planRequest)
        : await generatePlanKnowledgeMap(planRequest);
    if (mapped) planRequest = { ...planRequest, knowledgeMap: mapped.map };
    if (mapped) {
      await recordPlanGenerationObservationSafely(supabase, user?.id, {
        generationType: "knowledge_map",
        environment: generationEnvironment(),
        finalOutcome: "success",
        firstAttemptPassed: mapped.stats.firstAttemptPassed,
        failedValidator: mapped.stats.failedValidator,
        repairAttempted: mapped.stats.attempts > 1,
        repairSucceeded: mapped.stats.attempts > 1 ? true : null,
        elapsedMs: mapped.stats.elapsedMs,
        attempts: mapped.stats.attempts,
        inputTokens: mapped.stats.inputTokens,
        cachedInputTokens: mapped.stats.cachedInputTokens,
        cacheWriteTokens: mapped.stats.cacheWriteTokens,
        outputTokens: mapped.stats.outputTokens,
        model: mapped.stats.model,
        diagnostics: {
          topicCount: mapped.map.topics.length,
          scopeBand: mapped.map.scopeJudgment.band,
          curriculumRecognized: mapped.stats.curriculumRecognized,
          ...(mapped.stats.curriculumId ? { curriculumId: mapped.stats.curriculumId } : {}),
          ...(mapped.stats.curriculumMatchSource ? { curriculumMatchSource: mapped.stats.curriculumMatchSource } : {}),
          ...(mapped.stats.curriculumMatchConfidence ? { curriculumMatchConfidence: mapped.stats.curriculumMatchConfidence } : {}),
        },
      });
    }
  } catch (error) {
    await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
    if (error instanceof PlanScheduleCapacityError) {
      return deterministicPlanFailureResponse(error, requestId);
    }
    const validator = error instanceof KnowledgeMapGenerationError
      ? error.failedValidator
      : "knowledge_map_provider_request" as const;
    await recordPlanGenerationObservationSafely(supabase, user?.id, {
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
      const diagnosticResponse = PlanDiagnosticPreparationResponseSchema.parse({
        knowledgeMap: planRequest.knowledgeMap,
        questions: generated.questions,
        generation: {
          requestId,
          durationMs: Date.now() - diagnosticStartedAt,
          mode: generated.stats.model ? "openai" : "preview",
        },
      });
      await settleSuccessfulPlanClaim(supabase, aiUsageClaimId, requestId);
      await recordPlanGenerationObservationSafely(supabase, user?.id, {
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
      return NextResponse.json(diagnosticResponse, {
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    } catch (error) {
      await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
      const failedValidator = error instanceof MapDiagnosticGenerationError
        ? error.failedValidator
        : "diagnostic_provider_request" as const;
      await recordPlanGenerationObservationSafely(supabase, user?.id, {
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
    try {
      const studyNowStartedAt = new Date(startedAt);
      const preliminaryPlan = generatePreviewPlan(planRequest, studyNowStartedAt);
      const durationContext = await loadAuthorizedNormalDurationContext(
        developmentPreview
          ? { developmentPreview: true, now: studyNowStartedAt }
          : supabase && user
            ? { supabase, authenticatedUserId: user.id, now: studyNowStartedAt }
            : { now: studyNowStartedAt },
      );
      const hardMaximumMinutes = planRequest.availability[0]!.minutes;
      const durationDecision = reconcileStudyNowDuration({
        preliminaryPlan,
        context: durationContext,
        scheduledWindow: studyDayWindowForInstant(studyNowStartedAt, planRequest.timeZone),
        hardMaximumMinutes,
        buildPlan: (decision) => generatePreviewPlan(
          planRequest,
          studyNowStartedAt,
          { studyNowDurationDecision: decision },
        ),
      });

      if (durationDecision.status === "insufficient_time") {
        await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
        return insufficientNormalSessionTimeResponse(
          durationDecision.hardMaximumMinutes,
          requestId,
        );
      }

      const durationRoute = StudyRouteSchema.parse(
        durationDecision.plan.sessions[0]!.studyRoute,
      );
      const methodDecision = studyNowMethodDecision({
        route: durationRoute,
        planRequest,
        context: durationContext,
        developmentPreview,
      });
      const focusedPlan = generatePreviewPlan(
        planRequest,
        studyNowStartedAt,
        {
          studyNowDurationDecision: durationDecision.decision,
          studyNowMethodDecision: methodDecision,
        },
      );
      const response = planDraftResponse({
        plan: focusedPlan,
        generation: {
          mode: "system",
          model: null,
          notice: null,
          requestId,
          durationMs: Date.now() - startedAt,
          persistence: "draft",
        },
        planRequest,
        developmentPreview,
        authenticatedUserId: user?.id ?? null,
        issuedAtMs: startedAt,
      });

      await settleSuccessfulPlanClaim(supabase, aiUsageClaimId, requestId);
      await recordPlanGenerationObservationSafely(supabase, user?.id, {
        ...emptyPlanObservation(Date.now() - startedAt),
        generationType: "plan",
        environment: generationEnvironment(),
        finalOutcome: "success",
        diagnostics: {
          durationContextStatus: durationContext.status,
          durationContextReason: durationContext.reason,
          durationSource: durationDecision.decision.timing.durationSource,
          durationActiveMinutes: durationDecision.decision.timing.activeMinutes,
          durationHardMaximumMinutes: hardMaximumMinutes,
          durationTaskFamily: durationDecision.recommendationContext.taskFamily,
          durationMode: durationDecision.recommendationContext.mode,
          methodContextStatus: durationContext.status,
          methodContextReason: durationContext.reason,
          methodAuthority: methodDecision.selection.authority,
          methodId: methodDecision.selection.selectedMethodId,
          methodTaskFamily: methodDecision.selection.taskType,
          methodKnowledgeStage: methodDecision.selection.knowledgeStage,
          methodMode: methodDecision.selection.learningMode,
        },
      });
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    } catch (error) {
      await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
      return deterministicPlanFailureResponse(error, requestId);
    }
  }

  const normalPlanNow = new Date(startedAt);
  let initialPlanContext: Awaited<ReturnType<typeof loadAuthorizedNormalDurationContext>>;
  let normalPlanComposition: ReturnType<typeof composeNormalPlanEnvelopes>;
  try {
    // Resolve the accepted subject exactly once before it can influence either
    // deterministic structure or provider copy.
    planRequest = resolvePlanRequestSubjectBoundary(planRequest);
    initialPlanContext = await loadAuthorizedNormalDurationContext(
      developmentPreview
        ? { developmentPreview: true, now: normalPlanNow }
        : supabase && user
          ? { supabase, authenticatedUserId: user.id, now: normalPlanNow }
          : { now: normalPlanNow },
    );
    normalPlanComposition = composeNormalPlanEnvelopes({
      request: planRequest,
      learningIntentRecommendation: {
        intent: planRequest.learningIntent,
        basis: resolvedApproach.reason,
      },
      durationContext: {
        profileVersion: initialPlanContext.profileVersion,
        profile: initialPlanContext.profile,
        recentOutcomes: initialPlanContext.recentOutcomes,
      },
      now: normalPlanNow,
    });
  } catch (error) {
    await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
    return deterministicPlanFailureResponse(error, requestId);
  }

  const methodContext = {
    profileVersion: initialPlanContext.methodProfileVersion,
    personalization: personalizationForPlanRequest(
      initialPlanContext.methodEvidence.personalization,
      planRequest,
      developmentPreview,
    ),
    observedEvidence: initialPlanContext.methodEvidence.observedEvidence,
  };
  const buildFixedPlan = (fill: unknown) => buildNormalPlanFromFixedEnvelope({
    request: planRequest,
    composition: normalPlanComposition,
    fill,
    now: normalPlanNow,
    methodContext,
  });

  if (forcedNormalPlanFallbackNotice) {
    let plan: ReturnType<typeof buildNormalPlanFromFixedEnvelope>;
    try {
      plan = buildFixedPlan(buildNormalPlanFallbackFill({
        request: planRequest,
        composition: normalPlanComposition,
      }));
    } catch (error) {
      return deterministicPlanFailureResponse(error, requestId);
    }
    const response = planDraftResponse({
      plan,
      generation: {
        mode: "system",
        model: null,
        notice: forcedNormalPlanFallbackNotice,
        requestId,
        durationMs: Date.now() - startedAt,
        persistence: "draft",
      },
      planRequest,
      developmentPreview,
      authenticatedUserId: user?.id ?? null,
      issuedAtMs: startedAt,
    });
    await recordPlanGenerationObservationSafely(supabase, user?.id, {
      ...emptyPlanObservation(Date.now() - startedAt),
      generationType: "plan",
      environment: generationEnvironment(),
      finalOutcome: "fallback",
      diagnostics: {
        scopeBand: planRequest.knowledgeMap?.scopeJudgment.band,
        methodContextStatus: initialPlanContext.status,
        methodContextReason: initialPlanContext.reason,
      },
    });
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }

  if (isOpenAIPlanConfigured()) {
    try {
      const generated = await generateNormalPlanFillWithOpenAI({
        request: planRequest,
        composition: normalPlanComposition,
        now: normalPlanNow,
      }, {
        deadlineAt: startedAt + (maxDuration * 1_000) - PLAN_GENERATION_DEADLINE_BUFFER_MS,
      });
      const plan = buildFixedPlan(generated.fill);

      const response = planDraftResponse({
        plan,
        generation: {
          mode: "openai",
          model: generated.model,
          notice: null,
          requestId,
          durationMs: Date.now() - startedAt,
          persistence: "draft",
        },
        planRequest,
        developmentPreview,
        authenticatedUserId: user?.id ?? null,
        issuedAtMs: startedAt,
      });

      await settleSuccessfulPlanClaim(supabase, aiUsageClaimId, requestId);

      await recordPlanGenerationObservationSafely(supabase, user?.id, {
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
        diagnostics: {
          scopeBand: planRequest.knowledgeMap?.scopeJudgment.band,
          methodContextStatus: initialPlanContext.status,
          methodContextReason: initialPlanContext.reason,
        },
      });

      return NextResponse.json(response, {
        headers: {
          "Cache-Control": "no-store",
          "X-Yova-Request-Id": requestId,
        },
      });
    } catch (error) {
      await releaseFailedPlanClaim(supabase, aiUsageClaimId, requestId);
      const failure = error instanceof OpenAINormalPlanFillError ? error : null;
      console.error("YOVA plan generation failed", failure ? {
        requestId,
        reason: failure.reason,
        model: failure.generationStats.model,
        elapsedMs: failure.generationStats.elapsedMs,
        attempts: failure.generationStats.attempts,
        failedValidator: failure.generationStats.failedValidator,
        ...planFailureDiagnostics(failure),
      } : {
        requestId,
        reason: "provider_error",
        providerCategory: "unknown",
      });
      let plan: ReturnType<typeof buildNormalPlanFromFixedEnvelope>;
      try {
        plan = buildFixedPlan(buildNormalPlanFallbackFill({
          request: planRequest,
          composition: normalPlanComposition,
        }));
      } catch (fallbackError) {
        return deterministicPlanFailureResponse(fallbackError, requestId);
      }
      const response = planDraftResponse({
        plan,
        generation: {
          mode: "system",
          model: null,
          notice: LIVE_AI_PLAN_FALLBACK_NOTICE,
          requestId,
          durationMs: Date.now() - startedAt,
          persistence: "draft",
        },
        planRequest,
        developmentPreview,
        authenticatedUserId: user?.id ?? null,
        issuedAtMs: startedAt,
      });
      const failedStats = failure?.generationStats;
      await recordPlanGenerationObservationSafely(supabase, user?.id, failedStats ? {
        generationType: "plan",
        environment: generationEnvironment(),
        finalOutcome: "fallback",
        firstAttemptPassed: failedStats.firstAttemptPassed,
        failedValidator: failedStats.failedValidator,
        repairAttempted: false,
        repairSucceeded: null,
        elapsedMs: failedStats.elapsedMs,
        attempts: failedStats.attempts,
        inputTokens: failedStats.inputTokens,
        cachedInputTokens: failedStats.cachedInputTokens,
        cacheWriteTokens: failedStats.cacheWriteTokens,
        outputTokens: failedStats.outputTokens,
        model: failedStats.model,
        diagnostics: {
          scopeBand: planRequest.knowledgeMap?.scopeJudgment.band,
          methodContextStatus: initialPlanContext.status,
          methodContextReason: initialPlanContext.reason,
          ...planFailureDiagnostics(failure),
        },
      } : {
        ...emptyPlanObservation(Date.now() - startedAt),
        generationType: "plan",
        environment: generationEnvironment(),
        finalOutcome: "fallback",
        diagnostics: {
          scopeBand: planRequest.knowledgeMap?.scopeJudgment.band,
          methodContextStatus: initialPlanContext.status,
          methodContextReason: initialPlanContext.reason,
        },
      });
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }
  }

  let previewPlan: ReturnType<typeof buildNormalPlanFromFixedEnvelope>;
  try {
    previewPlan = buildFixedPlan(buildNormalPlanFallbackFill({
      request: planRequest,
      composition: normalPlanComposition,
    }));
  } catch (error) {
    return deterministicPlanFailureResponse(error, requestId);
  }
  const response = planDraftResponse({
    plan: previewPlan,
    generation: {
      mode: "preview",
      model: null,
      notice: "This plan used YOVA's validated preview engine. Live AI generation becomes available when the server API key is connected.",
      requestId,
      durationMs: Date.now() - startedAt,
      persistence: "draft",
    },
    planRequest,
    developmentPreview,
    authenticatedUserId: user?.id ?? null,
    issuedAtMs: startedAt,
  });

  await recordPlanGenerationObservationSafely(supabase, user?.id, {
    ...emptyPlanObservation(Date.now() - startedAt),
    generationType: "plan",
    environment: generationEnvironment(),
    finalOutcome: "success",
    diagnostics: {
      methodContextStatus: initialPlanContext.status,
      methodContextReason: initialPlanContext.reason,
    },
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function expiredMaterialResponse(requestId: string) {
  return NextResponse.json({
    error: "A pending source expired or is no longer available. Add that source again before building the plan.",
    code: "material_staging_expired",
  }, {
    status: 410,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function insufficientNormalSessionTimeResponse(
  availableMinutes: number,
  requestId: string,
) {
  return NextResponse.json({
    error: `YOVA needs at least ${NORMAL_STUDY_DURATION_LEVELS[0]} minutes for a normal learning or practice session.`,
    code: "insufficient_normal_session_time",
    minimumMinutes: NORMAL_STUDY_DURATION_LEVELS[0],
    availableMinutes,
  }, {
    status: 422,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

async function settleSuccessfulPlanClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null,
  claimId: string | null,
  requestId: string,
) {
  if (!supabase || !claimId) return;
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful plan-generation allowance claim", { requestId });
    }
  } catch {
    console.error("YOVA could not settle a successful plan-generation allowance claim", { requestId });
  }
}

async function recordPlanGenerationObservationSafely(
  ...args: Parameters<typeof recordGenerationObservation>
) {
  try {
    await recordGenerationObservation(...args);
  } catch {
    // Analytics is best-effort and must never suppress a validated learner response.
  }
}

async function releaseFailedPlanClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null,
  claimId: string | null,
  requestId: string,
) {
  if (!supabase || !claimId) return;
  try {
    await releaseAIRequestClaim(supabase, claimId);
  } catch {
    console.error("YOVA could not return a failed plan-generation allowance claim", { requestId });
  }
}

async function recoverUnknownPlanReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await releaseAIRequestReservation(supabase, "plan_generation", operationKey, recoveryKey);
  } catch {
    // Its short database lease remains the final recovery boundary.
  }
}

function readMaterialUnderstanding(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = MaterialUnderstandingSchema.safeParse((metadata as Record<string, unknown>).materialUnderstanding);
  return parsed.success ? parsed.data : null;
}

function buildDevelopmentPreviewKnowledgeMap(
  request: Parameters<typeof generatePreviewPlan>[0],
): Awaited<ReturnType<typeof generatePlanKnowledgeMap>> {
  // The preview planner is used here only as a deterministic semantic seed.
  // Its legacy scheduler must not decide whether the later fixed-envelope
  // composer has enough capacity: canonical durations can pack more than one
  // coherent session into a learner window and can explicitly defer tail
  // targets. Give this semantic-only pass a deadline-free synthetic horizon,
  // then compose the real schedule from the original request below.
  const semanticSeedRequest = request.intent === "plan"
    ? {
        ...request,
        deadline: null,
        availability: [{
          day: "Every day",
          window: "Anytime",
          minutes: 60,
        }],
      }
    : request;
  const preview = generatePreviewPlan(semanticSeedRequest);
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
      curriculumRecognized: false,
      curriculumId: null,
      curriculumMatchSource: null,
      curriculumMatchConfidence: null,
    },
  };
}

function personalizationForPlanRequest(
  personalization: Awaited<ReturnType<
    typeof loadAuthorizedNormalDurationContext
  >>["methodEvidence"]["personalization"],
  planRequest: Pick<PlanGenerationRequest, "previewPreferredMethodIds">,
  developmentPreview: boolean,
) {
  if (
    !developmentPreview
    || planRequest.previewPreferredMethodIds === undefined
  ) return personalization;
  return projectPreviewPreferredMethodsForGeneration(
    personalization,
    planRequest.previewPreferredMethodIds,
  );
}

function studyNowMethodDecision({
  route,
  planRequest,
  context,
  developmentPreview,
}: {
  route: StudyRoute;
  planRequest: PlanGenerationRequest;
  context: Awaited<ReturnType<typeof loadAuthorizedNormalDurationContext>>;
  developmentPreview: boolean;
}) {
  return {
    selection: selectCanonicalStudyMethod({
      ...methodSelectionContextForStudyRoute(route),
      learnerChoice: planRequest.methodChoice
        ? {
            methodId: planRequest.methodChoice.methodId,
            evidenceRef: `learner-choice:study-now:${planRequest.methodChoice.methodId}`,
          }
        : null,
      personalization: personalizationForPlanRequest(
        context.methodEvidence.personalization,
        planRequest,
        developmentPreview,
      ),
      observedEvidence: context.methodEvidence.observedEvidence,
    }),
    profileVersion: context.methodProfileVersion,
  };
}

async function reliableDraftResponse(
  planRequest: Parameters<typeof generatePreviewPlan>[0],
  requestId: string,
  startedAt: number,
  notice: string,
  supabase: Parameters<typeof recordGenerationObservation>[0],
  userId: string | null | undefined,
  failure?: OpenAIPlanGenerationError,
  developmentPreview = false,
  initialPlanContext?: Awaited<ReturnType<typeof loadAuthorizedNormalDurationContext>>,
) {
  let reliablePlan: ReturnType<typeof generatePreviewPlan>;
  let resolvedInitialPlanContext = initialPlanContext;
  try {
    const reliableNow = new Date(startedAt);
    reliablePlan = generatePreviewPlan(planRequest, reliableNow);
    resolvedInitialPlanContext ??= await loadAuthorizedNormalDurationContext(
      developmentPreview
        ? { developmentPreview: true, now: reliableNow }
        : supabase && userId
          ? { supabase, authenticatedUserId: userId, now: reliableNow }
          : { now: reliableNow },
    );
    if (planRequest.intent === "plan") {
      reliablePlan = integrateInitialPlanMethodRoutes({
        plan: reliablePlan,
        request: planRequest,
        context: {
          profileVersion: resolvedInitialPlanContext.methodProfileVersion,
          personalization: personalizationForPlanRequest(
            resolvedInitialPlanContext.methodEvidence.personalization,
            planRequest,
            developmentPreview,
          ),
          observedEvidence: resolvedInitialPlanContext.methodEvidence.observedEvidence,
        },
      });
    } else {
      const route = StudyRouteSchema.parse(reliablePlan.sessions[0]!.studyRoute);
      reliablePlan = generatePreviewPlan(planRequest, reliableNow, {
        studyNowMethodDecision: studyNowMethodDecision({
          route,
          planRequest,
          context: resolvedInitialPlanContext,
          developmentPreview,
        }),
      });
    }
  } catch (error) {
    return deterministicPlanFailureResponse(error, requestId);
  }
  const response = planDraftResponse({
    plan: reliablePlan,
    generation: {
      mode: "system",
      model: null,
      notice,
      requestId,
      durationMs: Date.now() - startedAt,
      persistence: "draft",
    },
    planRequest,
    developmentPreview,
    authenticatedUserId: userId ?? null,
    issuedAtMs: startedAt,
  });

  const failedStats = failure?.generationStats;
  await recordPlanGenerationObservationSafely(supabase, userId, failedStats ? {
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
    model: failedStats.model,
    diagnostics: {
      scopeBand: planRequest.knowledgeMap?.scopeJudgment.band,
      methodContextStatus: resolvedInitialPlanContext?.status,
      methodContextReason: resolvedInitialPlanContext?.reason,
      ...planFailureDiagnostics(failure),
    },
  } : {
    ...emptyPlanObservation(Date.now() - startedAt),
    generationType: "plan",
    environment: generationEnvironment(),
    finalOutcome: "fallback",
    diagnostics: resolvedInitialPlanContext ? {
      methodContextStatus: resolvedInitialPlanContext.status,
      methodContextReason: resolvedInitialPlanContext.reason,
    } : undefined,
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function planDraftResponse({
  plan,
  generation,
  planRequest,
  developmentPreview,
  authenticatedUserId,
  issuedAtMs,
}: {
  plan: unknown;
  generation: Omit<PlanGenerationResponse["generation"], "draftReceipt">;
  planRequest: Parameters<typeof generatePreviewPlan>[0];
  developmentPreview: boolean;
  authenticatedUserId: string | null;
  issuedAtMs: number;
}) {
  const unsigned = PlanGenerationResponseSchema.parse({
    plan,
    generation: { ...generation, draftReceipt: null },
  });
  if (developmentPreview) return unsigned;
  if (!authenticatedUserId) {
    throw new PlanDraftReceiptConfigurationError(
      "An authenticated account is required to issue a plan draft receipt.",
    );
  }
  const issued = issuePlanDraftReceipt({
    parsedPlan: unsigned.plan,
    normalizedGenerationContract: normalizePlanDraftGenerationContract(
      planRequest,
      unsigned.plan,
    ),
    authenticatedUserId,
    issuedAt: issuedAtMs,
    expiresAt: issuedAtMs + PLAN_DRAFT_RECEIPT_LIFETIME_MS,
  });
  return PlanGenerationResponseSchema.parse({
    ...unsigned,
    generation: { ...unsigned.generation, draftReceipt: issued.receipt },
  });
}

function draftReceiptUnavailableResponse(requestId: string) {
  return NextResponse.json({
    error: "YOVA cannot secure a plan draft for activation right now. Try again after the server connection is restored.",
    code: "draft_receipt_unavailable",
  }, {
    status: 503,
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

/**
 * The deterministic generator validates its own output, so any shape it cannot
 * satisfy throws. Left uncaught the throw leaves the route with no body at all,
 * which reaches the learner as "Unexpected end of JSON input" and tells them
 * nothing about what to change.
 */
function deterministicPlanFailureResponse(error: unknown, requestId: string) {
  if (
    error instanceof CanonicalMethodSelectionError
    && error.code === "learner_choice_ineligible"
  ) {
    return NextResponse.json(
      {
        error: "That method does not fit this session's task and current starting point. Choose one of the alternatives YOVA showed.",
        code: "method_choice_ineligible",
      },
      { status: 422, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
  if (error instanceof PlanScheduleCapacityError) {
    return NextResponse.json(
      {
        error: "Your selected study windows do not have enough room for this plan before the deadline. Add another day, choose longer windows, or move the deadline.",
        code: "schedule_capacity",
      },
      { status: 422, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
  if (
    error instanceof NormalPlanEnvelopeComposerError
    && [
      "no_normal_session_capacity",
      "scope_minimum_unreachable",
      "minimum_teaching_unreachable",
    ].includes(error.code)
  ) {
    return NextResponse.json(
      {
        error: "Your selected study windows do not have enough room for this plan before the deadline. Add another day, choose longer windows, or move the deadline.",
        code: "schedule_capacity",
      },
      { status: 422, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  console.error("YOVA plan generation failed", {
    requestId,
    reason: error instanceof Error ? error.message : String(error),
  });

  return NextResponse.json(
    { error: "YOVA could not build a plan for this goal. Try describing it in a shorter sentence." },
    { status: 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
  );
}

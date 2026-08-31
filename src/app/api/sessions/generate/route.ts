import { NextResponse } from "next/server";
import type { SessionCompletion, SessionInterruption } from "@/lib/domain";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservationAfterResponse } from "@/lib/analytics/generation-observation-server";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import {
  buildTopicMaterialExcerpts,
  type TopicMaterialChunkRow,
} from "@/lib/materials/context";
import { readConceptEvidenceProperty, summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import {
  buildTopicCalibrationSignals,
  readConfidenceEvidenceProperty,
  summarizeConfidenceCalibration,
} from "@/lib/learning/confidence-calibration";
import {
  inferLegacySessionLearningMode,
  inferSessionFamiliarityFromText,
  resolveEffectiveSessionLearningMode,
  teachingFirstSessionCopy,
} from "@/lib/learning/learning-intent";
import {
  inferKnowledgeStage,
  inferLearningTaskType,
  methodIdFromText,
} from "@/lib/learning/method-router";
import {
  legacyScheduledRetrievalTopic,
  learningModeForScheduledRetrieval,
  scheduledRetrievalAdjustmentIssue,
} from "@/lib/learning/scheduled-retrieval";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import { getOpenAISessionConfig, isOpenAISessionConfigured } from "@/lib/openai/config";
import {
  generateProductionSessionWithOpenAI,
} from "@/lib/openai/session-generation-strategy";
import {
  SESSION_GENERATION_SERVER_BUDGET_MS,
  SESSION_GENERATION_SETTLEMENT_RESERVE_MS,
  SessionGenerationFailure,
  type SessionGenerationCause,
  type SessionGenerationContext,
  type SessionGenerationStage,
  type SessionGenerationStats,
} from "@/lib/openai/session-generator";
import {
  expandedLearnerContextFromAnswers,
  mergeStoredAdditionalContext,
  personalizationSignalAllowsRuntimeInference,
  statedOnboardingAnswerForRuntime,
} from "@/lib/personalization/learner-profile";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";
import { resolvePersonalizationForGeneration } from "@/lib/personalization/personalization-generation";
import {
  CachedGeneratedSessionSchema,
  CachedGeneratedSessionV15Schema,
  CachedGeneratedSessionV17Schema,
  SessionGenerationRequestSchema,
  SessionGenerationResponseSchema,
  type SessionGenerationRequest,
} from "@/lib/session-generation/schema";
import { cachedSessionActivityContractIssue } from "@/lib/session-generation/cache-activity-contract";
import {
  expectedSessionCacheVersion,
  sessionCacheContractKey,
} from "@/lib/session-generation/cache-contract";
import { generatedSessionDefersStoredPlanTargets } from "@/lib/session-generation/deferred-cache-contract";
import {
  guidedSessionAllowanceExhaustedHeaders,
  guidedSessionAllowanceExhaustedResponse,
  guidedSessionFailureResponse,
} from "@/lib/session-generation/failure-message";
import {
  resolveSessionArchitectureVersion,
  sessionArchitectureForGeneration,
} from "@/lib/session-generation/architecture";
import { checkSessionGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import {
  releaseAIRequestClaim,
  releaseAIRequestReservation,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import {
  classifyOperationalPlanSession,
  sessionCacheFailureMustFailClosed,
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import {
  buildSessionCacheContext,
  sessionCacheContextMatches,
  sessionCacheRouteRevisionMatches,
  type SessionCacheContext,
} from "@/lib/server/session-cache-context";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { privacySafeErrorDiagnostic } from "@/lib/server/error-diagnostic";
import { readOptionalSessionPersonalizationHistory } from "@/lib/server/session-personalization-history";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { blurtingSessionGenerationContract } from "@/lib/study-route/blurting-session-generation-contract";
import {
  studyRouteFromPersistenceRow,
  type PersistedStudyRouteRow,
} from "@/lib/study-route/persistence";
import type { StudyRoute } from "@/lib/study-route/schema";
import { generatedSessionStudyRouteIssue } from "@/lib/study-route/generation-contract";
import { studyRouteGenerationProjection } from "@/lib/study-route/generation-projection";
import {
  buildNormalPlanJourneyGenerationCopy,
  resolveNormalPlanGenerationCopy,
} from "@/lib/study-route/normal-plan-generation-copy";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";
import { studyRouteSourceBindingIssue } from "@/lib/study-route/source-contract";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = generationRequestId(request);
  const startedAt = Date.now();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (!developmentPreview && supabase && (userError || !user)) {
    return NextResponse.json({ error: "Sign in to generate this guided session." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The session request was not valid JSON." }, { status: 400 });
  }

  const parsed = SessionGenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "YOVA could not identify the requested plan session." }, { status: 422 });
  }

  const inferredFamiliarity = parsed.data.sessionAdjustment
    ? inferSessionFamiliarityFromText(parsed.data.sessionAdjustment.note)
    : null;
  const sessionAdjustment = parsed.data.sessionAdjustment
    ? {
      ...parsed.data.sessionAdjustment,
      familiarity: parsed.data.sessionAdjustment.familiarity === "as_planned" && inferredFamiliarity
        ? inferredFamiliarity
        : parsed.data.sessionAdjustment.familiarity,
    }
    : undefined;
  const normalizedInput: SessionGenerationRequest = {
    ...parsed.data,
    sessionAdjustment,
  };

  if (developmentPreview || !supabase || !user) {
    return generateBrowserPreviewSession(request, normalizedInput, requestId, startedAt);
  }
  const recordSignedInPreflightFailure = (
    cause: SessionGenerationCause,
    planSessionId = parsed.data.planSessionId,
  ) => {
    const stats: SessionGenerationStats = {
      ...emptyGenerationStats(),
      elapsedMs: Date.now() - startedAt,
      stage: "preflight",
      cause,
    };
    recordGenerationObservationBestEffort(
      supabase,
      user.id,
      observationFromSessionStats(
        stats,
        null,
        "failure",
        requestId,
        planSessionId,
      ),
    );
    return stats;
  };

  const { data: planSession, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,plan_id,sequence,status,title,objective,method,method_rationale,estimated_minutes,step_data,updated_at,committed_route_revision_id")
    .eq("id", parsed.data.planSessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionError) {
    const failureStats = recordSignedInPreflightFailure("unexpected");
    return NextResponse.json(
      { error: "YOVA could not load this plan session." },
      { status: 500, headers: responseHeaders(requestId, failureStats) },
    );
  }
  if (!planSession || planSession.plan_id !== parsed.data.planId) {
    const failureStats = recordSignedInPreflightFailure("authorization");
    return NextResponse.json(
      { error: "That guided session was not found." },
      { status: 404, headers: responseHeaders(requestId, failureStats) },
    );
  }
  const recordPreflightFailure = (cause: SessionGenerationCause) => (
    recordSignedInPreflightFailure(cause, planSession.id)
  );
  const committedRouteRevisionId = typeof planSession.committed_route_revision_id === "string"
    ? planSession.committed_route_revision_id
    : null;
  if (committedRouteRevisionId !== (normalizedInput.routeRevisionId ?? null)) {
    const failureStats = recordPreflightFailure("route_conflict");
    return NextResponse.json({
      code: "study_route_revision_conflict",
      error: "This session's study route changed. Return to setup and use the current plan.",
      retryable: false,
    }, {
      status: 409,
      headers: responseHeaders(requestId, failureStats),
    });
  }
  let committedStudyRoute: StudyRoute | null = null;
  if (committedRouteRevisionId) {
    const { data: routeRow, error: routeError } = await supabase
      .from("study_routes")
      .select("route_revision_id,route_lineage_id,revision_number,schema_version,lifecycle,plan_id,plan_session_id,predecessor_revision_id,route_payload,created_at,committed_at")
      .eq("route_revision_id", committedRouteRevisionId)
      .eq("plan_session_id", planSession.id)
      .eq("plan_id", planSession.plan_id)
      .eq("user_id", user.id)
      .eq("lifecycle", "committed")
      .maybeSingle();
    if (routeError) {
      const failureStats = recordPreflightFailure("route_conflict");
      return NextResponse.json(
        { error: "YOVA could not load this session's committed study route." },
        { status: 500, headers: responseHeaders(requestId, failureStats) },
      );
    }
    committedStudyRoute = routeRow
      ? studyRouteFromPersistenceRow(routeRow as PersistedStudyRouteRow)
      : null;
    if (
      !committedStudyRoute
      || committedStudyRoute.identity.routeRevisionId !== committedRouteRevisionId
      || committedStudyRoute.identity.planId !== planSession.plan_id
      || committedStudyRoute.identity.sessionId !== planSession.id
      || committedStudyRoute.identity.lifecycleStatus !== "committed"
    ) {
      const failureStats = recordPreflightFailure("route_conflict");
      return NextResponse.json({
        code: "study_route_payload_unavailable",
        error: "This session's committed study route is unavailable. Rebuild the plan before starting it.",
        retryable: false,
      }, {
        status: 409,
        headers: responseHeaders(requestId, failureStats),
      });
    }
  }
  const blurtingGenerationContract = blurtingSessionGenerationContract(
    committedStudyRoute,
    {
      planId: normalizedInput.planId,
      sessionId: normalizedInput.planSessionId,
      routeRevisionId: normalizedInput.routeRevisionId ?? "",
    },
  );
  if (blurtingGenerationContract) {
    recordPreflightFailure("route_conflict");
    return blurtingRuntimeUnavailableResponse(requestId);
  }
  const reviewType = readReviewType(planSession.step_data);
  const scheduledAdjustmentIssue = scheduledRetrievalAdjustmentIssue(
    { reviewType },
    sessionAdjustment,
  );
  if (scheduledAdjustmentIssue) {
    const failureStats = recordPreflightFailure("route_conflict");
    return NextResponse.json({
      code: "scheduled_review_adjustment_not_supported",
      error: scheduledAdjustmentIssue,
      retryable: false,
    }, {
      status: 409,
      headers: responseHeaders(requestId, failureStats),
    });
  }

  let aiUsageClaimId: string | null = null;
  let completedGeneration: {
    model: string;
    generationStats: SessionGenerationStats;
  } | null = null;
  try {
    const [{ data: plan, error: planError }, { data: learnerProfile, error: learnerError }, { data: planSessionRows, error: planSessionsError }] = await Promise.all([
      supabase
        .from("plans")
        .select("learning_item_id,status,rationale,generation_inputs,knowledge_map,updated_at")
        .eq("id", parsed.data.planId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("learner_profiles")
        .select("common_blocker,guidance_preference,explanation_preference,focus_frequency,starting_pattern,primary_improvement_goal,additional_context")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("plan_sessions")
        .select("id,sequence,status,title,objective,method,step_data")
        .eq("plan_id", parsed.data.planId)
        .eq("user_id", user.id)
        .order("sequence", { ascending: true }),
    ]);

    if (planError || learnerError || planSessionsError) throw planError ?? learnerError ?? planSessionsError;
    if (!plan) {
      const failureStats = recordPreflightFailure("authorization");
      return NextResponse.json(
        { error: "That learning plan was not found." },
        { status: 404, headers: responseHeaders(requestId, failureStats) },
      );
    }
    const operationAccess = classifyOperationalPlanSession({
      requestedPlanId: parsed.data.planId,
      sessionPlanId: planSession.plan_id,
      planStatus: plan.status,
      sessionStatus: planSession.status,
    });
    if (!operationAccess.allowed) {
      const failure = sessionOperationFailure(operationAccess);
      const failureStats = recordPreflightFailure("authorization");
      return NextResponse.json(
        { error: failure.error },
        { status: failure.status, headers: responseHeaders(requestId, failureStats) },
      );
    }

    const [
      { data: learningItem, error: itemError },
      { data: materialRows, error: materialsError },
      personalizationHistory,
    ] = await Promise.all([
      supabase
        .from("learning_items")
        .select("title,topic,kind,deadline,source_mode,study_mode,updated_at")
        .eq("id", plan.learning_item_id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("materials")
        .select("id,filename")
        .eq("learning_item_id", plan.learning_item_id)
        .eq("user_id", user.id)
        .eq("processing_status", "ready")
        .order("created_at", { ascending: true })
        .limit(5),
      readOptionalSessionPersonalizationHistory(supabase, {
        userId: user.id,
        planSessionIds: (planSessionRows ?? []).map((session) => session.id),
      }),
    ]);

    if (itemError || materialsError) {
      throw itemError ?? materialsError;
    }
    if (personalizationHistory.degradedSources.length > 0) {
      console.warn("YOVA generated a session without some optional personalization history", {
        requestId,
        sources: personalizationHistory.degradedSources,
      });
    }
    if (!learningItem) {
      const failureStats = recordPreflightFailure("authorization");
      return NextResponse.json(
        { error: "That learning goal was not found." },
        { status: 404, headers: responseHeaders(requestId, failureStats) },
      );
    }

    const parsedKnowledgeMap = PlanKnowledgeMapSchema.safeParse(plan.knowledge_map);
    if (!parsedKnowledgeMap.success) {
      const failureStats = recordPreflightFailure("route_conflict");
      return NextResponse.json(
        { error: "This plan needs its topic map rebuilt before YOVA can prepare the session." },
        { status: 409, headers: responseHeaders(requestId, failureStats) },
      );
    }
    const plannedTopicIds = committedStudyRoute
      ? activeStudyRouteTargetIds(committedStudyRoute)
      : readStringArrayProperty(planSession.step_data, "topicIds");
    const reviewConcept = readTextProperty(planSession.step_data, "reviewConcept") || null;
    // Preserve the session's persisted topic order. Knowledge-map order is a
    // separate hierarchy and must never silently become evidence-attribution
    // order for the session's content targets.
    const explicitlySelectedTopics = plannedTopicIds.flatMap((topicId) => {
      const topic = parsedKnowledgeMap.data.topics.find((candidate) => candidate.id === topicId);
      return topic ? [topic] : [];
    });
    const exactExplicitTopicResolution = plannedTopicIds.length === 0 || (
      new Set(plannedTopicIds).size === plannedTopicIds.length
      && explicitlySelectedTopics.length === plannedTopicIds.length
      && explicitlySelectedTopics.every((topic, index) => topic.id === plannedTopicIds[index])
    );
    if (!exactExplicitTopicResolution) {
      const failureStats = recordPreflightFailure("route_conflict");
      return NextResponse.json(
        { error: "This session's exact topic links changed. Rebuild the plan before starting it." },
        { status: 409, headers: responseHeaders(requestId, failureStats) },
      );
    }
    const legacyReviewTopic = plannedTopicIds.length === 0
      ? legacyScheduledRetrievalTopic({
        session: { reviewType, reviewConcept },
        knowledgeTopics: parsedKnowledgeMap.data.topics,
      })
      : null;
    const selectedTopics = explicitlySelectedTopics.length > 0
      ? explicitlySelectedTopics
      : legacyReviewTopic ? [legacyReviewTopic] : [];
    if (selectedTopics.length === 0) {
      const failureStats = recordPreflightFailure("route_conflict");
      return NextResponse.json(
        { error: "This session is not linked to a topic in the plan yet." },
        { status: 409, headers: responseHeaders(requestId, failureStats) },
      );
    }
    const orderedChunkIds = Array.from(new Set(
      selectedTopics.flatMap((topic) => topic.sourceReferences.map((reference) => reference.chunkId)),
    ));
    const chunkResult = orderedChunkIds.length > 0
      ? await supabase
        .from("material_chunks")
        .select("id,material_id,chunk_index,location_label,section_role,chunk_text")
        .eq("user_id", user.id)
        .in("id", orderedChunkIds)
      : { data: [], error: null };
    if (chunkResult.error) throw chunkResult.error;
    const returnedChunkIds = new Set((chunkResult.data ?? []).map((chunk) => chunk.id));
    const missingChunkIds = orderedChunkIds.filter((chunkId) => !returnedChunkIds.has(chunkId));
    if (missingChunkIds.length > 0) {
      const failureStats = recordPreflightFailure("source_unavailable");
      return NextResponse.json(
        { error: "YOVA could not retrieve all of the mapped source sections for this topic. Reprocess the material before starting this session." },
        { status: 409, headers: responseHeaders(requestId, failureStats) },
      );
    }
    const materialExcerpts = buildTopicMaterialExcerpts({
      chunkRows: (chunkResult.data ?? []) as TopicMaterialChunkRow[],
      materialNames: new Map((materialRows ?? []).map((material) => [material.id, material.filename])),
      orderedChunkIds,
    }).filter((excerpt) => excerpt.text.trim().length >= 12);
    if (orderedChunkIds.length > 0 && materialExcerpts.length !== orderedChunkIds.length) {
      const failureStats = recordPreflightFailure("source_unavailable");
      return NextResponse.json(
        { error: "A mapped source section is empty. Reprocess the material before starting this session." },
        { status: 409, headers: responseHeaders(requestId, failureStats) },
      );
    }
    // A topic with mapped chunks must use those exact chunks. AI-origin topics
    // have no source references and are intentionally taught from model knowledge.
    const effectiveSourceMode = orderedChunkIds.length > 0
      ? "user_materials"
      : "yova_generated";
    const routeSourceIssue = studyRouteSourceBindingIssue(committedStudyRoute, {
      readyMaterialIds: (materialRows ?? []).map((material) => material.id),
      selectedChunkMaterialIds: (chunkResult.data ?? []).map((chunk) => chunk.material_id),
    });
    if (routeSourceIssue) {
      const failureStats = recordPreflightFailure("source_unavailable");
      return NextResponse.json({
        code: "study_route_source_conflict",
        error: `${routeSourceIssue} Rebuild the plan before starting it.`,
        retryable: false,
      }, {
        status: 409,
        headers: responseHeaders(requestId, failureStats),
      });
    }

    const recentAttempts = personalizationHistory.planAttempts;
    const methodIdBySession = new Map(
      (planSessionRows ?? []).map((session) => [
        session.id,
        readMethodId(session.step_data, session.method),
      ]),
    );
    const comparisonContextBySession = new Map(
      (planSessionRows ?? []).map((session) => [
        session.id,
        readCompletedSessionComparisonContext(
          session.step_data,
          session.method,
          session.title,
          session.objective,
        ),
      ]),
    );
    const planLearningIntent = readLearningIntent(plan.generation_inputs);
    const storedSessionArchitectureVersion = resolveSessionArchitectureVersion(
      plan.generation_inputs,
      parsedKnowledgeMap.data,
    );
    const savedLearningMode = committedStudyRoute
      ? committedStudyRoute.approach.mode === "learn" ? "learn" : "study"
      : readSessionLearningMode(
        planSession.step_data,
        planSession.method,
        planSession.objective,
      );
    const effectiveSessionAdjustment = sessionAdjustment ?? null;
    const requestedLearningMode = committedStudyRoute
      ? savedLearningMode
      : resolveEffectiveSessionLearningMode({
        planLearningIntent,
        plannedMode: savedLearningMode,
        completedSessionCount: recentAttempts.length,
        familiarity: effectiveSessionAdjustment?.familiarity ?? null,
      });
    const effectiveLearningMode = learningModeForScheduledRetrieval(
      { reviewType },
      requestedLearningMode,
    );
    const repairedTeachingStart = !committedStudyRoute
      && effectiveLearningMode === "learn" && savedLearningMode !== "learn"
      ? teachingFirstSessionCopy(learningItem.topic)
      : null;
    const effectiveStudyMode = committedStudyRoute?.approach.executionEnvironment
      ?? learningItem.study_mode;
    const sessionArchitectureVersion = sessionArchitectureForGeneration({
      storedVersion: storedSessionArchitectureVersion,
      learningMode: effectiveLearningMode,
      studyMode: effectiveStudyMode,
      reviewType,
      selectedMethodId: committedStudyRoute?.approach.primaryMethodId,
    });
    const expectedCacheVersion = expectedSessionCacheVersion({
      sessionArchitectureVersion,
      learningMode: effectiveLearningMode,
      studyMode: effectiveStudyMode,
      reviewType,
    });
    const plannedContentTargets = readStringArrayProperty(planSession.step_data, "contentTargets");
    const normalPlanGenerationCopy = resolveNormalPlanGenerationCopy({
      route: committedStudyRoute,
      selectedTopics,
      contentTargets: plannedContentTargets,
    });
    const plannedCompletionEvidence = committedStudyRoute
      ? committedStudyRoute.execution.completionEvidence.map((evidence) => evidence.description)
      : readStringArrayProperty(planSession.step_data, "completionEvidence");
    const routeGeneration = studyRouteGenerationProjection({
      route: committedStudyRoute,
      legacy: {
        objective: repairedTeachingStart?.objective ?? planSession.objective,
        method: repairedTeachingStart?.method ?? planSession.method,
        methodReason: repairedTeachingStart?.methodReason ?? planSession.method_rationale,
        activeMinutes: planSession.estimated_minutes,
        learningMode: effectiveLearningMode,
        executionEnvironment: effectiveStudyMode,
        topicIds: selectedTopics.map((topic) => topic.id),
        completionEvidence: plannedCompletionEvidence,
      },
    });
    const requestedCacheContext = buildSessionCacheContext({
      plannedMinutes: routeGeneration.activeMinutes,
      adjustment: committedStudyRoute && effectiveSessionAdjustment
        ? { ...effectiveSessionAdjustment, availableMinutes: committedStudyRoute.timing.activeMinutes }
        : effectiveSessionAdjustment,
      routeRevisionId: normalizedInput.routeRevisionId,
      contractKey: sessionCacheContractKey({
        reviewType,
        reviewConcept,
        title: normalPlanGenerationCopy?.sessionTitle ?? planSession.title,
        methodReason: routeGeneration.methodReason,
        topicIds: selectedTopics.map((topic) => topic.id),
        contentTargets: plannedContentTargets,
        completionEvidence: plannedCompletionEvidence,
        knowledgeTopics: selectedTopics,
      }),
    });
    const cached = readCachedSession(planSession.step_data, expectedCacheVersion);
    const cachedActivityContractIssue = cached
      ? cachedSessionActivityContractIssue(cached, {
        reviewType,
        reviewConcept,
        estimatedMinutes: routeGeneration.activeMinutes,
      })
      : null;
    const cachedRouteContractIssue = cached
      ? generatedSessionStudyRouteIssue(cached, committedStudyRoute)
      : null;
    if (
      cached
      && !cachedActivityContractIssue
      && !cachedRouteContractIssue
      && (cached.schemaVersion === 17
        ? sessionCacheContextMatches(cached.cacheContext, requestedCacheContext)
        : cached.schemaVersion === 15 && !effectiveSessionAdjustment && (
          (!cached.cacheContext && requestedCacheContext.contractFingerprint === undefined)
          || sessionCacheContextMatches(cached.cacheContext, requestedCacheContext)
        ))
      && sessionCacheRouteRevisionMatches(
        cached.routeRevisionId,
        "cacheContext" in cached ? cached.cacheContext?.routeRevisionId : undefined,
        requestedCacheContext.routeRevisionId,
      )
      && cached.methodBriefing.learningMode === effectiveLearningMode
    ) {
      recordGenerationObservationBestEffort(supabase, user.id, {
        ...emptySessionObservation(Date.now() - startedAt),
        generationType: "session",
        environment: generationEnvironment(),
        finalOutcome: "cache",
        diagnostics: {
          sessionRequestId: requestId,
          planSessionId: planSession.id,
          sessionPersistence: "cache_hit",
        },
      });
      return NextResponse.json(SessionGenerationResponseSchema.parse({
        planSessionId: planSession.id,
        session: cached,
        generation: { mode: "cache", persistence: "supabase" },
      }), { headers: responseHeaders(requestId, emptyGenerationStats()) });
    }

    if (!isOpenAISessionConfigured()) {
      const failureStats = recordPreflightFailure("provider_unconfigured");
      return NextResponse.json(
        { error: "Live guided-session generation is not connected yet." },
        { status: 503, headers: responseHeaders(requestId, failureStats) },
      );
    }

    const rateLimit = checkSessionGenerationRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
    if (!rateLimit.allowed) {
      const failureStats = recordPreflightFailure("rate_limit");
      return NextResponse.json(
        { error: "Too many sessions were generated at once. Wait a moment and try again." },
        {
          status: 429,
          headers: {
            ...responseHeaders(requestId, failureStats),
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    let durableLimit: Awaited<ReturnType<typeof reserveAIRequest>>;
    const aiUsageRecoveryKey = crypto.randomUUID();
    try {
      durableLimit = await reserveAIRequest(supabase, "session_generation", requestId, aiUsageRecoveryKey);
    } catch {
      await recoverUnknownGenerationReservation(supabase, requestId, aiUsageRecoveryKey);
      const failureStats = recordPreflightFailure("unexpected");
      return NextResponse.json(
        { error: "YOVA paused before using OpenAI because it could not verify the account’s AI budget." },
        { status: 503, headers: responseHeaders(requestId, failureStats) },
      );
    }
    if (!durableLimit.allowed) {
      const conflict = aiUsageReservationConflict(durableLimit);
      if (conflict) {
        const failureStats = recordPreflightFailure("reservation_conflict");
        return NextResponse.json(
          {
            code: conflict.code,
            error: conflict.error,
            retryable: conflict.retryable,
          },
          {
            status: 409,
            headers: {
              ...responseHeaders(requestId, failureStats),
              ...(conflict.retryAfterSeconds === null ? {} : {
                "Retry-After": String(conflict.retryAfterSeconds),
              }),
            },
          },
        );
      }
      const failureStats = recordPreflightFailure("quota_exhausted");
      return NextResponse.json(
        guidedSessionAllowanceExhaustedResponse(durableLimit.retryAfterSeconds),
        {
          status: 429,
          headers: {
            ...responseHeaders(requestId, failureStats),
            ...guidedSessionAllowanceExhaustedHeaders(durableLimit.retryAfterSeconds),
          },
        },
      );
    }
    aiUsageClaimId = durableLimit.claimId;
    const completionEvidence = recentAttempts.map((attempt) => ({
      completedAt: attempt.completed_at ?? new Date(0).toISOString(),
      conceptEvidence: readConceptEvidenceProperty(attempt.result_data),
    }));
    const confidenceEvidence = recentAttempts.flatMap((attempt) => (
      readConfidenceEvidenceProperty(attempt.result_data)
    ));
    const storedLearnerAnswers = mergeStoredAdditionalContext([
      learnerProfile?.common_blocker ?? "",
      learnerProfile?.guidance_preference ?? "",
      "",
      learnerProfile?.explanation_preference ?? "",
      learnerProfile?.focus_frequency ?? "",
      learnerProfile?.starting_pattern ?? "",
      "",
      learnerProfile?.primary_improvement_goal ?? "",
    ], learnerProfile?.additional_context ?? null);
    const personalizationState = readPersonalizationStateFromAnswers(storedLearnerAnswers);
    const statedAnswer = (index: number) => (
      statedOnboardingAnswerForRuntime(storedLearnerAnswers, index, personalizationState)
    );
    const useObservedPacing = personalizationState.controls.behavior
      && personalizationSignalAllowsRuntimeInference(personalizationState, "starting_friction")
      && personalizationSignalAllowsRuntimeInference(personalizationState, "cognitive_stamina");
    const useObservedCalibration = personalizationState.controls.behavior
      && personalizationSignalAllowsRuntimeInference(personalizationState, "calibration_risk");
    const personalizationInterruptionRows = useObservedPacing
      ? personalizationHistory.planInterruptions.filter((event) => {
        const attemptId = readTextProperty(event.event_data, "attemptId");
        return !attemptId || !personalizationState.excludedEvidenceRefs.includes(attemptId);
      })
      : [];
    const expandedProfile = expandedLearnerContextFromAnswers(storedLearnerAnswers);
    const personalizationCompletions = personalizationHistory.accountAttempts
      .flatMap<SessionCompletion>((attempt) => {
        if (!attempt.id || !attempt.plan_session_id || !attempt.started_at || !attempt.completed_at) {
          return [];
        }
        const actualMinutes = attempt.actual_minutes ?? 1;
        return [{
          id: attempt.id,
          planId: "account-wide-personalization",
          planSessionId: attempt.plan_session_id,
          startedAt: attempt.started_at,
          completedAt: attempt.completed_at,
          plannedMinutes: readNumberProperty(attempt.result_data, "plannedMinutes") ?? actualMinutes,
          actualMinutes,
          correctAnswers: attempt.correct_answers ?? 0,
          totalAnswers: attempt.total_answers ?? 0,
          feedback: readSessionFeedback(attempt.user_feedback) ?? "about_right",
          observedGap: readTextProperty(attempt.result_data, "observedGap"),
          conceptEvidence: readConceptEvidenceProperty(attempt.result_data),
          confidenceEvidence: readConfidenceEvidenceProperty(attempt.result_data),
        }];
      });
    const personalizationInterruptions = personalizationHistory.accountInterruptions
      .flatMap<SessionInterruption>((event) => {
        const attemptId = readTextProperty(event.event_data, "attemptId");
        const startedAt = readTextProperty(event.event_data, "startedAt");
        const plannedMinutes = readNumberProperty(event.event_data, "plannedMinutes");
        const actualMinutes = readNumberProperty(event.event_data, "actualMinutes");
        const completedSteps = readNumberProperty(event.event_data, "completedSteps");
        const totalSteps = readNumberProperty(event.event_data, "totalSteps");
        if (
          !event.plan_session_id
          || !attemptId
          || !startedAt
          || plannedMinutes === null
          || actualMinutes === null
          || completedSteps === null
          || totalSteps === null
        ) return [];
        return [{
          id: attemptId,
          planId: "account-wide-personalization",
          planSessionId: event.plan_session_id,
          startedAt,
          interruptedAt: event.occurred_at,
          plannedMinutes,
          actualMinutes,
          completedSteps,
          totalSteps,
        }];
      });
    const generationPersonalization = resolvePersonalizationForGeneration({
      answers: storedLearnerAnswers,
      completions: personalizationCompletions,
      interruptions: personalizationInterruptions,
      plans: [],
    });
    const generationContext: SessionGenerationContext = {
      sessionArchitectureVersion,
      learningGoal: {
        title: normalPlanGenerationCopy?.learningGoalTitle ?? learningItem.title,
        topic: normalPlanGenerationCopy?.learningGoalTopic ?? learningItem.topic,
        kind: learningItem.kind,
        deadline: learningItem.deadline,
        sourceMode: effectiveSourceMode,
        studyMode: routeGeneration.executionEnvironment,
        learningIntent: planLearningIntent,
      },
      planRationale: normalPlanGenerationCopy?.planRationale ?? plan.rationale,
      journey: {
        currentSequence: planSession.sequence,
        totalSessions: planSessionRows?.length ?? 1,
        previousSessions: (planSessionRows ?? [])
          .filter((candidate) => candidate.sequence < planSession.sequence)
          .map((candidate) => {
            const contentTargets = readStringArrayProperty(candidate.step_data, "contentTargets");
            const generationCopy = normalPlanGenerationCopy
              ? buildNormalPlanJourneyGenerationCopy({
                  sequence: candidate.sequence,
                  contentTargets,
                })
              : null;
            return {
              sequence: candidate.sequence,
              title: generationCopy?.title ?? candidate.title,
              objective: generationCopy?.objective ?? candidate.objective,
              status: candidate.status,
              contentTargets,
            };
          }),
        nextSessions: (planSessionRows ?? [])
          .filter((candidate) => candidate.sequence > planSession.sequence)
          .map((candidate) => {
            const contentTargets = readStringArrayProperty(candidate.step_data, "contentTargets");
            const generationCopy = normalPlanGenerationCopy
              ? buildNormalPlanJourneyGenerationCopy({
                  sequence: candidate.sequence,
                  contentTargets,
                })
              : null;
            return {
              sequence: candidate.sequence,
              title: generationCopy?.title ?? candidate.title,
              objective: generationCopy?.objective ?? candidate.objective,
              contentTargets,
            };
          }),
      },
      materials: materialExcerpts,
      knowledgeTopics: selectedTopics,
      session: {
        title: normalPlanGenerationCopy?.sessionTitle ?? planSession.title,
        objective: routeGeneration.objective,
        method: routeGeneration.method,
        methodReason: routeGeneration.methodReason,
        estimatedMinutes: routeGeneration.activeMinutes,
        learningMode: routeGeneration.learningMode,
        topicIds: routeGeneration.topicIds,
        contentTargets: plannedContentTargets,
        completionEvidence: routeGeneration.completionEvidence,
        reviewConcept,
        reviewType,
      },
      studyRoute: committedStudyRoute,
      learnerProfile: learnerProfile ? {
        commonBlocker: statedAnswer(0),
        guidancePreference: statedAnswer(1),
        explanationPreference: statedAnswer(3),
        focusFrequency: statedAnswer(4),
        startingPattern: statedAnswer(5),
        primaryImprovementGoal: statedAnswer(7),
        ...expandedProfile,
      } : null,
      sessionAdjustment: effectiveSessionAdjustment,
      recentResults: recentAttempts.slice(0, 8).map((attempt) => ({
        methodId: methodIdBySession.get(attempt.plan_session_id) ?? null,
        taskType: comparisonContextBySession.get(attempt.plan_session_id)?.taskType ?? null,
        knowledgeStage: comparisonContextBySession.get(attempt.plan_session_id)?.knowledgeStage ?? null,
        correctAnswers: attempt.correct_answers,
        totalAnswers: attempt.total_answers,
        feedback: readSessionFeedback(attempt.user_feedback),
        observedGap: readTextProperty(attempt.result_data, "observedGap") || null,
        plannedMinutes: useObservedPacing
          ? readNumberProperty(attempt.result_data, "plannedMinutes")
          : null,
        actualMinutes: useObservedPacing ? attempt.actual_minutes : null,
        calibrationPattern: useObservedCalibration
          ? summarizeConfidenceCalibration(
            readConfidenceEvidenceProperty(attempt.result_data),
          ).pattern
          : "insufficient",
      })),
      recentInterruptions: personalizationInterruptionRows.slice(0, 4).map((event) => ({
        occurredAt: event.occurred_at,
        plannedMinutes: readNumberProperty(event.event_data, "plannedMinutes"),
        actualMinutes: readNumberProperty(event.event_data, "actualMinutes"),
        completedSteps: readNumberProperty(event.event_data, "completedSteps"),
        totalSteps: readNumberProperty(event.event_data, "totalSteps"),
      })),
      conceptSignals: summarizeConceptEvidence(completionEvidence).slice(0, 20),
      scaffoldSignals: buildScaffoldProgressionSignals(completionEvidence).slice(0, 20),
      topicCalibrationSignals: buildTopicCalibrationSignals(confidenceEvidence).slice(0, 20),
      personalization: generationPersonalization,
    };
    const generated = await generateProductionSessionWithOpenAI(
      generationContext,
      sessionGenerationRuntime(request, startedAt),
    );
    completedGeneration = generated;
    const routeContractIssue = generatedSessionStudyRouteIssue(
      generated.draft,
      committedStudyRoute,
    );
    if (routeContractIssue) {
      const failureStats = sessionStatsAtStage(
        generated.generationStats,
        "validation",
        "route_conflict",
      );
      await releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId);
      recordGenerationObservationBestEffort(
        supabase,
        user.id,
        observationFromSessionStats(
          failureStats,
          generated.model,
          "failure",
          requestId,
          planSession.id,
        ),
      );
      return NextResponse.json({
        code: "study_route_generation_conflict",
        error: "YOVA could not prepare content that matches this session's committed route. Nothing was saved or charged; try again.",
        retryable: true,
        requestId,
      }, {
        status: 503,
        headers: responseHeaders(requestId, failureStats),
      });
    }

    const cachedSession = cacheGeneratedSession(generated, expectedCacheVersion, requestedCacheContext);
    const cachePayload = {
      planSessionId: planSession.id,
      expectedRouteRevisionId: committedRouteRevisionId,
      generatedSession: cachedSession,
      expectedKnowledgeMap: parsedKnowledgeMap.data,
      expectedSourceMode: learningItem.source_mode,
      expectedPlanUpdatedAt: plan.updated_at,
      expectedSessionUpdatedAt: planSession.updated_at,
      expectedLearningItemUpdatedAt: learningItem.updated_at,
    };
    const { error: cacheError } = await supabase.rpc("cache_generated_session", {
      payload: cachePayload,
    });

    if (sessionCacheFailureMustFailClosed(cacheError)) {
      const failureStats = sessionStatsAtStage(
        generated.generationStats,
        "persistence",
        "cache_conflict",
      );
      await releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId);
      recordGenerationObservationBestEffort(
        supabase,
        user.id,
        observationFromSessionStats(
          failureStats,
          generated.model,
          "failure",
          requestId,
          planSession.id,
        ),
      );
      return NextResponse.json(
        {
          error: "This learning session changed while YOVA was preparing it. Refresh and try again.",
          requestId,
        },
        {
          status: 409,
          headers: responseHeaders(requestId, failureStats),
        },
      );
    }

    if (
      cacheError
      && generatedSessionDefersStoredPlanTargets(cachedSession, plannedContentTargets)
    ) {
      const failureStats = sessionStatsAtStage(
        generated.generationStats,
        "persistence",
        "cache_write",
      );
      await releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId);
      recordGenerationObservationBestEffort(
        supabase,
        user.id,
        observationFromSessionStats(
          failureStats,
          generated.model,
          "failure",
          requestId,
          planSession.id,
        ),
      );
      return NextResponse.json(
        {
          code: "deferred_session_persistence_unavailable",
          error: "YOVA prepared this lesson but could not safely save its remaining targets. Nothing was completed or charged. Try again.",
          retryable: true,
          requestId,
        },
        {
          status: 503,
          headers: responseHeaders(requestId, failureStats),
        },
      );
    }

    if (cacheError) {
      const currentAccess = await verifyOperationalPlanSession(supabase, {
        planId: parsed.data.planId,
        planSessionId: planSession.id,
      });
      if (!currentAccess.allowed) {
        const failure = sessionOperationFailure(currentAccess);
        const failureStats = sessionStatsAtStage(
          generated.generationStats,
          "persistence",
          "cache_conflict",
        );
        await releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId);
        recordGenerationObservationBestEffort(
          supabase,
          user.id,
          observationFromSessionStats(
            failureStats,
            generated.model,
            "failure",
            requestId,
            planSession.id,
          ),
        );
        return NextResponse.json(
          { error: failure.error, requestId },
          {
            status: failure.status,
            headers: responseHeaders(requestId, failureStats),
          },
        );
      }
    }

    if (cacheError) console.error("YOVA generated-session cache failed", { requestId });
    if (cacheError && expectedCacheVersion === 17) {
      // Authenticated streamed teaching steps are opened later by the lesson
      // route from this cloud cache. Unlike development preview, the signed-in
      // client does not resend the lesson skeleton, so a browser-only V17
      // response would open successfully and then fail on its first lesson.
      throw new SessionGenerationFailure(
        "YOVA could not safely store the streamed lesson before opening it.",
        sessionStatsAtStage(generated.generationStats, "persistence", "cache_write"),
      );
    }
    const learnerResponse = NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: planSession.id,
      session: cachedSession,
      generation: {
        mode: "openai",
        persistence: cacheError ? "browser" : "supabase",
      },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
    await settleSuccessfulGenerationClaim(supabase, aiUsageClaimId, requestId);

    logSuccessfulGeneration(
      requestId,
      generated.model,
      generated.generationStats,
      cacheError ? "browser" : "supabase",
    );
    recordGenerationObservationBestEffort(supabase, user.id, observationFromSessionStats(
      generated.generationStats,
      generated.model,
      generated.generationStats.degradedMode ? "fallback" : "success",
      requestId,
      planSession.id,
      {
        persistence: cacheError ? "browser_only" : "cloud_saved",
        ...(cacheError ? { persistenceCause: "cache_write" as const } : {}),
      },
    ));

    return learnerResponse;
  } catch (error) {
    await releaseFailedGenerationClaim(supabase, aiUsageClaimId, requestId);
    const attemptedModel = completedGeneration?.model ?? getOpenAISessionConfig()?.model ?? null;
    console.error("YOVA guided-session generation failed", {
      requestId,
      model: attemptedModel,
      ...privacySafeErrorDiagnostic(error),
    });
    const stats = error instanceof SessionGenerationFailure
      ? error.generationStats
      : completedGeneration
        ? sessionStatsAtStage(
          completedGeneration.generationStats,
          "persistence",
          "unexpected",
        )
        : {
        ...emptyGenerationStats(),
        elapsedMs: Date.now() - startedAt,
        failedValidator: "session_provider_request" as const,
        stage: "preflight" as const,
        cause: "unexpected" as const,
      };
    recordGenerationObservationBestEffort(
      supabase,
      user.id,
      observationFromSessionStats(
        stats,
        attemptedModel,
        "failure",
        requestId,
        planSession.id,
      ),
    );
    return NextResponse.json(
      {
        ...guidedSessionFailureResponse(
          error instanceof SessionGenerationFailure ? error.generationStats : null,
        ),
        requestId,
      },
      { status: 502, headers: responseHeaders(requestId, stats) },
    );
  }
}

async function releaseFailedGenerationClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string | null,
  requestId: string,
) {
  if (!claimId) return;
  try {
    await releaseAIRequestClaim(supabase, claimId);
  } catch {
    console.error("YOVA could not return a failed guided-session allowance claim", { requestId });
  }
}

async function settleSuccessfulGenerationClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string | null,
  requestId: string,
) {
  if (!claimId) return;
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful guided-session allowance claim", { requestId });
    }
  } catch {
    // The learner already has a complete, validated response. Never turn an
    // ambiguous settlement receipt into a retry that repeats provider work.
    console.error("YOVA could not settle a successful guided-session allowance claim", { requestId });
  }
}

async function recoverUnknownGenerationReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await releaseAIRequestReservation(supabase, "session_generation", operationKey, recoveryKey);
  } catch {
    // Its short database lease remains the final recovery boundary.
  }
}

function generationRequestId(request: Request) {
  const candidate = request.headers.get("X-Yova-Request-Id")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function recordGenerationObservationBestEffort(
  ...args: Parameters<typeof recordGenerationObservationAfterResponse>
) {
  try {
    recordGenerationObservationAfterResponse(...args);
  } catch {
    // Telemetry must never replace a learner-usable or structured route result.
  }
}

async function generateBrowserPreviewSession(
  request: Request,
  input: SessionGenerationRequest,
  requestId: string,
  startedAt: number,
) {
  if (!input.previewContext) {
    return NextResponse.json(
      { error: "YOVA needs the current browser plan before it can build this session." },
      { status: 422, headers: responseHeaders(requestId) },
    );
  }
  const blurtingGenerationContract = blurtingSessionGenerationContract(
    input.previewContext.studyRoute,
    {
      planId: input.planId,
      sessionId: input.planSessionId,
      routeRevisionId: input.routeRevisionId ?? "",
    },
  );
  if (blurtingGenerationContract) {
    return blurtingRuntimeUnavailableResponse(requestId);
  }
  const scheduledAdjustmentIssue = scheduledRetrievalAdjustmentIssue(
    input.previewContext.session,
    input.sessionAdjustment,
  );
  if (scheduledAdjustmentIssue) {
    return NextResponse.json({
      code: "scheduled_review_adjustment_not_supported",
      error: scheduledAdjustmentIssue,
      retryable: false,
    }, {
      status: 409,
      headers: responseHeaders(requestId),
    });
  }
  if (!isOpenAISessionConfigured()) {
    return NextResponse.json(
      { error: "Live guided-session generation is not connected yet." },
      { status: 503, headers: responseHeaders(requestId) },
    );
  }

  const rateLimit = checkSessionGenerationRateLimit(`preview:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sessions were generated at once. Wait a moment and try again." },
      {
        status: 429,
        headers: {
          ...responseHeaders(requestId),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const committedStudyRoute = input.previewContext.studyRoute ?? null;
    const previewRouteTopicIds = committedStudyRoute
      ? activeStudyRouteTargetIds(committedStudyRoute)
      : [];
    const selectedPreviewTopics = previewRouteTopicIds.flatMap((topicId) => {
      const topic = input.previewContext!.knowledgeTopics.find((candidate) => candidate.id === topicId);
      return topic ? [topic] : [];
    });
    const normalPlanGenerationCopy = resolveNormalPlanGenerationCopy({
      route: committedStudyRoute,
      selectedTopics: selectedPreviewTopics,
      contentTargets: input.previewContext.session.contentTargets,
    });
    const copySafePreviewContext = normalPlanGenerationCopy
      ? {
          ...input.previewContext,
          learningGoal: {
            ...input.previewContext.learningGoal,
            title: normalPlanGenerationCopy.learningGoalTitle,
            topic: normalPlanGenerationCopy.learningGoalTopic,
          },
          planRationale: normalPlanGenerationCopy.planRationale,
          journey: {
            ...input.previewContext.journey,
            previousSessions: input.previewContext.journey.previousSessions.map((candidate) => ({
              ...candidate,
              ...buildNormalPlanJourneyGenerationCopy(candidate),
            })),
            nextSessions: input.previewContext.journey.nextSessions.map((candidate) => ({
              ...candidate,
              ...buildNormalPlanJourneyGenerationCopy(candidate),
            })),
          },
          session: {
            ...input.previewContext.session,
            title: normalPlanGenerationCopy.sessionTitle,
          },
        }
      : input.previewContext;
    const sourceSafePreviewContext = copySafePreviewContext.learningGoal.sourceMode === "user_materials"
      ? {
        ...copySafePreviewContext,
        learningGoal: {
          ...copySafePreviewContext.learningGoal,
          sourceMode: "yova_generated" as const,
        },
      }
      : copySafePreviewContext;
    const effectiveSessionAdjustment = input.sessionAdjustment ?? null;
    const routeGeneration = studyRouteGenerationProjection({
      route: committedStudyRoute,
      legacy: {
        objective: sourceSafePreviewContext.session.objective,
        method: sourceSafePreviewContext.session.method,
        methodReason: sourceSafePreviewContext.session.methodReason,
        activeMinutes: sourceSafePreviewContext.session.estimatedMinutes,
        learningMode: sourceSafePreviewContext.session.learningMode,
        executionEnvironment: sourceSafePreviewContext.learningGoal.studyMode,
        topicIds: sourceSafePreviewContext.session.topicIds,
        completionEvidence: sourceSafePreviewContext.session.completionEvidence,
      },
    });
    const previewContext = {
      ...sourceSafePreviewContext,
      learningGoal: {
        ...sourceSafePreviewContext.learningGoal,
        studyMode: routeGeneration.executionEnvironment,
      },
      session: {
        ...sourceSafePreviewContext.session,
        objective: routeGeneration.objective,
        method: routeGeneration.method,
        methodReason: routeGeneration.methodReason,
        estimatedMinutes: routeGeneration.activeMinutes,
        learningMode: learningModeForScheduledRetrieval(
          sourceSafePreviewContext.session,
          routeGeneration.learningMode,
        ),
        topicIds: routeGeneration.topicIds,
        completionEvidence: routeGeneration.completionEvidence,
      },
    };
    const runtimeSessionArchitectureVersion = sessionArchitectureForGeneration({
      storedVersion: previewContext.sessionArchitectureVersion,
      learningMode: previewContext.session.learningMode,
      studyMode: previewContext.learningGoal.studyMode,
      reviewType: previewContext.session.reviewType ?? null,
      selectedMethodId: committedStudyRoute?.approach.primaryMethodId,
    });
    const generationContext: SessionGenerationContext = {
      ...previewContext,
      sessionArchitectureVersion: runtimeSessionArchitectureVersion,
      materials: [],
      sessionAdjustment: effectiveSessionAdjustment,
      studyRoute: committedStudyRoute,
    };
    const generated = await generateProductionSessionWithOpenAI(
      generationContext,
      sessionGenerationRuntime(request, startedAt),
    );
    const routeContractIssue = committedStudyRoute
      ? generatedSessionStudyRouteIssue(generated.draft, committedStudyRoute)
      : null;
    if (routeContractIssue) {
      const failureStats = sessionStatsAtStage(
        generated.generationStats,
        "validation",
        "route_conflict",
      );
      console.error("YOVA browser guided-session route validation failed", {
        requestId,
        strategy: failureStats.strategy ?? "unknown",
        stage: failureStats.stage,
        cause: failureStats.cause,
        attempts: failureStats.attempts,
      });
      return NextResponse.json({
        code: "study_route_generation_conflict",
        error: "YOVA did not produce the committed study route.",
        retryable: true,
      }, {
        status: 503,
        headers: responseHeaders(requestId, failureStats),
      });
    }
    const expectedCacheVersion = expectedSessionCacheVersion({
      sessionArchitectureVersion: runtimeSessionArchitectureVersion,
      learningMode: generationContext.session.learningMode,
      studyMode: generationContext.learningGoal.studyMode,
      reviewType: generationContext.session.reviewType ?? null,
    });
    const session = cacheGeneratedSession(
      generated,
      expectedCacheVersion,
      buildSessionCacheContext({
        plannedMinutes: routeGeneration.activeMinutes,
        adjustment: committedStudyRoute && effectiveSessionAdjustment
          ? { ...effectiveSessionAdjustment, availableMinutes: committedStudyRoute.timing.activeMinutes }
          : effectiveSessionAdjustment,
        routeRevisionId: input.routeRevisionId,
        contractKey: sessionCacheContractKey({
          reviewType: previewContext.session.reviewType ?? null,
          reviewConcept: previewContext.session.reviewConcept ?? null,
          title: previewContext.session.title,
          methodReason: previewContext.session.methodReason,
          topicIds: previewContext.session.topicIds,
          contentTargets: previewContext.session.contentTargets,
          completionEvidence: previewContext.session.completionEvidence,
          knowledgeTopics: previewContext.knowledgeTopics,
        }),
      }),
    );
    logSuccessfulGeneration(requestId, generated.model, generated.generationStats, "browser");

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: input.planSessionId,
      session,
      generation: { mode: "openai", persistence: "browser" },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
  } catch (error) {
    const stats = error instanceof SessionGenerationFailure
      ? error.generationStats
      : undefined;
    console.error("YOVA browser guided-session generation failed", {
      requestId,
      ...privacySafeErrorDiagnostic(error),
    });
    return NextResponse.json(
      {
        ...guidedSessionFailureResponse(
          error instanceof SessionGenerationFailure ? error.generationStats : null,
        ),
        requestId,
      },
      { status: 502, headers: responseHeaders(requestId, stats) },
    );
  }
}

function sessionGenerationRuntime(request: Request, startedAt: number) {
  return {
    deadlineAt: startedAt + SESSION_GENERATION_SERVER_BUDGET_MS,
    settlementReserveMs: SESSION_GENERATION_SETTLEMENT_RESERVE_MS,
    signal: request.signal,
  };
}

function responseHeaders(requestId: string, stats?: SessionGenerationStats) {
  return {
    "Cache-Control": "no-store",
    "X-Yova-Request-Id": requestId,
    ...(stats ? {
      "X-Yova-Generation-Ms": String(stats.elapsedMs),
      "X-Yova-Generation-Attempts": String(stats.attempts),
      "X-Yova-Prompt-Cache-Hit": String(stats.cachedInputTokens > 0),
      ...(stats.strategy ? { "X-Yova-Generation-Strategy": stats.strategy } : {}),
      ...(stats.stage ? { "X-Yova-Generation-Stage": stats.stage } : {}),
      ...(stats.recoveryMode ? { "X-Yova-Generation-Recovery": stats.recoveryMode.replaceAll("_", "-") } : {}),
      ...(stats.degradedMode ? { "X-Yova-Generation-Fallback": stats.degradedMode.replaceAll("_", "-") } : {}),
    } : {}),
  };
}

function sessionStatsAtStage(
  stats: SessionGenerationStats,
  stage: SessionGenerationStage,
  cause: SessionGenerationCause,
): SessionGenerationStats {
  return { ...stats, stage, cause };
}

function emptyGenerationStats(): SessionGenerationStats {
  return {
    elapsedMs: 0,
    attempts: 0,
    firstAttemptPassed: null,
    failedValidator: null,
    repairAttempted: false,
    repairSucceeded: null,
    repairReason: "none",
    repairDetail: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };
}

function emptySessionObservation(elapsedMs: number) {
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

function observationFromSessionStats(
  stats: SessionGenerationStats,
  model: string | null,
  finalOutcome: "success" | "fallback" | "failure",
  sessionRequestId: string,
  planSessionId: string,
  persistence?: {
    persistence: "cloud_saved" | "browser_only" | "failed";
    persistenceCause?: "cache_conflict" | "cache_write";
  },
) {
  const resolvedPersistence = persistence ?? (stats.stage === "persistence"
    ? {
      persistence: "failed" as const,
      ...(stats.cause === "cache_conflict" || stats.cause === "cache_write"
        ? { persistenceCause: stats.cause }
        : {}),
    }
    : undefined);
  const diagnostics = {
    sessionRequestId,
    planSessionId,
    ...(stats.recoveryMode ? { recoveryMode: stats.recoveryMode } : {}),
    ...(stats.strategy ? { sessionGenerationStrategy: stats.strategy } : {}),
    ...(stats.stage ? { sessionGenerationStage: stats.stage } : {}),
    ...(stats.cause ? { sessionGenerationCause: stats.cause } : {}),
    ...(stats.degradedMode ? { sessionFallbackMode: stats.degradedMode } : {}),
    ...(resolvedPersistence ? { sessionPersistence: resolvedPersistence.persistence } : {}),
    ...(resolvedPersistence?.persistenceCause
      ? { sessionPersistenceCause: resolvedPersistence.persistenceCause }
      : {}),
    ...(stats.validationIssueCode
      ? { sessionValidationIssueCode: stats.validationIssueCode }
      : {}),
  };
  return {
    generationType: "session" as const,
    environment: generationEnvironment(),
    finalOutcome,
    firstAttemptPassed: stats.firstAttemptPassed,
    failedValidator: stats.failedValidator,
    repairAttempted: stats.repairAttempted,
    repairSucceeded: stats.repairSucceeded,
    elapsedMs: stats.elapsedMs,
    attempts: stats.attempts,
    inputTokens: stats.inputTokens,
    cachedInputTokens: stats.cachedInputTokens,
    cacheWriteTokens: stats.cacheWriteTokens,
    outputTokens: stats.outputTokens,
    model,
    ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
  };
}

function logSuccessfulGeneration(
  requestId: string,
  model: string,
  stats: SessionGenerationStats,
  persistence: "browser" | "supabase",
) {
  console.info("YOVA guided-session generation completed", {
    requestId,
    model,
    persistence,
    elapsedMs: stats.elapsedMs,
    attempts: stats.attempts,
    repairAttempted: stats.repairAttempted,
    repairReason: stats.repairReason,
    recoveryMode: stats.recoveryMode ?? "none",
    degradedMode: stats.degradedMode ?? "none",
    strategy: stats.strategy ?? "unknown",
    stage: stats.stage ?? "complete",
    cause: stats.cause ?? "none",
    validationIssueCode: stats.validationIssueCode ?? "none",
    ...(process.env.NODE_ENV === "development" ? { repairDetail: stats.repairDetail } : {}),
    inputTokens: stats.inputTokens,
    cachedInputTokens: stats.cachedInputTokens,
    cacheWriteTokens: stats.cacheWriteTokens,
    outputTokens: stats.outputTokens,
  });
}

function readCachedSession(stepData: unknown, expectedSchemaVersion?: 15 | 17) {
  if (!stepData || typeof stepData !== "object" || Array.isArray(stepData)) return null;
  const candidate = (stepData as Record<string, unknown>).generatedSession;
  const parsed = CachedGeneratedSessionSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return expectedSchemaVersion && parsed.data.schemaVersion !== expectedSchemaVersion ? null : parsed.data;
}

function blurtingRuntimeUnavailableResponse(requestId: string) {
  return NextResponse.json({
    code: "blurting_runtime_unavailable",
    error: "Blurting is saved for this session, but its dedicated runtime is not available yet. Choose another method before starting.",
    retryable: false,
  }, {
    status: 409,
    headers: responseHeaders(requestId),
  });
}

function cacheGeneratedSession(
  generated: Awaited<ReturnType<typeof generateProductionSessionWithOpenAI>>,
  expectedSchemaVersion: 15 | 17,
  cacheContext: SessionCacheContext,
) {
  const shared = {
    ...generated.draft,
    ...(cacheContext.routeRevisionId ? { routeRevisionId: cacheContext.routeRevisionId } : {}),
    routingContext: generated.routingContext,
    supportPlan: generated.supportPlan,
    deliveryPolicy: generated.deliveryPolicy,
    model: generated.model,
    generatedAt: new Date().toISOString(),
  };
  if (expectedSchemaVersion === 17) {
    if (!generated.deliveryInstructions) {
      throw new Error("The streamed teaching skeleton did not include delivery instructions.");
    }
    return CachedGeneratedSessionV17Schema.parse({
      schemaVersion: 17,
      ...shared,
      deliveryInstructions: generated.deliveryInstructions,
      cacheContext,
    });
  }
  return CachedGeneratedSessionV15Schema.parse({
    schemaVersion: 15,
    ...shared,
    cacheContext,
  });
}

function readMethodId(stepData: unknown, method: string) {
  return readCachedSession(stepData)?.methodBriefing.methodId ?? methodIdFromText(method);
}

function readCompletedSessionComparisonContext(
  stepData: unknown,
  method: string,
  title: string,
  objective: string,
) {
  const cached = readCachedSession(stepData);
  const comparisonText = [title, objective, method].join(" ");
  const learningMode = readSessionLearningMode(stepData, method, objective);
  return {
    taskType: cached?.routingContext?.taskType
      ?? cached?.methodBriefing.taskType
      ?? inferLearningTaskType(comparisonText),
    knowledgeStage: cached?.routingContext?.knowledgeStage
      ?? (learningMode === "learn" ? "novice" as const : inferKnowledgeStage([], comparisonText)),
  };
}

function readReviewType(stepData: unknown) {
  const candidate = readTextProperty(stepData, "reviewType");
  return candidate === "repair_and_retrieve" || candidate === "verify" || candidate === "maintenance_transfer"
    ? candidate
    : null;
}

function readSessionFeedback(value: unknown) {
  if (value === "too_easy" || value === "about_right" || value === "too_difficult") return value;
  return null;
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function readNumberProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readStringArrayProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>)[key];
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6);
}

function readLearningIntent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "study" as const;
  const candidate = (value as Record<string, unknown>).learningIntent;
  return candidate === "learn" || candidate === "study" ? candidate : "study" as const;
}

function readSessionLearningMode(value: unknown, method: string, objective: string) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>).learningMode;
    if (candidate === "learn" || candidate === "study") return candidate;
  }
  return inferLegacySessionLearningMode(method, objective);
}

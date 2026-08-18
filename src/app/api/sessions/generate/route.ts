import { NextResponse } from "next/server";
import type { SessionCompletion, SessionInterruption } from "@/lib/domain";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
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
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import { isOpenAISessionConfigured } from "@/lib/openai/config";
import {
  generateProductionSessionWithOpenAI,
} from "@/lib/openai/session-generation-strategy";
import {
  SessionGenerationFailure,
  type SessionGenerationContext,
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
import {
  resolveSessionArchitectureVersion,
  sessionArchitectureForGeneration,
  STREAMED_SESSION_ARCHITECTURE,
  type SessionArchitectureVersion,
} from "@/lib/session-generation/architecture";
import { checkSessionGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import {
  classifyOperationalPlanSession,
  sessionCacheFailureMustFailClosed,
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import {
  buildSessionCacheContext,
  sessionCacheContextMatches,
  type SessionCacheContext,
} from "@/lib/server/session-cache-context";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { privacySafeErrorDiagnostic } from "@/lib/server/error-diagnostic";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    return generateBrowserPreviewSession(request, normalizedInput, requestId);
  }

  const { data: planSession, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,plan_id,sequence,status,title,objective,method,method_rationale,estimated_minutes,step_data")
    .eq("id", parsed.data.planSessionId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: "YOVA could not load this plan session." }, { status: 500 });
  }
  if (!planSession || planSession.plan_id !== parsed.data.planId) {
    return NextResponse.json({ error: "That guided session was not found." }, { status: 404 });
  }

  try {
    const [{ data: plan, error: planError }, { data: learnerProfile, error: learnerError }, { data: planSessionRows, error: planSessionsError }] = await Promise.all([
      supabase
        .from("plans")
        .select("learning_item_id,status,rationale,generation_inputs,knowledge_map")
        .eq("id", parsed.data.planId)
        .maybeSingle(),
      supabase
        .from("learner_profiles")
        .select("common_blocker,guidance_preference,explanation_preference,focus_frequency,starting_pattern,primary_improvement_goal,additional_context")
        .maybeSingle(),
      supabase
        .from("plan_sessions")
        .select("id,sequence,status,title,objective,method,step_data")
        .eq("plan_id", parsed.data.planId)
        .order("sequence", { ascending: true }),
    ]);

    if (planError || learnerError || planSessionsError) throw planError ?? learnerError ?? planSessionsError;
    if (!plan) return NextResponse.json({ error: "That learning plan was not found." }, { status: 404 });
    const operationAccess = classifyOperationalPlanSession({
      requestedPlanId: parsed.data.planId,
      sessionPlanId: planSession.plan_id,
      planStatus: plan.status,
      sessionStatus: planSession.status,
    });
    if (!operationAccess.allowed) {
      const failure = sessionOperationFailure(operationAccess);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    const [
      { data: learningItem, error: itemError },
      attemptsResult,
      { data: materialRows, error: materialsError },
      interruptionsResult,
      personalizationAttemptsResult,
      personalizationInterruptionsResult,
    ] = await Promise.all([
      supabase
        .from("learning_items")
        .select("title,topic,kind,deadline,source_mode,study_mode")
        .eq("id", plan.learning_item_id)
        .maybeSingle(),
      planSessionRows?.length
        ? supabase
          .from("session_attempts")
          .select("plan_session_id,correct_answers,total_answers,actual_minutes,user_feedback,result_data,completed_at")
          .in("plan_session_id", planSessionRows.map((session) => session.id))
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(12)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("materials")
        .select("id,filename")
        .eq("learning_item_id", plan.learning_item_id)
        .eq("processing_status", "ready")
        .order("created_at", { ascending: true })
        .limit(5),
      planSessionRows?.length
        ? supabase
          .from("learning_events")
          .select("occurred_at,event_data")
          .eq("event_type", "session_interrupted")
          .in("plan_session_id", planSessionRows.map((session) => session.id))
          .order("occurred_at", { ascending: false })
          .limit(6)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("session_attempts")
        .select("id,plan_session_id,started_at,completed_at,actual_minutes,correct_answers,total_answers,user_feedback,result_data")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: true }),
      supabase
        .from("learning_events")
        .select("plan_session_id,occurred_at,event_data")
        .eq("event_type", "session_interrupted")
        .order("occurred_at", { ascending: true }),
    ]);

    if (
      itemError
      || attemptsResult.error
      || materialsError
      || interruptionsResult.error
      || personalizationAttemptsResult.error
      || personalizationInterruptionsResult.error
    ) {
      throw itemError
        ?? attemptsResult.error
        ?? materialsError
        ?? interruptionsResult.error
        ?? personalizationAttemptsResult.error
        ?? personalizationInterruptionsResult.error;
    }
    if (!learningItem) return NextResponse.json({ error: "That learning goal was not found." }, { status: 404 });

    const parsedKnowledgeMap = PlanKnowledgeMapSchema.safeParse(plan.knowledge_map);
    if (!parsedKnowledgeMap.success) {
      return NextResponse.json(
        { error: "This plan needs its topic map rebuilt before YOVA can prepare the session." },
        { status: 409 },
      );
    }
    const plannedTopicIds = readStringArrayProperty(planSession.step_data, "topicIds");
    const selectedTopics = parsedKnowledgeMap.data.topics.filter((topic) => plannedTopicIds.includes(topic.id));
    if (selectedTopics.length === 0) {
      return NextResponse.json(
        { error: "This session is not linked to a topic in the plan yet." },
        { status: 409 },
      );
    }
    const orderedChunkIds = Array.from(new Set(
      selectedTopics.flatMap((topic) => topic.sourceReferences.map((reference) => reference.chunkId)),
    ));
    const chunkResult = orderedChunkIds.length > 0
      ? await supabase
        .from("material_chunks")
        .select("id,material_id,chunk_index,location_label,section_role,chunk_text")
        .in("id", orderedChunkIds)
      : { data: [], error: null };
    if (chunkResult.error) throw chunkResult.error;
    const returnedChunkIds = new Set((chunkResult.data ?? []).map((chunk) => chunk.id));
    const missingChunkIds = orderedChunkIds.filter((chunkId) => !returnedChunkIds.has(chunkId));
    if (missingChunkIds.length > 0) {
      return NextResponse.json(
        { error: "YOVA could not retrieve all of the mapped source sections for this topic. Reprocess the material before starting this session." },
        { status: 409 },
      );
    }
    const materialExcerpts = buildTopicMaterialExcerpts({
      chunkRows: (chunkResult.data ?? []) as TopicMaterialChunkRow[],
      materialNames: new Map((materialRows ?? []).map((material) => [material.id, material.filename])),
      orderedChunkIds,
    }).filter((excerpt) => excerpt.text.trim().length >= 12);
    if (orderedChunkIds.length > 0 && materialExcerpts.length !== orderedChunkIds.length) {
      return NextResponse.json(
        { error: "A mapped source section is empty. Reprocess the material before starting this session." },
        { status: 409 },
      );
    }
    // A topic with mapped chunks must use those exact chunks. AI-origin topics
    // have no source references and are intentionally taught from model knowledge.
    const effectiveSourceMode = orderedChunkIds.length > 0
      ? "user_materials"
      : "yova_generated";

    const recentAttempts = attemptsResult.data ?? [];
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
    const savedLearningMode = readSessionLearningMode(
      planSession.step_data,
      planSession.method,
      planSession.objective,
    );
    const effectiveLearningMode = resolveEffectiveSessionLearningMode({
      planLearningIntent,
      plannedMode: savedLearningMode,
      completedSessionCount: recentAttempts.length,
      familiarity: sessionAdjustment?.familiarity ?? null,
    });
    const repairedTeachingStart = effectiveLearningMode === "learn" && savedLearningMode !== "learn"
      ? teachingFirstSessionCopy(learningItem.topic)
      : null;
    const sessionArchitectureVersion = sessionArchitectureForGeneration({
      storedVersion: storedSessionArchitectureVersion,
      learningMode: effectiveLearningMode,
      studyMode: learningItem.study_mode,
      reviewType: readReviewType(planSession.step_data),
    });
    const expectedCacheVersion = expectedSessionCacheVersion({
      sessionArchitectureVersion,
      learningMode: effectiveLearningMode,
      studyMode: learningItem.study_mode,
      reviewType: readReviewType(planSession.step_data),
    });
    const requestedCacheContext = buildSessionCacheContext({
      plannedMinutes: planSession.estimated_minutes,
      adjustment: sessionAdjustment,
    });
    const cached = readCachedSession(planSession.step_data, expectedCacheVersion);
    if (
      cached
      && (cached.schemaVersion === 17
        ? sessionCacheContextMatches(cached.cacheContext, requestedCacheContext)
        : cached.schemaVersion === 15 && !sessionAdjustment && (
          !cached.cacheContext
          || sessionCacheContextMatches(cached.cacheContext, requestedCacheContext)
        ))
      && cached.methodBriefing.learningMode === effectiveLearningMode
    ) {
      await recordGenerationObservation(supabase, user.id, {
        ...emptySessionObservation(Date.now() - startedAt),
        generationType: "session",
        environment: generationEnvironment(),
        finalOutcome: "cache",
      });
      return NextResponse.json(SessionGenerationResponseSchema.parse({
        planSessionId: planSession.id,
        session: cached,
        generation: { mode: "cache", persistence: "supabase" },
      }), { headers: responseHeaders(requestId, emptyGenerationStats()) });
    }

    if (!isOpenAISessionConfigured()) {
      return NextResponse.json({ error: "Live guided-session generation is not connected yet." }, { status: 503 });
    }

    const rateLimit = checkSessionGenerationRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many sessions were generated at once. Wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    let durableLimit: Awaited<ReturnType<typeof claimAIRequest>>;
    try {
      durableLimit = await claimAIRequest(supabase, "session_generation");
    } catch {
      return NextResponse.json(
        { error: "YOVA paused before using OpenAI because it could not verify the account’s AI budget." },
        { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
      );
    }
    if (!durableLimit.allowed) {
      return NextResponse.json(
        { error: "This account has reached its guided-session allowance. Try again after the limit resets." },
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
      ? (interruptionsResult.data ?? []).filter((event) => {
        const attemptId = readTextProperty(event.event_data, "attemptId");
        return !attemptId || !personalizationState.excludedEvidenceRefs.includes(attemptId);
      })
      : [];
    const expandedProfile = expandedLearnerContextFromAnswers(storedLearnerAnswers);
    const personalizationCompletions = (personalizationAttemptsResult.data ?? [])
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
    const personalizationInterruptions = (personalizationInterruptionsResult.data ?? [])
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
        title: learningItem.title,
        topic: learningItem.topic,
        kind: learningItem.kind,
        deadline: learningItem.deadline,
        sourceMode: effectiveSourceMode,
        studyMode: learningItem.study_mode,
        learningIntent: planLearningIntent,
      },
      planRationale: plan.rationale,
      journey: {
        currentSequence: planSession.sequence,
        totalSessions: planSessionRows?.length ?? 1,
        previousSessions: (planSessionRows ?? [])
          .filter((candidate) => candidate.sequence < planSession.sequence)
          .map((candidate) => ({
            sequence: candidate.sequence,
            title: candidate.title,
            objective: candidate.objective,
            status: candidate.status,
            contentTargets: readStringArrayProperty(candidate.step_data, "contentTargets"),
          })),
        nextSessions: (planSessionRows ?? [])
          .filter((candidate) => candidate.sequence > planSession.sequence)
          .map((candidate) => ({
            sequence: candidate.sequence,
            title: candidate.title,
            objective: candidate.objective,
            contentTargets: readStringArrayProperty(candidate.step_data, "contentTargets"),
          })),
      },
      materials: materialExcerpts,
      knowledgeTopics: selectedTopics,
      session: {
        title: planSession.title,
        objective: repairedTeachingStart?.objective ?? planSession.objective,
        method: repairedTeachingStart?.method ?? planSession.method,
        methodReason: repairedTeachingStart?.methodReason ?? planSession.method_rationale,
        estimatedMinutes: planSession.estimated_minutes,
        learningMode: effectiveLearningMode,
        topicIds: selectedTopics.map((topic) => topic.id),
        contentTargets: readStringArrayProperty(planSession.step_data, "contentTargets"),
        completionEvidence: readStringArrayProperty(planSession.step_data, "completionEvidence"),
        reviewConcept: readTextProperty(planSession.step_data, "reviewConcept") || null,
        reviewType: readReviewType(planSession.step_data),
      },
      learnerProfile: learnerProfile ? {
        commonBlocker: statedAnswer(0),
        guidancePreference: statedAnswer(1),
        explanationPreference: statedAnswer(3),
        focusFrequency: statedAnswer(4),
        startingPattern: statedAnswer(5),
        primaryImprovementGoal: statedAnswer(7),
        ...expandedProfile,
      } : null,
      sessionAdjustment: sessionAdjustment ?? null,
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
    const generated = await generateProductionSessionWithOpenAI(generationContext);

    const cachedSession = cacheGeneratedSession(generated, expectedCacheVersion, requestedCacheContext);
    let { error: cacheError } = await supabase.rpc("cache_generated_session", {
      payload: {
        planSessionId: planSession.id,
        generatedSession: cachedSession,
      },
    });
    if (cacheError && expectedCacheVersion === 17) {
      ({ error: cacheError } = await supabase.rpc("cache_generated_session", {
        payload: {
          planSessionId: planSession.id,
          generatedSession: cachedSession,
        },
      }));
    }

    if (sessionCacheFailureMustFailClosed(cacheError)) {
      return NextResponse.json(
        {
          error: "This learning session changed while YOVA was preparing it. Refresh and try again.",
          requestId,
        },
        {
          status: 409,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
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
        return NextResponse.json(
          { error: failure.error, requestId },
          {
            status: failure.status,
            headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
          },
        );
      }
    }

    if (cacheError) console.error("YOVA generated-session cache failed", { requestId });
    if (cacheError && expectedCacheVersion === 17) {
      throw new Error("YOVA could not safely store the streamed lesson before opening it.");
    }
    logSuccessfulGeneration(
      requestId,
      generated.model,
      generated.generationStats,
      cacheError ? "browser" : "supabase",
    );
    await recordGenerationObservation(supabase, user.id, observationFromSessionStats(
      generated.generationStats,
      generated.model,
      "success",
    ));

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: planSession.id,
      session: cachedSession,
      generation: {
        mode: "openai",
        persistence: cacheError ? "browser" : "supabase",
      },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
  } catch (error) {
    console.error("YOVA guided-session generation failed", {
      requestId,
      ...privacySafeErrorDiagnostic(error),
    });
    const stats = error instanceof SessionGenerationFailure
      ? error.generationStats
      : {
        ...emptyGenerationStats(),
        elapsedMs: Date.now() - startedAt,
        failedValidator: "session_provider_request" as const,
      };
    await recordGenerationObservation(supabase, user.id, observationFromSessionStats(stats, null, "failure"));
    return NextResponse.json(
      { error: "YOVA could not prepare this guided session right now. Try again in a moment.", requestId },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
}

function generationRequestId(request: Request) {
  const candidate = request.headers.get("X-Yova-Request-Id")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

async function generateBrowserPreviewSession(
  request: Request,
  input: SessionGenerationRequest,
  requestId: string,
) {
  if (!input.previewContext) {
    return NextResponse.json(
      { error: "YOVA needs the current browser plan before it can build this session." },
      { status: 422, headers: responseHeaders(requestId) },
    );
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
    const previewContext = input.previewContext.learningGoal.sourceMode === "user_materials"
      ? {
        ...input.previewContext,
        learningGoal: {
          ...input.previewContext.learningGoal,
          sourceMode: "yova_generated" as const,
        },
      }
      : input.previewContext;
    const runtimeSessionArchitectureVersion = sessionArchitectureForGeneration({
      storedVersion: previewContext.sessionArchitectureVersion,
      learningMode: previewContext.session.learningMode,
      studyMode: previewContext.learningGoal.studyMode,
      reviewType: previewContext.session.reviewType ?? null,
    });
    const generationContext: SessionGenerationContext = {
      ...previewContext,
      sessionArchitectureVersion: runtimeSessionArchitectureVersion,
      materials: [],
      sessionAdjustment: input.sessionAdjustment ?? null,
    };
    const generated = await generateProductionSessionWithOpenAI(generationContext);
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
        plannedMinutes: previewContext.session.estimatedMinutes,
        adjustment: input.sessionAdjustment,
      }),
    );
    logSuccessfulGeneration(requestId, generated.model, generated.generationStats, "browser");

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: input.planSessionId,
      session,
      generation: { mode: "openai", persistence: "browser" },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
  } catch (error) {
    console.error("YOVA browser guided-session generation failed", {
      requestId,
      ...privacySafeErrorDiagnostic(error),
    });
    return NextResponse.json(
      { error: "YOVA could not prepare this guided session right now. Try again in a moment.", requestId },
      { status: 502, headers: responseHeaders(requestId) },
    );
  }
}

function responseHeaders(requestId: string, stats?: SessionGenerationStats) {
  return {
    "Cache-Control": "no-store",
    "X-Yova-Request-Id": requestId,
    ...(stats ? {
      "X-Yova-Generation-Ms": String(stats.elapsedMs),
      "X-Yova-Generation-Attempts": String(stats.attempts),
      "X-Yova-Prompt-Cache-Hit": String(stats.cachedInputTokens > 0),
      ...(stats.recoveryMode ? { "X-Yova-Generation-Recovery": stats.recoveryMode.replaceAll("_", "-") } : {}),
    } : {}),
  };
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
  finalOutcome: "success" | "failure",
) {
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
    ...(stats.recoveryMode ? { diagnostics: { recoveryMode: stats.recoveryMode } } : {}),
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

function expectedSessionCacheVersion({
  sessionArchitectureVersion,
  learningMode,
  studyMode,
  reviewType,
}: {
  sessionArchitectureVersion: SessionArchitectureVersion;
  learningMode: "learn" | "study";
  studyMode: string;
  reviewType: "repair_and_retrieve" | "verify" | "maintenance_transfer" | null;
}): 15 | 17 {
  return sessionArchitectureVersion === STREAMED_SESSION_ARCHITECTURE
    && learningMode === "learn"
    && studyMode === "inside_yova"
    && !reviewType
    ? 17
    : 15;
}

function cacheGeneratedSession(
  generated: Awaited<ReturnType<typeof generateProductionSessionWithOpenAI>>,
  expectedSchemaVersion: 15 | 17,
  cacheContext: SessionCacheContext,
) {
  const shared = {
    ...generated.draft,
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

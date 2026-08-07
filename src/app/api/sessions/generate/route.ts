import { NextResponse } from "next/server";
import { buildMaterialExcerpts } from "@/lib/materials/context";
import { readConceptEvidenceProperty, summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import { readConfidenceEvidenceProperty, summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { inferLegacySessionLearningMode } from "@/lib/learning/learning-intent";
import {
  inferKnowledgeStage,
  inferLearningTaskType,
  methodIdFromText,
} from "@/lib/learning/method-router";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import { inferScheduledRetrievalConcept, inferScheduledRetrievalType } from "@/lib/learning/scheduled-retrieval";
import { isOpenAISessionConfigured } from "@/lib/openai/config";
import { generateSessionWithOpenAI, type SessionGenerationStats } from "@/lib/openai/session-generator";
import { expandedLearnerContextFromStored } from "@/lib/personalization/learner-profile";
import {
  CachedGeneratedSessionSchema,
  SessionGenerationRequestSchema,
  SessionGenerationResponseSchema,
  type SessionGenerationRequest,
} from "@/lib/session-generation/schema";
import { checkSessionGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
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

  if (developmentPreview || !supabase || !user) {
    return generateBrowserPreviewSession(request, parsed.data, requestId);
  }

  const { data: planSession, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,plan_id,title,objective,method,method_rationale,estimated_minutes,step_data")
    .eq("id", parsed.data.planSessionId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: "YOVA could not load this plan session." }, { status: 500 });
  }
  if (!planSession || planSession.plan_id !== parsed.data.planId) {
    return NextResponse.json({ error: "That guided session was not found." }, { status: 404 });
  }

  const cached = readCachedSession(planSession.step_data);
  if (cached && !parsed.data.sessionAdjustment) {
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

  try {
    const [{ data: plan, error: planError }, { data: learnerProfile, error: learnerError }, { data: planSessionRows, error: planSessionsError }] = await Promise.all([
      supabase
        .from("plans")
        .select("learning_item_id,rationale,generation_inputs")
        .eq("id", parsed.data.planId)
        .maybeSingle(),
      supabase
        .from("learner_profiles")
        .select("common_blocker,guidance_preference,explanation_preference,focus_frequency,starting_pattern,primary_improvement_goal,additional_context")
        .maybeSingle(),
      supabase
        .from("plan_sessions")
        .select("id,title,objective,method,step_data")
        .eq("plan_id", parsed.data.planId),
    ]);

    if (planError || learnerError || planSessionsError) throw planError ?? learnerError ?? planSessionsError;
    if (!plan) return NextResponse.json({ error: "That learning plan was not found." }, { status: 404 });

    const [{ data: learningItem, error: itemError }, attemptsResult, { data: materialRows, error: materialsError }, interruptionsResult] = await Promise.all([
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
        .select("filename,extracted_text")
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
    ]);

    if (itemError || attemptsResult.error || materialsError || interruptionsResult.error) throw itemError ?? attemptsResult.error ?? materialsError ?? interruptionsResult.error;
    if (!learningItem) return NextResponse.json({ error: "That learning goal was not found." }, { status: 404 });

    const materialExcerpts = buildMaterialExcerpts(materialRows ?? []);
    if (learningItem.source_mode === "user_materials" && materialExcerpts.length === 0) {
      return NextResponse.json({
        error: "YOVA could not read enough source text to build this session safely. Reopen the learning goal and add a readable PDF, TXT, or Markdown file.",
        requestId,
      }, { status: 409, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
    }

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
    const expandedProfile = expandedLearnerContextFromStored(learnerProfile?.additional_context ?? null);
    const generated = await generateSessionWithOpenAI({
      learningGoal: {
        title: learningItem.title,
        topic: learningItem.topic,
        kind: learningItem.kind,
        deadline: learningItem.deadline,
        sourceMode: learningItem.source_mode,
        studyMode: learningItem.study_mode,
        learningIntent: readLearningIntent(plan.generation_inputs),
      },
      planRationale: plan.rationale,
      materials: materialExcerpts,
      session: {
        title: planSession.title,
        objective: planSession.objective,
        method: planSession.method,
        methodReason: planSession.method_rationale,
        estimatedMinutes: planSession.estimated_minutes,
        learningMode: readSessionLearningMode(planSession.step_data, planSession.method, planSession.objective),
        contentTargets: readStringArrayProperty(planSession.step_data, "contentTargets"),
        completionEvidence: readStringArrayProperty(planSession.step_data, "completionEvidence"),
        reviewConcept: inferScheduledRetrievalConcept({
          title: planSession.title,
          reviewConcept: readTextProperty(planSession.step_data, "reviewConcept") || undefined,
        }),
        reviewType: inferScheduledRetrievalType({
          title: planSession.title,
          method: planSession.method,
          reviewType: readReviewType(planSession.step_data),
        }),
      },
      learnerProfile: learnerProfile ? {
        commonBlocker: learnerProfile.common_blocker,
        guidancePreference: learnerProfile.guidance_preference,
        explanationPreference: learnerProfile.explanation_preference,
        focusFrequency: learnerProfile.focus_frequency,
        startingPattern: learnerProfile.starting_pattern,
        primaryImprovementGoal: learnerProfile.primary_improvement_goal,
        ...expandedProfile,
      } : null,
      sessionAdjustment: parsed.data.sessionAdjustment ?? null,
      recentResults: recentAttempts.slice(0, 8).map((attempt) => ({
        methodId: methodIdBySession.get(attempt.plan_session_id) ?? null,
        taskType: comparisonContextBySession.get(attempt.plan_session_id)?.taskType ?? null,
        knowledgeStage: comparisonContextBySession.get(attempt.plan_session_id)?.knowledgeStage ?? null,
        correctAnswers: attempt.correct_answers,
        totalAnswers: attempt.total_answers,
        feedback: readSessionFeedback(attempt.user_feedback),
        observedGap: readTextProperty(attempt.result_data, "observedGap") || null,
        plannedMinutes: readNumberProperty(attempt.result_data, "plannedMinutes"),
        actualMinutes: attempt.actual_minutes,
        calibrationPattern: summarizeConfidenceCalibration(
          readConfidenceEvidenceProperty(attempt.result_data),
        ).pattern,
      })),
      recentInterruptions: (interruptionsResult.data ?? []).slice(0, 4).map((event) => ({
        occurredAt: event.occurred_at,
        plannedMinutes: readNumberProperty(event.event_data, "plannedMinutes"),
        actualMinutes: readNumberProperty(event.event_data, "actualMinutes"),
        completedSteps: readNumberProperty(event.event_data, "completedSteps"),
        totalSteps: readNumberProperty(event.event_data, "totalSteps"),
      })),
      conceptSignals: summarizeConceptEvidence(completionEvidence).slice(0, 20),
      scaffoldSignals: buildScaffoldProgressionSignals(completionEvidence).slice(0, 20),
    });

    const cachedSession = CachedGeneratedSessionSchema.parse({
      schemaVersion: 13,
      ...generated.draft,
      routingContext: generated.routingContext,
      supportPlan: generated.supportPlan,
      deliveryPolicy: generated.deliveryPolicy,
      model: generated.model,
      generatedAt: new Date().toISOString(),
    });
    const { error: cacheError } = await supabase.rpc("cache_generated_session", {
      payload: {
        planSessionId: planSession.id,
        generatedSession: cachedSession,
      },
    });

    if (cacheError) console.error("YOVA generated-session cache failed", { requestId });
    logSuccessfulGeneration(requestId, generated.model, generated.generationStats, "supabase");

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: planSession.id,
      session: cachedSession,
      generation: {
        mode: "openai",
        persistence: cacheError ? "browser" : "supabase",
      },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
  } catch (error) {
    console.error("YOVA guided-session generation failed", { requestId, reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "YOVA could not prepare this guided session right now. Try again in a moment.", requestId },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
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
  if (input.previewContext.learningGoal.sourceMode === "user_materials") {
    return NextResponse.json(
      { error: "Secure uploaded-material sessions require a connected cloud account." },
      { status: 503, headers: responseHeaders(requestId) },
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
    const generated = await generateSessionWithOpenAI({
      ...input.previewContext,
      materials: [],
      sessionAdjustment: input.sessionAdjustment ?? null,
    });
    const session = CachedGeneratedSessionSchema.parse({
      schemaVersion: 13,
      ...generated.draft,
      routingContext: generated.routingContext,
      supportPlan: generated.supportPlan,
      deliveryPolicy: generated.deliveryPolicy,
      model: generated.model,
      generatedAt: new Date().toISOString(),
    });
    logSuccessfulGeneration(requestId, generated.model, generated.generationStats, "browser");

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: input.planSessionId,
      session,
      generation: { mode: "openai", persistence: "browser" },
    }), { headers: responseHeaders(requestId, generated.generationStats) });
  } catch (error) {
    console.error("YOVA browser guided-session generation failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
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
    } : {}),
  };
}

function emptyGenerationStats(): SessionGenerationStats {
  return {
    elapsedMs: 0,
    attempts: 0,
    repairAttempted: false,
    repairReason: "none",
    repairDetail: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
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
    ...(process.env.NODE_ENV === "development" ? { repairDetail: stats.repairDetail } : {}),
    inputTokens: stats.inputTokens,
    cachedInputTokens: stats.cachedInputTokens,
    cacheWriteTokens: stats.cacheWriteTokens,
    outputTokens: stats.outputTokens,
  });
}

function readCachedSession(stepData: unknown) {
  if (!stepData || typeof stepData !== "object" || Array.isArray(stepData)) return null;
  const candidate = (stepData as Record<string, unknown>).generatedSession;
  const parsed = CachedGeneratedSessionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
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

import { NextResponse } from "next/server";
import { buildMaterialExcerpts } from "@/lib/materials/context";
import { isOpenAISessionConfigured } from "@/lib/openai/config";
import { generateSessionWithOpenAI } from "@/lib/openai/session-generator";
import {
  CachedGeneratedSessionSchema,
  SessionGenerationRequestSchema,
  SessionGenerationResponseSchema,
} from "@/lib/session-generation/schema";
import { checkSessionGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
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
  if (cached) {
    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: planSession.id,
      session: cached,
      generation: { mode: "cache", persistence: "supabase" },
    }), { headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
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
        .select("learning_item_id,rationale")
        .eq("id", parsed.data.planId)
        .maybeSingle(),
      supabase
        .from("learner_profiles")
        .select("common_blocker,guidance_preference,explanation_preference,focus_frequency,starting_pattern,primary_improvement_goal")
        .maybeSingle(),
      supabase
        .from("plan_sessions")
        .select("id")
        .eq("plan_id", parsed.data.planId),
    ]);

    if (planError || learnerError || planSessionsError) throw planError ?? learnerError ?? planSessionsError;
    if (!plan) return NextResponse.json({ error: "That learning plan was not found." }, { status: 404 });

    const [{ data: learningItem, error: itemError }, attemptsResult, { data: materialRows, error: materialsError }] = await Promise.all([
      supabase
        .from("learning_items")
        .select("title,topic,kind,deadline,source_mode,study_mode")
        .eq("id", plan.learning_item_id)
        .maybeSingle(),
      planSessionRows?.length
        ? supabase
          .from("session_attempts")
          .select("correct_answers,total_answers,result_data,completed_at")
          .in("plan_session_id", planSessionRows.map((session) => session.id))
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(3)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("materials")
        .select("filename,extracted_text")
        .eq("learning_item_id", plan.learning_item_id)
        .eq("processing_status", "ready")
        .order("created_at", { ascending: true })
        .limit(5),
    ]);

    if (itemError || attemptsResult.error || materialsError) throw itemError ?? attemptsResult.error ?? materialsError;
    if (!learningItem) return NextResponse.json({ error: "That learning goal was not found." }, { status: 404 });

    const materialExcerpts = buildMaterialExcerpts(materialRows ?? []);
    if (learningItem.source_mode === "user_materials" && materialExcerpts.length === 0) {
      return NextResponse.json({
        error: "YOVA could not read enough source text to build this session safely. Reopen the learning goal and add a readable PDF, TXT, or Markdown file.",
        requestId,
      }, { status: 409, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
    }

    const generated = await generateSessionWithOpenAI({
      learningGoal: {
        title: learningItem.title,
        topic: learningItem.topic,
        kind: learningItem.kind,
        deadline: learningItem.deadline,
        sourceMode: learningItem.source_mode,
        studyMode: learningItem.study_mode,
      },
      planRationale: plan.rationale,
      materials: materialExcerpts,
      session: {
        title: planSession.title,
        objective: planSession.objective,
        method: planSession.method,
        methodReason: planSession.method_rationale,
        estimatedMinutes: planSession.estimated_minutes,
      },
      learnerProfile: learnerProfile ? {
        commonBlocker: learnerProfile.common_blocker,
        guidancePreference: learnerProfile.guidance_preference,
        explanationPreference: learnerProfile.explanation_preference,
        focusFrequency: learnerProfile.focus_frequency,
        startingPattern: learnerProfile.starting_pattern,
        primaryImprovementGoal: learnerProfile.primary_improvement_goal,
      } : null,
      recentResults: (attemptsResult.data ?? []).map((attempt) => ({
        correctAnswers: attempt.correct_answers,
        totalAnswers: attempt.total_answers,
        observedGap: readTextProperty(attempt.result_data, "observedGap") || null,
      })),
    });

    const cachedSession = CachedGeneratedSessionSchema.parse({
      schemaVersion: 2,
      ...generated.draft,
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

    return NextResponse.json(SessionGenerationResponseSchema.parse({
      planSessionId: planSession.id,
      session: cachedSession,
      generation: {
        mode: "openai",
        persistence: cacheError ? "browser" : "supabase",
      },
    }), { headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
  } catch (error) {
    console.error("YOVA guided-session generation failed", { requestId, reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "YOVA could not prepare this guided session right now. Try again in a moment.", requestId },
      { status: 502, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
}

function readCachedSession(stepData: unknown) {
  if (!stepData || typeof stepData !== "object" || Array.isArray(stepData)) return null;
  const candidate = (stepData as Record<string, unknown>).generatedSession;
  const parsed = CachedGeneratedSessionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

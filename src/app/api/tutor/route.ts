import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import { buildMaterialExcerpts } from "@/lib/materials/context";
import {
  availableLearningItemIds,
  filterTutorThreads,
  isAvailablePlanStatus,
} from "@/lib/learning/plan-visibility";
import { expandedLearnerContextFromStored } from "@/lib/personalization/learner-profile";
import { generateTutorAnswer, type TutorLearningContext } from "@/lib/openai/tutor-generator";
import { isOpenAITutorConfigured } from "@/lib/openai/config";
import { checkTutorRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  releaseAIRequestClaim,
  releaseAIRequestReservation,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  TutorHistoryResponseSchema,
  TutorRequestSchema,
  TutorResponseSchema,
  TutorThreadListResponseSchema,
  type TutorProposedAction,
  type TutorRequest,
} from "@/lib/tutor/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

type TutorContextResult = {
  learningItemId: string | null;
  context: TutorLearningContext;
};

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "threads") {
      return NextResponse.json(TutorThreadListResponseSchema.parse({ threads: [] }));
    }
    return NextResponse.json(
      TutorHistoryResponseSchema.parse({ threadId: null, messages: [] }),
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in to use Ask YOVA." }, { status: 401 });

  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get("mode") === "threads") {
    try {
      const { data: threadRows, error: threadError } = await supabase
        .from("tutor_threads")
        .select("id,learning_item_id,title,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (threadError) throw threadError;

      const learningItemIds = Array.from(new Set(
        (threadRows ?? [])
          .map((thread) => thread.learning_item_id)
          .filter((value): value is string => typeof value === "string"),
      ));
      const contextTitles = await loadAvailableLearningItemTitles(supabase, learningItemIds);
      const visibleThreads = filterTutorThreads(
        (threadRows ?? []).map((thread) => ({
          id: thread.id,
          title: thread.title,
          learningItemId: thread.learning_item_id,
          createdAt: thread.created_at,
          updatedAt: thread.updated_at,
        })),
        new Set(contextTitles.keys()),
      );

      return NextResponse.json(TutorThreadListResponseSchema.parse({
        threads: visibleThreads.map((thread) => ({
          id: thread.id,
          title: thread.title,
          learningItemId: thread.learningItemId,
          contextTitle: thread.learningItemId ? contextTitles.get(thread.learningItemId) ?? "Learning goal" : null,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        })),
      }), { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "YOVA could not load your previous conversations." }, { status: 500 });
    }
  }

  const requestedThreadId = searchParams.get("threadId");
  if (requestedThreadId && !isUuid(requestedThreadId)) {
    return NextResponse.json({ error: "That tutor conversation is not valid." }, { status: 400 });
  }

  const requestedPlanId = searchParams.get("planId");
  const planId = requestedPlanId || null;
  if (planId && !isUuid(planId)) return NextResponse.json({ error: "That learning plan is not valid." }, { status: 400 });

  try {
    let threadId = requestedThreadId;
    if (threadId) {
      const { data: thread, error: threadError } = await supabase
        .from("tutor_threads")
        .select("id,learning_item_id")
        .eq("id", threadId)
        .maybeSingle();
      if (threadError) throw threadError;
      if (!thread) return NextResponse.json({ error: "That tutor conversation could not be found." }, { status: 404 });
      if (thread.learning_item_id) {
        const availableTitles = await loadAvailableLearningItemTitles(supabase, [thread.learning_item_id]);
        if (!availableTitles.has(thread.learning_item_id)) {
          return NextResponse.json({ error: "That tutor conversation could not be found." }, { status: 404 });
        }
      }
    } else {
      const { learningItemId } = await loadTutorContext(supabase, planId);
      let threadQuery = supabase
        .from("tutor_threads")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);
      threadQuery = learningItemId
        ? threadQuery.eq("learning_item_id", learningItemId)
        : threadQuery.is("learning_item_id", null);

      const { data: threadRows, error: threadError } = await threadQuery;
      if (threadError) throw threadError;
      threadId = threadRows?.[0]?.id ?? null;
    }

    if (!threadId) {
      return NextResponse.json(TutorHistoryResponseSchema.parse({ threadId: null, messages: [] }));
    }

    const { data: messageRows, error: messageError } = await supabase
      .from("tutor_messages")
      .select("id,tutor_thread_id,role,content,created_at")
      .eq("tutor_thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (messageError) throw messageError;

    return NextResponse.json(TutorHistoryResponseSchema.parse({
      threadId,
      messages: (messageRows ?? []).map((message) => ({
        id: message.id,
        threadId: message.tutor_thread_id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
      })),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof TutorPlanNotFoundError
      ? error.message
      : "YOVA could not load this tutor conversation.";
    return NextResponse.json({ error: message }, { status: error instanceof TutorPlanNotFoundError ? 404 : 500 });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Ask YOVA needs the secure cloud account connection before it can answer." },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to use Ask YOVA." }, { status: 401 });
  }

  let body: unknown;
  let aiUsageClaimId: string | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The tutor request was not valid JSON." }, { status: 400 });
  }

  const parsed = TutorRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ask YOVA needs a shorter, valid question." }, { status: 422 });
  }

  if (!isOpenAITutorConfigured()) {
    return NextResponse.json({ error: "Ask YOVA is not connected to OpenAI yet." }, { status: 503 });
  }

  const rateLimit = checkTutorRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Ask YOVA is receiving too many messages. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const planId = parsed.data.planId ?? null;
    const { learningItemId, context } = await loadTutorContext(supabase, planId);
    if (parsed.data.persistenceMode === "ephemeral" && parsed.data.sessionContext?.planSessionId) {
      context.protectedUpcomingChecks = await loadProtectedUpcomingChecks(
        supabase,
        planId,
        parsed.data.sessionContext.planSessionId,
        parsed.data.sessionContext.activityIndex ?? 0,
      );
    }
    const threadId = parsed.data.threadId ?? crypto.randomUUID();

    if (parsed.data.persistenceMode === "thread" && parsed.data.threadId) {
      const { data: existingThread, error: threadError } = await supabase
        .from("tutor_threads")
        .select("learning_item_id")
        .eq("id", parsed.data.threadId)
        .maybeSingle();
      if (threadError || !existingThread || existingThread.learning_item_id !== learningItemId) {
        return NextResponse.json({ error: "That tutor conversation does not belong to this learning goal." }, { status: 403 });
      }
    }

    let durableLimit: Awaited<ReturnType<typeof reserveAIRequest>>;
    const aiUsageRecoveryKey = crypto.randomUUID();
    try {
      durableLimit = await reserveAIRequest(supabase, "tutor_message", requestId, aiUsageRecoveryKey);
    } catch {
      await recoverUnknownTutorReservation(supabase, requestId, aiUsageRecoveryKey);
      return NextResponse.json(
        { error: "Ask YOVA paused before using OpenAI because it could not verify the account’s AI budget." },
        { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
      );
    }
    if (!durableLimit.allowed) {
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
      return NextResponse.json(
        { error: "This account has reached its Ask YOVA allowance. Try again after the limit resets." },
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
    aiUsageClaimId = durableLimit.claimId;

    const proposedAction = parsed.data.persistenceMode === "ephemeral"
      ? null
      : buildTutorProposedAction(parsed.data, planId, context);
    const generated = await generateTutorAnswer(parsed.data, context, proposedAction);
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const userCreatedAt = new Date().toISOString();
    const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
    let persistence: "browser" | "supabase" | "ephemeral" = parsed.data.persistenceMode === "ephemeral"
      ? "ephemeral"
      : "supabase";
    // Validate the complete exchange before the persistence RPC commits it.
    // Only the already-bounded persistence marker may change afterward.
    let response = TutorResponseSchema.parse({
      threadId,
      messages: [
        {
          id: userMessageId,
          threadId,
          role: "user",
          content: parsed.data.question,
          createdAt: userCreatedAt,
        },
        {
          id: assistantMessageId,
          threadId,
          role: "assistant",
          content: generated.answer,
          createdAt: assistantCreatedAt,
        },
      ],
      model: generated.model,
      persistence,
      proposedAction,
    });

    if (parsed.data.persistenceMode === "thread") {
      const { error: persistenceError } = await supabase.rpc("save_tutor_exchange", {
        payload: {
          threadId,
          learningItemId,
          title: parsed.data.question,
          userMessageId,
          userMessage: parsed.data.question,
          assistantMessageId,
          assistantMessage: generated.answer,
          model: generated.model,
          responseId: generated.responseId,
        },
      });
      if (persistenceError) {
        persistence = "browser";
        console.error("YOVA tutor persistence failed", { requestId });
        response = { ...response, persistence };
      }
    }

    await settleSuccessfulTutorClaim(supabase, aiUsageClaimId, requestId);
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
        "X-Yova-Request-Id": requestId,
      },
    });
  } catch (error) {
    await releaseFailedTutorClaim(supabase, aiUsageClaimId, requestId);
    const message = error instanceof TutorPlanNotFoundError
      ? error.message
      : "Ask YOVA could not answer right now. Try again in a moment.";
    const status = error instanceof TutorPlanNotFoundError ? 404 : 502;
    console.error("YOVA tutor request failed", { requestId, reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}

async function settleSuccessfulTutorClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful tutor allowance claim", { requestId });
    }
  } catch {
    console.error("YOVA could not settle a successful tutor allowance claim", { requestId });
  }
}

async function releaseFailedTutorClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string | null,
  requestId: string,
) {
  if (!claimId) return;
  try {
    await releaseAIRequestClaim(supabase, claimId);
  } catch {
    console.error("YOVA could not return a failed tutor allowance claim", { requestId });
  }
}

async function recoverUnknownTutorReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await releaseAIRequestReservation(supabase, "tutor_message", operationKey, recoveryKey);
  } catch {
    // Its short database lease remains the final recovery boundary.
  }
}

async function loadProtectedUpcomingChecks(
  supabase: SupabaseClient,
  planId: string | null,
  planSessionId: string,
  currentActivityIndex: number,
) {
  if (!planId) return [];
  const { data: session, error } = await supabase
    .from("plan_sessions")
    .select("step_data")
    .eq("id", planSessionId)
    .eq("plan_id", planId)
    .maybeSingle();
  if (error || !session) return [];

  const stepData = isRecord(session.step_data) ? session.step_data : {};
  const generatedSession = isRecord(stepData.generatedSession) ? stepData.generatedSession : {};
  const activities = Array.isArray(generatedSession.activities) ? generatedSession.activities : [];
  return activities
    .slice(currentActivityIndex + 1)
    .filter((activity): activity is Record<string, unknown> => isRecord(activity))
    .filter((activity) => activity.type === "multiple_choice" || activity.type === "free_response")
    .slice(0, 6)
    .map((activity) => ({
      title: readBoundedString(activity.title, 180) ?? "Upcoming check",
      prompt: readBoundedString(activity.body, 500)
        ?? readBoundedString(activity.question, 500)
        ?? readBoundedString(activity.instruction, 500)
        ?? "Upcoming knowledge check",
      choices: Array.isArray(activity.choices)
        ? activity.choices
          .filter((choice): choice is string => typeof choice === "string")
          .map((choice) => choice.slice(0, 220))
          .slice(0, 5)
        : [],
      correctAnswer: readBoundedString(activity.correctAnswer, 800),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoundedString(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

async function loadTutorContext(supabase: SupabaseClient, planId: string | null): Promise<TutorContextResult> {
  const { data: learnerProfile, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("common_blocker,guidance_preference,explanation_preference,primary_improvement_goal,additional_context")
    .maybeSingle();
  if (learnerError) throw learnerError;

  const profile = learnerProfile ? {
    commonBlocker: learnerProfile.common_blocker,
    guidancePreference: learnerProfile.guidance_preference,
    explanationPreference: learnerProfile.explanation_preference,
    primaryImprovementGoal: learnerProfile.primary_improvement_goal,
    ...expandedLearnerContextFromStored(learnerProfile.additional_context),
  } : null;

  if (!planId) {
    return {
      learningItemId: null,
      context: {
        title: null,
        topic: null,
        planRationale: null,
        materials: [],
        currentSession: null,
        learnerProfile: profile,
      },
    };
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("learning_item_id,rationale,status")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new TutorPlanNotFoundError("That learning plan could not be found.");
  if (!isAvailablePlanStatus(plan.status)) {
    throw new TutorPlanNotFoundError("That learning plan is no longer available to Ask YOVA.");
  }

  const { data: item, error: itemError } = await supabase
    .from("learning_items")
    .select("title,topic,status")
    .eq("id", plan.learning_item_id)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item || !isAvailablePlanStatus(item.status)) {
    throw new TutorPlanNotFoundError("That learning goal is no longer available to Ask YOVA.");
  }

  const [{ data: sessionRows, error: sessionError }, { data: materialRows, error: materialsError }] = await Promise.all([
    supabase
      .from("plan_sessions")
      .select("id,title,objective,method,method_rationale,estimated_minutes")
      .eq("plan_id", planId)
      .in("status", ["ready", "upcoming"])
      .order("sequence", { ascending: true })
      .limit(1),
    supabase
      .from("materials")
      .select("filename,extracted_text")
      .eq("learning_item_id", plan.learning_item_id)
      .eq("processing_status", "ready")
      .order("created_at", { ascending: true })
      .limit(5),
  ]);
  if (sessionError || materialsError) throw sessionError ?? materialsError;

  const currentSessionRow = sessionRows?.[0] ?? null;
  return {
    learningItemId: plan.learning_item_id,
    context: {
      title: item.title,
      topic: item.topic,
      planRationale: plan.rationale,
      materials: buildMaterialExcerpts(materialRows ?? []),
      currentSession: currentSessionRow ? {
        id: currentSessionRow.id,
        title: currentSessionRow.title,
        objective: currentSessionRow.objective,
        method: currentSessionRow.method,
        methodReason: currentSessionRow.method_rationale,
        estimatedMinutes: currentSessionRow.estimated_minutes,
      } : null,
      learnerProfile: profile,
    },
  };
}

async function loadAvailableLearningItemTitles(
  supabase: SupabaseClient,
  learningItemIds: string[],
) {
  if (learningItemIds.length === 0) return new Map<string, string>();

  const [{ data: itemRows, error: itemError }, { data: planRows, error: planError }] = await Promise.all([
    supabase
      .from("learning_items")
      .select("id,title,status")
      .in("id", learningItemIds),
    supabase
      .from("plans")
      .select("learning_item_id,status")
      .in("learning_item_id", learningItemIds),
  ]);
  if (itemError || planError) throw itemError ?? planError;

  const availableItemIds = availableLearningItemIds(
    (planRows ?? []).flatMap((plan) => (
      typeof plan.learning_item_id === "string"
        ? [{ learningItemId: plan.learning_item_id, status: plan.status }]
        : []
    )),
  );

  return new Map(
    (itemRows ?? []).flatMap((item) => (
      typeof item.id === "string"
      && typeof item.title === "string"
      && isAvailablePlanStatus(item.status)
      && availableItemIds.has(item.id)
        ? [[item.id, item.title] as const]
        : []
    )),
  );
}

function buildTutorProposedAction(
  request: TutorRequest,
  planId: string | null,
  context: TutorLearningContext,
): TutorProposedAction | null {
  if (!planId || !context.currentSession) return null;

  const directionRequest = extractPlanDirectionRequest(request.question);
  if (directionRequest) {
    return {
      id: crypto.randomUUID(),
      type: "redirect_plan",
      planId,
      direction: directionRequest,
      title: "Redirect the unfinished plan",
      explanation: "YOVA will preserve completed work and rebuild only the unfinished sessions around this direction. Review the proposal before applying it.",
    };
  }

  if (request.sessionContext) return null;

  const minuteMatch = request.question.match(/\b(\d{1,2})\s*(?:minutes?|mins?)\b/i);
  const asksToChangeSession = /\b(?:only have|shorten|shorter|reduce|change|make|fit|condense|cut)\b/i.test(request.question);
  if (!minuteMatch || !asksToChangeSession) return null;

  const minutes = Number(minuteMatch[1]);
  if (!Number.isInteger(minutes) || minutes < 10 || minutes >= context.currentSession.estimatedMinutes) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    type: "shorten_current_session",
    planId,
    planSessionId: context.currentSession.id,
    minutes,
    title: `Make “${context.currentSession.title}” ${minutes} minutes`,
    explanation: "YOVA will divide the plan's unfinished content into safe shorter windows. Completed work stays unchanged, and you will review the change before starting.",
  };
}

function extractPlanDirectionRequest(question: string) {
  const normalized = question.trim().replace(/\s+/g, " ");
  const explicitlyRejectsWork = /\b(?:do not|don't|dont|no longer|stop|avoid|remove|skip|less|without)\b.{0,70}\b(?:math|maths|calculation|calculations|formula|formulas|practice|quizzes|quiz|topic|section|content)\b/i.test(normalized);
  const explicitlyRedirects = /\b(?:change|adjust|update|redirect|rebuild|revise)\b.{0,45}\b(?:course|plan|sessions?|direction|focus|content)\b/i.test(normalized)
    || /\b(?:focus|concentrate)\b.{0,25}\b(?:on|more on)\b/i.test(normalized)
    || /\b(?:wrong track|not what i want|course should|plan should|instead focus)\b/i.test(normalized);
  if (!explicitlyRejectsWork && !explicitlyRedirects) return null;
  return normalized.slice(0, 500);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class TutorPlanNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TutorPlanNotFoundError";
  }
}

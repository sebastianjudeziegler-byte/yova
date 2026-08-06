import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMaterialExcerpts } from "@/lib/materials/context";
import { generateTutorAnswer, type TutorLearningContext } from "@/lib/openai/tutor-generator";
import { isOpenAITutorConfigured } from "@/lib/openai/config";
import { checkTutorRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  TutorHistoryResponseSchema,
  TutorRequestSchema,
  TutorResponseSchema,
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
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in to use Ask YOVA." }, { status: 401 });

  const requestedPlanId = new URL(request.url).searchParams.get("planId");
  const planId = requestedPlanId || null;
  if (planId && !isUuid(planId)) return NextResponse.json({ error: "That learning plan is not valid." }, { status: 400 });

  try {
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
    const threadId = threadRows?.[0]?.id ?? null;

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
  } catch {
    return NextResponse.json({ error: "YOVA could not load this tutor conversation." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to use Ask YOVA." }, { status: 401 });
  }

  let body: unknown;
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
    const threadId = parsed.data.threadId ?? crypto.randomUUID();

    if (parsed.data.threadId) {
      const { data: existingThread, error: threadError } = await supabase
        .from("tutor_threads")
        .select("learning_item_id")
        .eq("id", parsed.data.threadId)
        .maybeSingle();
      if (threadError || !existingThread || existingThread.learning_item_id !== learningItemId) {
        return NextResponse.json({ error: "That tutor conversation does not belong to this learning goal." }, { status: 403 });
      }
    }

    let durableLimit: Awaited<ReturnType<typeof claimAIRequest>>;
    try {
      durableLimit = await claimAIRequest(supabase, "tutor_message");
    } catch {
      return NextResponse.json(
        { error: "Ask YOVA paused before using OpenAI because it could not verify the account’s AI budget." },
        { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
      );
    }
    if (!durableLimit.allowed) {
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

    const proposedAction = buildTutorProposedAction(parsed.data, planId, context);
    const generated = await generateTutorAnswer(parsed.data, context, proposedAction);
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const userCreatedAt = new Date().toISOString();
    const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
    let persistence: "browser" | "supabase" = "supabase";

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
    }

    return NextResponse.json(TutorResponseSchema.parse({
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
    }), {
      headers: {
        "Cache-Control": "no-store",
        "X-Yova-Request-Id": requestId,
      },
    });
  } catch (error) {
    const message = error instanceof TutorPlanNotFoundError
      ? error.message
      : "Ask YOVA could not answer right now. Try again in a moment.";
    const status = error instanceof TutorPlanNotFoundError ? 404 : 502;
    console.error("YOVA tutor request failed", { requestId, reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}

async function loadTutorContext(supabase: SupabaseClient, planId: string | null): Promise<TutorContextResult> {
  const { data: learnerProfile, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("common_blocker,guidance_preference,explanation_preference,primary_improvement_goal")
    .maybeSingle();
  if (learnerError) throw learnerError;

  const profile = learnerProfile ? {
    commonBlocker: learnerProfile.common_blocker,
    guidancePreference: learnerProfile.guidance_preference,
    explanationPreference: learnerProfile.explanation_preference,
    primaryImprovementGoal: learnerProfile.primary_improvement_goal,
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
    .select("learning_item_id,rationale")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new TutorPlanNotFoundError("That learning plan could not be found.");

  const [{ data: item, error: itemError }, { data: sessionRows, error: sessionError }, { data: materialRows, error: materialsError }] = await Promise.all([
    supabase
      .from("learning_items")
      .select("title,topic")
      .eq("id", plan.learning_item_id)
      .maybeSingle(),
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
  if (itemError || sessionError || materialsError) throw itemError ?? sessionError ?? materialsError;
  if (!item) throw new TutorPlanNotFoundError("That learning goal could not be found.");

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

function buildTutorProposedAction(
  request: TutorRequest,
  planId: string | null,
  context: TutorLearningContext,
): TutorProposedAction | null {
  if (!planId || request.sessionContext || !context.currentSession) return null;

  const minuteMatch = request.question.match(/\b(\d{1,2})\s*(?:minutes?|mins?)\b/i);
  const asksToChangeSession = /\b(?:only have|shorten|shorter|reduce|change|make|fit|condense|cut)\b/i.test(request.question);
  if (!minuteMatch || !asksToChangeSession) return null;

  const minutes = Number(minuteMatch[1]);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes >= context.currentSession.estimatedMinutes) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    type: "shorten_current_session",
    planId,
    planSessionId: context.currentSession.id,
    minutes,
    title: `Make “${context.currentSession.title}” ${minutes} minutes`,
    explanation: "Only this unfinished session will change. YOVA will regenerate its activities to fit the shorter time when you start it.",
  };
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

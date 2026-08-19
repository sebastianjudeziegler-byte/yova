import { NextResponse } from "next/server";
import {
  PlanAdjustmentRequestSchema,
  PlanAdjustmentResponseSchema,
} from "@/lib/learning/adjustment-schema";
import {
  buildContentBasedReplacementSessions,
  MAX_ADJUSTED_PLAN_SESSIONS,
  PlanAdjustmentPartLimitError,
  type AdjustableSessionRow,
} from "@/lib/learning/content-based-plan-adjustment";
import {
  applyPlanDirectionFallback,
  planDirectionConflictsWithRequest,
} from "@/lib/learning/plan-direction";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { redirectPlanWithOpenAI } from "@/lib/openai/plan-redirector";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before adjusting a plan." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The plan adjustment was not valid JSON." }, { status: 400 });
  }

  const parsed = PlanAdjustmentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Review the deadline, study mode, and session length.",
      fields: parsed.error.flatten().fieldErrors,
    }, { status: 422 });
  }

  const { data: sessionRows, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data")
    .eq("plan_id", parsed.data.planId)
    .eq("user_id", user.id)
    .order("sequence", { ascending: true });
  if (sessionError || !sessionRows) {
    return NextResponse.json({ error: "YOVA could not load the unfinished content in that plan." }, { status: 409 });
  }
  const { data: planRow, error: planError } = await supabase
    .from("plans")
    .select("learning_item_id,knowledge_map")
    .eq("id", parsed.data.planId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError || !planRow) {
    return NextResponse.json({ error: "YOVA could not find the learning goal behind that plan." }, { status: 404 });
  }
  const knowledgeMap = PlanKnowledgeMapSchema.safeParse(planRow.knowledge_map);
  if (!knowledgeMap.success) {
    return NextResponse.json({ error: "YOVA could not safely read this plan's topic map." }, { status: 409 });
  }
  const settledSequences = sessionRows
    .filter((session) => session.status === "complete" || session.status === "skipped")
    .map((session) => session.sequence);
  const unfinished = sessionRows.filter((session) => session.status === "ready" || session.status === "upcoming") as AdjustableSessionRow[];
  let redirectedUnfinished = unfinished;
  if (parsed.data.direction) {
    const { data: itemRow, error: itemError } = await supabase
      .from("learning_items")
      .select("title,topic")
      .eq("id", planRow.learning_item_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (itemError || !itemRow) {
      return NextResponse.json({ error: "YOVA could not load that learning goal." }, { status: 409 });
    }

    try {
      const generated = await redirectPlanWithOpenAI({
        title: itemRow.title,
        topic: itemRow.topic,
        direction: parsed.data.direction,
        sessions: unfinished,
      });
      redirectedUnfinished = planDirectionConflictsWithRequest(generated, parsed.data.direction)
        ? applyPlanDirectionFallback(unfinished, parsed.data.direction, itemRow.topic)
        : generated;
    } catch {
      redirectedUnfinished = applyPlanDirectionFallback(unfinished, parsed.data.direction, itemRow.topic);
    }
  }

  if (parsed.data.includeDeferred) {
    const includedTopicIds = new Set(redirectedUnfinished.flatMap((session) => readTopicIds(session.step_data)));
    const deferredTopics = knowledgeMap.data.topics.filter((topic) => topic.deferred && !includedTopicIds.has(topic.id));
    const lastScheduled = redirectedUnfinished.reduce((latest, session) => {
      const timestamp = session.scheduled_for ? new Date(session.scheduled_for).getTime() : 0;
      return Math.max(latest, Number.isFinite(timestamp) ? timestamp : 0);
    }, Date.now());
    const appended = deferredTopics.map((topic, index): AdjustableSessionRow => ({
      id: crypto.randomUUID(),
      sequence: sessionRows.length + index + 1,
      title: `Learn ${topic.title}`,
      objective: `Build an accurate model of ${topic.title}, then produce one independent check tied to this topic.`,
      method: "Guided explanation and self-explanation",
      method_rationale: "This topic was outside the original time budget, so YOVA will teach it before asking for independent evidence.",
      scheduled_for: new Date(lastScheduled + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
      estimated_minutes: parsed.data.futureSessionMinutes,
      status: "upcoming",
      step_data: {
        learningMode: "learn",
        topicIds: [topic.id],
        contentTargets: [topic.title, ...topic.subtopics.slice(0, 3)],
        completionEvidence: [`Explain ${topic.title} accurately and complete one independent check`],
      },
    }));
    redirectedUnfinished = [...redirectedUnfinished, ...appended];
  }

  let replacementSessions: ReturnType<typeof buildContentBasedReplacementSessions>;
  try {
    replacementSessions = buildContentBasedReplacementSessions(
      redirectedUnfinished,
      parsed.data.futureSessionMinutes,
      Math.max(0, ...settledSequences) + 1,
      MAX_ADJUSTED_PLAN_SESSIONS - settledSequences.length,
    );
  } catch (error) {
    if (error instanceof PlanAdjustmentPartLimitError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
  if (!replacementSessions.length) {
    return NextResponse.json({ error: "This plan has no unfinished content to adjust." }, { status: 409 });
  }
  const replacementTopicIds = new Set(replacementSessions.flatMap((session) => session.topicIds));
  const revisedKnowledgeMap = parsed.data.includeDeferred ? {
    ...knowledgeMap.data,
    topics: knowledgeMap.data.topics.map((topic) => replacementTopicIds.has(topic.id)
      ? { ...topic, deferred: null }
      : topic),
  } : knowledgeMap.data;

  const { data, error } = await supabase.rpc("adjust_learning_plan", {
    payload: {
      ...parsed.data,
      sessions: replacementSessions,
      knowledgeMap: revisedKnowledgeMap,
    },
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not adjust that plan." }, { status: 409 });
  }

  const response = PlanAdjustmentResponseSchema.safeParse({
    ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
    directionApplied: parsed.data.direction ?? null,
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA updated the plan but could not confirm every change." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

function readTopicIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>).topicIds;
  return Array.isArray(candidate)
    ? candidate.filter((topicId): topicId is string => typeof topicId === "string")
    : [];
}

import { NextResponse } from "next/server";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  PlanAdjustmentRequestSchema,
  PlanAdjustmentResponseSchema,
} from "@/lib/learning/adjustment-schema";
import {
  buildProtectedPlanAdjustmentSessions,
  MAX_ADJUSTED_PLAN_SESSIONS,
  PlanAdjustmentPartLimitError,
  PlanAdjustmentProtectedSessionError,
  scheduledRetrievalMetadataFromStepData,
  sessionStepDataHasSavedWork,
  type AdjustableSessionRow,
} from "@/lib/learning/content-based-plan-adjustment";
import {
  applyPlanDirectionFallback,
  planDirectionConflictsWithRequest,
} from "@/lib/learning/plan-direction";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { isOpenAISessionConfigured } from "@/lib/openai/config";
import { redirectPlanWithOpenAI } from "@/lib/openai/plan-redirector";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import {
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { preparePlanAdjustmentStudyRoutes } from "@/lib/study-route/plan-adjustment";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const requestId = operationRequestId(request);
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
    .select("id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data,committed_route_revision_id")
    .eq("plan_id", parsed.data.planId)
    .eq("user_id", user.id)
    .order("sequence", { ascending: true });
  if (sessionError || !sessionRows) {
    return NextResponse.json({ error: "YOVA could not load the unfinished content in that plan." }, { status: 409 });
  }
  const { data: planRow, error: planError } = await supabase
    .from("plans")
    .select("learning_item_id,knowledge_map,status,rationale,generation_inputs,created_at")
    .eq("id", parsed.data.planId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError || !planRow) {
    return NextResponse.json({ error: "YOVA could not find the learning goal behind that plan." }, { status: 404 });
  }
  const { data: itemRow, error: itemError } = await supabase
    .from("learning_items")
    .select("id,title,kind,topic,deadline,source_mode,study_mode,created_at")
    .eq("id", planRow.learning_item_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (itemError || !itemRow) {
    return NextResponse.json({ error: "YOVA could not load that learning goal." }, { status: 409 });
  }
  const { data: routeRows, error: routeError } = await supabase
    .from("study_routes")
    .select("route_revision_id,route_lineage_id,revision_number,schema_version,lifecycle,plan_id,plan_session_id,predecessor_revision_id,route_payload,created_at,committed_at")
    .eq("plan_id", parsed.data.planId)
    .eq("lifecycle", "committed");
  if (routeError || !routeRows) {
    return NextResponse.json({ error: "YOVA could not verify this plan's committed study routes." }, { status: 409 });
  }
  const currentPlan = currentLearningPlanFromRows({
    planId: parsed.data.planId,
    planRow,
    itemRow,
    sessionRows,
    routeRows,
  });
  if (!currentPlan) {
    return NextResponse.json({ error: "YOVA could not safely reconstruct this plan's current study routes." }, { status: 409 });
  }
  const knowledgeMap = PlanKnowledgeMapSchema.safeParse(planRow.knowledge_map);
  if (!knowledgeMap.success) {
    return NextResponse.json({ error: "YOVA could not safely read this plan's topic map." }, { status: 409 });
  }
  const settledSequences = sessionRows
    .filter((session) => (
      session.status === "complete"
      || (
        session.status === "skipped"
        && !readTextFromObject(session.step_data, "routeAdjustmentRetiredAt")
      )
    ))
    .map((session) => session.sequence);
  const unfinished = sessionRows.filter((session) => session.status === "ready" || session.status === "upcoming") as AdjustableSessionRow[];
  const protectedReviews = unfinished.filter((session) => (
    scheduledRetrievalMetadataFromStepData(session.step_data)
  ));
  const adjustableUnfinished = unfinished.filter((session) => (
    !scheduledRetrievalMetadataFromStepData(session.step_data)
  ));
  const adjustableSessionIds = adjustableUnfinished.map((session) => session.id);
  const interruptedSessionIds = new Set<string>();
  if (adjustableSessionIds.length) {
    const { data: interruptionRows, error: interruptionError } = await supabase
      .from("learning_events")
      .select("plan_session_id")
      .eq("user_id", user.id)
      .eq("event_type", "session_interrupted")
      .in("plan_session_id", adjustableSessionIds);
    if (interruptionError) {
      return NextResponse.json({
        error: "YOVA could not verify whether an unfinished session has saved work. Nothing was changed.",
        code: "plan_adjustment_rewrite_safety_unverified",
      }, { status: 409 });
    }
    (interruptionRows ?? []).forEach((row) => {
      if (typeof row.plan_session_id === "string") interruptedSessionIds.add(row.plan_session_id);
    });
  }
  const savedWorkSession = adjustableUnfinished.find((session) => (
    sessionStepDataHasSavedWork(session.step_data)
    || interruptedSessionIds.has(session.id)
  ));
  if (savedWorkSession) {
    return NextResponse.json({
      error: "This plan has an unfinished session with saved work. Finish that session before rebuilding the remaining plan.",
      code: "plan_adjustment_saved_work_protected",
      planSessionId: savedWorkSession.id,
    }, { status: 409 });
  }

  let redirectedUnfinished = adjustableUnfinished;
  if (parsed.data.direction && adjustableUnfinished.length) {
    let generated: AdjustableSessionRow[] | null = null;
    if (isOpenAISessionConfigured()) {
      const recoveryKey = crypto.randomUUID();
      let reservation: Awaited<ReturnType<typeof reserveAIRequest>> | null = null;
      try {
        reservation = await reserveAIRequest(
          supabase,
          "plan_adjustment",
          requestId,
          recoveryKey,
        );
      } catch {
        await recoverUnknownPlanAdjustmentReservation(supabase, requestId, recoveryKey);
      }
      if (reservation && !reservation.allowed) {
        const conflict = aiUsageReservationConflict(reservation);
        if (conflict) {
          return NextResponse.json({
            code: conflict.code,
            error: conflict.error,
            retryable: conflict.retryable,
          }, {
            status: 409,
            headers: {
              "Cache-Control": "no-store",
              ...(conflict.retryAfterSeconds === null ? {} : {
                "Retry-After": String(conflict.retryAfterSeconds),
              }),
              "X-Yova-Request-Id": requestId,
            },
          });
        }
      }
      if (reservation?.allowed) {
        if (await consumePlanAdjustmentClaim(supabase, reservation.claimId, requestId)) {
          try {
            generated = await redirectPlanWithOpenAI({
              title: itemRow.title,
              topic: itemRow.topic,
              direction: parsed.data.direction,
              sessions: adjustableUnfinished,
            });
          } catch {
            // Paid provider attempts stay consumed even when the response is
            // unavailable or invalid, preventing repeated denial-of-wallet.
          }
        } else {
          await recoverUnknownPlanAdjustmentReservation(supabase, requestId, recoveryKey);
        }
      }
    }
    redirectedUnfinished = generated && !planDirectionConflictsWithRequest(generated, parsed.data.direction)
      ? generated
      : applyPlanDirectionFallback(adjustableUnfinished, parsed.data.direction, itemRow.topic);
  }

  const newSessionOriginIds: Record<string, string> = {};
  if (parsed.data.includeDeferred) {
    const includedTopicIds = new Set(redirectedUnfinished.flatMap((session) => readTopicIds(session.step_data)));
    const deferredTopics = knowledgeMap.data.topics.filter((topic) => topic.deferred && !includedTopicIds.has(topic.id));
    const lastScheduled = redirectedUnfinished.reduce((latest, session) => {
      const timestamp = session.scheduled_for ? new Date(session.scheduled_for).getTime() : 0;
      return Math.max(latest, Number.isFinite(timestamp) ? timestamp : 0);
    }, Date.now());
    const exactDeferredOriginId = [...adjustableUnfinished]
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1)?.id
      ?? [...unfinished].sort((left, right) => left.sequence - right.sequence).at(-1)?.id
      ?? [...sessionRows].sort((left, right) => left.sequence - right.sequence).at(-1)?.id;
    const appended = deferredTopics.map((topic, index): AdjustableSessionRow => {
      const id = crypto.randomUUID();
      if (exactDeferredOriginId) newSessionOriginIds[id] = exactDeferredOriginId;
      return {
      id,
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
    }; });
    redirectedUnfinished = [...redirectedUnfinished, ...appended];
  }

  let replacementSessions: ReturnType<typeof buildProtectedPlanAdjustmentSessions>;
  try {
    replacementSessions = buildProtectedPlanAdjustmentSessions(
      [...redirectedUnfinished, ...protectedReviews],
      parsed.data.futureSessionMinutes,
      Math.max(0, ...settledSequences) + 1,
      MAX_ADJUSTED_PLAN_SESSIONS - settledSequences.length,
    );
  } catch (error) {
    if (error instanceof PlanAdjustmentPartLimitError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof PlanAdjustmentProtectedSessionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
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

  let routedReplacementSessions: LearningPlanSession[];
  try {
    routedReplacementSessions = preparePlanAdjustmentStudyRoutes({
      plan: currentPlan,
      replacementSessions,
      nextStudyMode: parsed.data.studyMode,
      changedAt: new Date().toISOString(),
      reason: parsed.data.direction
        ?? "The learner changed the remaining plan schedule, duration, or execution environment.",
      newSessionOriginIds,
    });
  } catch {
    return NextResponse.json({
      error: "YOVA could not preserve the exact study decisions while adjusting that plan. Nothing was changed.",
      code: "plan_adjustment_route_safety_unverified",
    }, { status: 409 });
  }

  const { data, error } = await supabase.rpc("adjust_learning_plan_with_routes", {
    payload: {
      ...parsed.data,
      sessions: routedReplacementSessions,
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

  return NextResponse.json(response.data, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

async function consumePlanAdjustmentClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    const consumed = await settleAIRequestClaim(supabase, claimId);
    if (!consumed) {
      console.error("YOVA could not settle a plan-adjustment allowance claim", { requestId });
    }
    return consumed;
  } catch {
    console.error("YOVA could not settle a plan-adjustment allowance claim", { requestId });
    return false;
  }
}

async function recoverUnknownPlanAdjustmentReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(
      supabase,
      "plan_adjustment",
      operationKey,
      recoveryKey,
    );
  } catch {
    // If recovery cannot be confirmed, lease expiry conservatively consumes
    // the attempt so an ambiguous provider charge can never be refunded.
  }
}

function operationRequestId(request: Request) {
  const candidate = request.headers.get("X-Yova-Request-Id")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function readTopicIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>).topicIds;
  return Array.isArray(candidate)
    ? candidate.filter((topicId): topicId is string => typeof topicId === "string")
    : [];
}

type CurrentPlanSessionRow = AdjustableSessionRow & {
  committed_route_revision_id?: string | null;
};

type CurrentStudyRouteRow = {
  route_revision_id: string;
  route_lineage_id: string;
  revision_number: number;
  schema_version: number;
  lifecycle: string;
  plan_id: string;
  plan_session_id: string;
  predecessor_revision_id: string | null;
  route_payload: unknown;
  created_at: string;
  committed_at: string | null;
};

function currentLearningPlanFromRows({
  planId,
  planRow,
  itemRow,
  sessionRows,
  routeRows,
}: {
  planId: string;
  planRow: Record<string, unknown>;
  itemRow: Record<string, unknown>;
  sessionRows: CurrentPlanSessionRow[];
  routeRows: CurrentStudyRouteRow[];
}): LearningPlan | null {
  const routes = new Map<string, StudyRoute>();
  for (const row of routeRows) {
    const route = studyRouteFromRow(row);
    if (!route) return null;
    routes.set(row.route_revision_id, route);
  }
  const fallbackSchedule = readText(planRow.created_at) || readText(itemRow.created_at);
  const sessions: LearningPlanSession[] = [];
  for (const row of sessionRows) {
    const routeId = row.committed_route_revision_id ?? null;
    const studyRoute = routeId ? routes.get(routeId) : undefined;
    if (routeId && (
      !studyRoute
      || studyRoute.identity.planId !== planId
      || studyRoute.identity.sessionId !== row.id
    )) return null;
    const reviewType = readTextFromObject(row.step_data, "reviewType");
    const learningMode = readTextFromObject(row.step_data, "learningMode");
    sessions.push({
      id: row.id,
      sequence: row.sequence,
      title: row.title,
      objective: row.objective,
      method: row.method,
      methodReason: row.method_rationale,
      scheduledFor: row.scheduled_for ?? fallbackSchedule,
      estimatedMinutes: row.estimated_minutes,
      amountLabel: readTextFromObject(row.step_data, "amountLabel") || `${row.estimated_minutes} min`,
      learningMode: learningMode === "learn" ? "learn" : "study",
      topicIds: readStringArray(row.step_data, "topicIds"),
      contentTargets: readStringArray(row.step_data, "contentTargets"),
      completionEvidence: readStringArray(row.step_data, "completionEvidence"),
      originSessionId: readTextFromObject(row.step_data, "originSessionId") || undefined,
      originalContentMinutes: readPositiveInteger(row.step_data, "originalContentMinutes"),
      segmentIndex: readPositiveInteger(row.step_data, "segmentIndex"),
      segmentCount: readPositiveInteger(row.step_data, "segmentCount"),
      reviewConcept: readTextFromObject(row.step_data, "reviewConcept") || undefined,
      reviewType: reviewType === "repair_and_retrieve"
        || reviewType === "verify"
        || reviewType === "maintenance_transfer"
        ? reviewType
        : undefined,
      status: row.status,
      ...(studyRoute ? { studyRoute } : {}),
    });
  }
  const kind = readText(itemRow.kind);
  const sourceMode = readText(itemRow.source_mode);
  const studyMode = readText(itemRow.study_mode);
  const status = readText(planRow.status);
  if (
    !fallbackSchedule
    || !["test", "topic", "course", "book", "skill"].includes(kind)
    || !["user_materials", "yova_generated"].includes(sourceMode)
    || !["inside_yova", "outside_yova"].includes(studyMode)
    || !["draft", "active", "completed", "archived"].includes(status)
  ) return null;
  return {
    id: planId,
    learningItemId: readText(planRow.learning_item_id),
    title: readText(itemRow.title),
    topic: readText(itemRow.topic),
    kind: kind as LearningPlan["kind"],
    deadline: readText(itemRow.deadline) || null,
    status: status as LearningPlan["status"],
    sourceMode: sourceMode as LearningPlan["sourceMode"],
    studyMode: studyMode as LearningPlan["studyMode"],
    learningIntent: sessions.some((session) => session.learningMode === "learn") ? "learn" : "study",
    rationale: readText(planRow.rationale),
    createdAt: fallbackSchedule,
    sessions,
  };
}

function studyRouteFromRow(row: CurrentStudyRouteRow) {
  if (!row.route_payload || typeof row.route_payload !== "object" || Array.isArray(row.route_payload)) {
    return null;
  }
  const parsed = StudyRouteSchema.safeParse({
    ...(row.route_payload as Record<string, unknown>),
    identity: {
      routeLineageId: row.route_lineage_id,
      routeRevisionId: row.route_revision_id,
      revisionNumber: row.revision_number,
      schemaVersion: row.schema_version,
      lifecycleStatus: row.lifecycle,
      planId: row.plan_id,
      sessionId: row.plan_session_id,
      createdAt: normalizeTimestamp(row.created_at),
      ...(row.committed_at ? { committedAt: normalizeTimestamp(row.committed_at) } : {}),
      ...(row.predecessor_revision_id ? { supersedesRevisionId: row.predecessor_revision_id } : {}),
    },
  });
  return parsed.success ? parsed.data : null;
}

function normalizeTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function readText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readTextFromObject(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return readText((value as Record<string, unknown>)[key]);
}

function readStringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readPositiveInteger(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

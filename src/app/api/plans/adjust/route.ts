import { deferredTopicSessionFields } from "@/lib/learning/deferred-topic-session";
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
  UnverifiedPlanDirectionError,
} from "@/lib/learning/plan-direction";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { preparePlanAdjustmentStudyRoutes } from "@/lib/study-route/plan-adjustment";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readPlanSchedulePreferences } from "@/lib/scheduling/plan-schedule-preferences";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PlanRevisionPreviewRequestSchema } from "@/lib/plan-revision/revision-schema";
import { previewPlanRevision, PlanRevisionRequestError } from "@/lib/plan-revision/preview-service";
import { MapDeltaError } from "@/lib/plan-revision/map-delta";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function PATCH(request: Request) {
  const requestId = operationRequestId(request);
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
  if (!developmentPreview && (userError || !user)) {
    return NextResponse.json({ error: "Sign in before adjusting a plan." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The plan adjustment was not valid JSON." }, { status: 400 });
  }

  if (body && typeof body === "object" && "action" in body) {
    const revision = PlanRevisionPreviewRequestSchema.safeParse(body);
    if (!revision.success) return NextResponse.json({ error: "Review the topic changes and preview controls." }, { status: 422 });
    try {
      const result = await previewPlanRevision({ input: revision.data, supabase, userId: user?.id ?? null, developmentPreview, now: new Date() });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof MapDeltaError || error instanceof PlanRevisionRequestError) return NextResponse.json({ error: error.message }, { status: error instanceof PlanRevisionRequestError ? error.status : 422 });
      console.error("Structured plan revision preview failed", error);
      return NextResponse.json({ error: "YOVA could not prepare that change. Your plan has not changed." }, { status: 503 });
    }
  }
  if (!supabase || !user) return NextResponse.json({ error: "Sign in before adjusting a plan." }, { status: 401 });

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
    // A provider-supplied topic alias cannot prove that new prose belongs to
    // that topic. Until map-changing revisions have a reviewed proposal, only
    // the implemented scope-preserving adjustments can reach persistence.
    try {
      redirectedUnfinished = applyPlanDirectionFallback(adjustableUnfinished, parsed.data.direction, itemRow.topic);
    } catch (error) {
      if (error instanceof UnverifiedPlanDirectionError) {
        return NextResponse.json({ error: error.message, code: "plan_direction_unverified" }, { status: 409 });
      }
      throw error;
    }
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
      ...deferredTopicSessionFields(topic, itemRow.topic),
      scheduled_for: new Date(lastScheduled + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
      estimated_minutes: parsed.data.futureSessionMinutes,
      status: "upcoming",
    }; });
    redirectedUnfinished = [...redirectedUnfinished, ...appended];
  }

  let replacementSessions: ReturnType<typeof buildProtectedPlanAdjustmentSessions>;
  try {
    const schedulePreferences = readPlanSchedulePreferences(planRow.generation_inputs);
    replacementSessions = buildProtectedPlanAdjustmentSessions(
      [...redirectedUnfinished, ...protectedReviews],
      parsed.data.futureSessionMinutes,
      Math.max(0, ...settledSequences) + 1,
      MAX_ADJUSTED_PLAN_SESSIONS - settledSequences.length,
      schedulePreferences ? { ...schedulePreferences, deadline: parsed.data.deadline } : undefined,
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

  let data: unknown;
  let error: { code?: string; message?: string } | null;
  try {
    ({ data, error } = await supabase.rpc("adjust_learning_plan_with_routes", {
      payload: { ...parsed.data, sessions: routedReplacementSessions, knowledgeMap: revisedKnowledgeMap },
    }).abortSignal(AbortSignal.timeout(20_000)));
  } catch {
    data = null;
    error = { code: "transport_unconfirmed" };
  }
  if (error || !data) {
    console.error("YOVA plan adjustment could not be confirmed", { requestId, code: error?.code ?? "empty_response" });
    const rolledBack = Boolean(error?.code && /^[0-9A-Z]{5}$/.test(error.code));
    return NextResponse.json({
      error: rolledBack
        ? "YOVA could not save this adjustment. Your previous plan is unchanged. Reload the goal and try again."
        : "YOVA could not confirm this adjustment. Reload the goal to check the saved plan before trying again.",
      code: rolledBack ? "plan_adjustment_not_saved" : "plan_adjustment_outcome_unconfirmed",
      requestId,
    }, { status: rolledBack ? 409 : 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
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

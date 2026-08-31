import { NextResponse } from "next/server";
import type {
  SessionStatus,
  SourceMode,
  StudyMode,
} from "@/lib/domain";
import { readSessionResourceFromStepData } from "@/lib/session-generation/resource";
import {
  CommittedMethodChoiceError,
  committedMethodChoiceErrorStatus,
  createCommittedMethodChoiceSuccessor,
  type CommittedMethodChoicePlanInput,
  type CommittedMethodChoiceSessionInput,
} from "@/lib/study-route/committed-method-choice";
import {
  resolveBoundedOtherMethodRequest,
  type AgencyMethodRequestResolution,
} from "@/lib/study-route/agency-mode-controller";
import {
  CommittedMethodChoiceRequestSchema,
  CommittedMethodChoiceResponseSchema,
} from "@/lib/study-route/committed-method-choice-schema";
import {
  studyRouteFromPersistenceRow,
  type PersistedStudyRouteRow,
} from "@/lib/study-route/persistence";
import type { StudyRoute } from "@/lib/study-route/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PlanRow = {
  id: string;
  learning_item_id: string;
  status: string;
};

type ItemRow = {
  source_mode: string;
  study_mode: string;
};

type SessionRow = {
  id: string;
  plan_id: string;
  objective: string;
  method: string;
  method_rationale: string;
  estimated_minutes: number;
  status: string;
  step_data: unknown;
  committed_route_revision_id: string | null;
};

/**
 * Changes one already-saved ready session to an exact stored alternative or,
 * in I'll Customize, a deliverable method from the committed route's immutable
 * eligibility cohort. The planning model and broad Adjust flow are absent:
 * code constructs one direct successor and the database independently
 * authorizes and atomically projects it onto only this session.
 */
export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return json({
      error: "Sign in before changing a saved session method.",
      code: "session_method_choice_auth_required",
    }, 401, requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({
      error: "The method-change request was not valid JSON.",
      code: "session_method_choice_invalid",
    }, 400, requestId);
  }
  const parsed = CommittedMethodChoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({
      error: "This method choice no longer matches the saved session.",
      code: "session_method_choice_invalid",
    }, 422, requestId);
  }

  const input = parsed.data;
  const [{ data: rawPlan, error: planError }, { data: rawSession, error: sessionError }] = await Promise.all([
    supabase
      .from("plans")
      .select("id,learning_item_id,status")
      .eq("id", input.planId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("plan_sessions")
      .select("id,plan_id,objective,method,method_rationale,estimated_minutes,status,step_data,committed_route_revision_id")
      .eq("id", input.planSessionId)
      .eq("plan_id", input.planId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (planError || sessionError) {
    return json({
      error: "YOVA could not verify the saved session before changing its method.",
      code: "session_method_choice_unavailable",
    }, 503, requestId);
  }
  if (!rawPlan || !rawSession) {
    return json({
      error: "That saved session was not found.",
      code: "session_method_choice_not_found",
    }, 404, requestId);
  }
  const planRow = rawPlan as PlanRow;
  const sessionRow = rawSession as SessionRow;
  const currentRevisionId = sessionRow.committed_route_revision_id;
  if (
    !currentRevisionId
    || (
      currentRevisionId !== input.expectedRouteRevisionId
      && currentRevisionId !== input.changeRequestId
    )
  ) {
    return stale(requestId);
  }

  const [{ data: rawItem, error: itemError }, { data: rawRoute, error: routeError }] = await Promise.all([
    supabase
      .from("learning_items")
      .select("source_mode,study_mode")
      .eq("id", planRow.learning_item_id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("study_routes")
      .select("route_revision_id,route_lineage_id,revision_number,schema_version,lifecycle,plan_id,plan_session_id,predecessor_revision_id,route_payload,created_at,committed_at")
      .eq("route_revision_id", currentRevisionId)
      .eq("plan_id", input.planId)
      .eq("plan_session_id", input.planSessionId)
      .eq("user_id", user.id)
      .eq("lifecycle", "committed")
      .maybeSingle(),
  ]);
  const currentRoute = rawRoute
    ? studyRouteFromPersistenceRow(rawRoute as PersistedStudyRouteRow)
    : null;
  if (itemError || routeError || !rawItem || !currentRoute) {
    return json({
      error: "YOVA could not verify this session's current recipe.",
      code: "session_method_choice_route_unavailable",
    }, 409, requestId);
  }
  let methodRequestResolution: AgencyMethodRequestResolution | null = null;
  let requestedMethodId = input.methodId;
  if (input.selectionScope === "other_eligible_method") {
    try {
      methodRequestResolution = resolveBoundedOtherMethodRequest({
        route: currentRoute,
        requestedMethod: input.requestedMethod!,
      });
      requestedMethodId = methodRequestResolution.selectedMethodId;
    } catch {
      return json({
        error: "That Other-method request cannot be mapped inside this saved route's eligible set.",
        code: "session_method_choice_not_offered",
      }, 409, requestId);
    }
  }
  if (!requestedMethodId) {
    return json({
      error: "This method choice does not identify an authorized method.",
      code: "session_method_choice_invalid",
    }, 422, requestId);
  }

  // A lost response is retried with the same operation/revision ID. Pass the
  // exact stored successor back to the RPC; it verifies the full payload and
  // returns before checking work that may have been created after commit.
  if (currentRevisionId === input.changeRequestId) {
    if (
      currentRoute.identity.supersedesRevisionId !== input.expectedRouteRevisionId
      || currentRoute.approach.primaryMethodId !== requestedMethodId
    ) {
      return stale(requestId);
    }
    return commitChoice({
      supabase,
      requestId,
      input,
      successorStudyRoute: currentRoute,
      methodRequestResolution,
    });
  }

  // Session Setup never offers the active method as a choice. Reject a
  // hand-crafted no-op instead of returning an unlocked read that could become
  // stale while a concurrent successor commits.
  if (currentRoute.approach.primaryMethodId === requestedMethodId) {
    if (methodRequestResolution) {
      return NextResponse.json(CommittedMethodChoiceResponseSchema.parse({
        status: "unchanged",
        planId: input.planId,
        planSessionId: input.planSessionId,
        previousRouteRevisionId: input.expectedRouteRevisionId,
        session: {
          id: input.planSessionId,
          method: currentRoute.approach.visibleMethodName,
          methodReason: currentRoute.explanation.shortReason,
          estimatedMinutes: currentRoute.timing.activeMinutes,
          studyRoute: currentRoute,
        },
        requestId,
        methodRequestResolution,
      }), { headers: responseHeaders(requestId) });
    }
    return json({
      error: "That method is already the current saved recipe for this session.",
      code: "session_method_choice_unchanged",
    }, 409, requestId);
  }

  try {
    const plan = learningPlanFromRows({
      plan: planRow,
      item: rawItem as ItemRow,
      session: sessionRow,
      route: currentRoute,
    });
    const session = plan.sessions[0]!;
    const choice = createCommittedMethodChoiceSuccessor({
      plan,
      session,
      previousRoute: currentRoute,
      expectedRouteRevisionId: input.expectedRouteRevisionId,
      routeRevisionId: input.changeRequestId,
      methodId: requestedMethodId,
      changedAt: new Date().toISOString(),
      choiceScope: input.selectionScope ?? "stored_alternative",
    });
    if (choice.status === "unchanged") return stale(requestId);
    return commitChoice({
      supabase,
      requestId,
      input,
      successorStudyRoute: choice.session.studyRoute,
      methodRequestResolution,
    });
  } catch (error) {
    if (error instanceof CommittedMethodChoiceError) {
      return json({
        error: methodChoiceMessage(error.code),
        code: error.code,
      }, committedMethodChoiceErrorStatus(error.code), requestId);
    }
    console.error("YOVA committed method choice failed", { requestId });
    return json({
      error: "YOVA could not change this method safely. The current recipe was not changed.",
      code: "session_method_choice_failed",
    }, 500, requestId);
  }
}

async function commitChoice({
  supabase,
  requestId,
  input,
  successorStudyRoute,
  methodRequestResolution,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  requestId: string;
  input: ReturnType<typeof CommittedMethodChoiceRequestSchema.parse>;
  successorStudyRoute: StudyRoute;
  methodRequestResolution: AgencyMethodRequestResolution | null;
}) {
  let data: unknown;
  let error: unknown;
  try {
    const result = await supabase.rpc(
      "change_plan_session_method_with_route",
      {
        payload: {
          planId: input.planId,
          planSessionId: input.planSessionId,
          expectedRouteRevisionId: input.expectedRouteRevisionId,
          successorStudyRoute,
          ...(input.selectionScope === "other_eligible_method"
            ? { selectionScope: "other_eligible_method" }
            : {}),
        },
      },
    );
    data = result.data;
    error = result.error;
  } catch {
    return retryableCommitFailure(requestId);
  }
  if (error || !data) {
    const issue = supabaseIssue(error);
    const staleIssue = hasIssueMarker(issue, METHOD_CHOICE_STALE_RPC_MARKERS);
    const blockedIssue = hasIssueMarker(issue, METHOD_CHOICE_BLOCKED_RPC_MARKERS);
    if (!staleIssue && !blockedIssue) {
      return retryableCommitFailure(requestId);
    }
    return json({
      error: staleIssue
        ? "This session's recipe changed before your choice was saved. Review the current method and try again."
        : "YOVA could not change this method because the session is no longer untouched and ready.",
      code: staleIssue
        ? "session_method_choice_stale"
        : "session_method_choice_blocked",
    }, 409, requestId);
  }
  const response = CommittedMethodChoiceResponseSchema.safeParse({
    ...(isRecord(data) ? data : {}),
    requestId,
    ...(methodRequestResolution ? { methodRequestResolution } : {}),
  });
  if (!response.success) {
    return json({
      error: "YOVA saved the method change but could not verify the returned recipe. Reload this goal before continuing.",
      code: "session_method_choice_receipt_invalid",
    }, 500, requestId);
  }
  return NextResponse.json(response.data, { headers: responseHeaders(requestId) });
}

const METHOD_CHOICE_STALE_RPC_MARKERS = [
  "post_commit_method_choice_predecessor_conflict",
  "post_commit_method_choice_stale_revision",
  "post_session_study_route_predecessor_conflict",
  "study_route_expected_revision_conflict",
  "study_route_predecessor_conflict",
  "study_route_revision_conflict",
  "study_route_pointer_conflict",
] as const;

const METHOD_CHOICE_BLOCKED_RPC_MARKERS = [
  "post_commit_method_choice_plan_not_found",
  "post_commit_method_choice_session_not_found",
  "post_commit_method_choice_not_offered",
  "post_commit_method_choice_alternative_conflict",
  "post_commit_method_choice_scope_conflict",
  "post_commit_method_choice_phase_contract_conflict",
  "post_commit_method_choice_agency_conflict",
  "post_commit_method_choice_plan_inactive",
  "post_commit_method_choice_session_not_ready",
  "post_commit_method_choice_review_protected",
  "post_commit_method_choice_saved_work_protected",
  "post_session_study_route_projection_conflict",
  "study_route_plan_not_found",
  "study_route_session_not_found",
  "study_route_plan_inactive",
  "study_route_session_terminal",
  "study_route_active_checkpoint",
] as const;

function hasIssueMarker(issue: string, markers: readonly string[]) {
  return markers.some((marker) => issue.includes(marker));
}

function retryableCommitFailure(requestId: string) {
  return json({
    error: "YOVA could not confirm whether the method change was saved. Try again; YOVA will safely reuse the same change request.",
    code: "session_method_choice_retryable",
  }, 503, requestId);
}

function learningPlanFromRows({
  plan,
  item,
  session,
  route,
}: {
  plan: PlanRow;
  item: ItemRow;
  session: SessionRow;
  route: StudyRoute;
}): CommittedMethodChoicePlanInput {
  const sourceMode = parseSourceMode(item.source_mode);
  const studyMode = parseStudyMode(item.study_mode);
  const status = parseSessionStatus(session.status);
  const stepData = isRecord(session.step_data) ? session.step_data : {};
  const learningMode = stepData.learningMode === "learn"
    ? "learn"
    : stepData.learningMode === "study"
      ? "study"
      : route.approach.mode === "learn" ? "learn" : "study";
  const planSession: CommittedMethodChoiceSessionInput = {
    id: session.id,
    objective: session.objective,
    method: session.method,
    methodReason: session.method_rationale,
    estimatedMinutes: session.estimated_minutes,
    learningMode,
    topicIds: stringArray(stepData.topicIds),
    completionEvidence: stringArray(stepData.completionEvidence),
    status,
    resource: readSessionResourceFromStepData(stepData),
    reviewConcept: typeof stepData.reviewConcept === "string"
      ? stepData.reviewConcept
      : undefined,
    reviewType: parseReviewType(stepData.reviewType),
    studyRoute: route,
  };
  return {
    id: plan.id,
    status: plan.status === "active" ? "active" : plan.status === "draft"
      ? "draft" : plan.status === "completed" ? "completed" : "archived",
    sourceMode,
    studyMode,
    sessions: [planSession],
  };
}

function parseSourceMode(value: string): SourceMode {
  return value === "user_materials" ? "user_materials" : "yova_generated";
}

function parseStudyMode(value: string): StudyMode {
  return value === "outside_yova" ? "outside_yova" : "inside_yova";
}

function parseSessionStatus(value: string): SessionStatus {
  if (value === "ready" || value === "upcoming" || value === "complete" || value === "skipped") {
    return value;
  }
  return "upcoming";
}

function parseReviewType(value: unknown): CommittedMethodChoiceSessionInput["reviewType"] {
  return value === "repair_and_retrieve" || value === "verify" || value === "maintenance_transfer"
    ? value
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function methodChoiceMessage(code: string) {
  if (code === "saved_work_present") {
    return "This session already has prepared or saved work, so its method can no longer change safely.";
  }
  if (code === "method_not_offered") {
    return "That method is not one of the current evidence-valid alternatives for this session.";
  }
  if (code === "stale_route_revision") {
    return "This session's recipe changed before your choice was saved. Review the current method and try again.";
  }
  return "This session is no longer eligible for a method change. Its current recipe was not changed.";
}

function stale(requestId: string) {
  return json({
    error: "This session's recipe changed before your choice was saved. Review the current method and try again.",
    code: "session_method_choice_stale",
  }, 409, requestId);
}

function supabaseIssue(error: unknown) {
  if (!isRecord(error)) return "";
  return [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(body: object, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(requestId),
  });
}

function responseHeaders(requestId: string) {
  return {
    "Cache-Control": "no-store",
    "X-Yova-Request-Id": requestId,
  };
}

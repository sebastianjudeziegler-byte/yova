import "server-only";
import type {
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  LEARNER_ANSWER_COUNT,
  mergeStoredAdditionalContext,
} from "@/lib/personalization/learner-profile";
import {
  PERSONALIZATION_STATE_MAX_LENGTH,
  PERSONALIZATION_STATE_VERSION,
  readPersonalizationStateValue,
  serializePersonalizationState,
} from "@/lib/personalization/personalization-state";
import { onboardingAnswerId } from "@/lib/sample-data";
import { readSessionResourceFromStepData } from "@/lib/session-generation/resource";
import {
  buildAuthorizedNormalDurationOutcomes,
  buildAuthorizedNormalDurationProfile,
  type AuthorizedNormalDurationProfile,
  type NormalDurationEvidencePlan,
  type NormalDurationEvidenceSession,
} from "@/lib/study-route/duration-signals";
import {
  buildAuthorizedMethodDecisionEvidence,
  type AuthorizedMethodDecisionEvidence,
} from "@/lib/study-route/method-decision-evidence";
import type { NormalDurationOutcome } from "@/lib/study-route/duration-recommendation";
import {
  studyRouteFromPersistenceRow,
  type PersistedStudyRouteRow,
} from "@/lib/study-route/persistence";
import { STUDY_PROFILE_MODEL_VERSION } from "@/lib/study-profile/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const NORMAL_DURATION_CONTEXT_VERSION = "normal_duration_context_v1" as const;
export const AUTHORIZED_METHOD_CONTEXT_VERSION = "authorized_method_context_v1" as const;
export const AUTHORIZED_PROFILE_CONTEXT_VERSION = "authorized_profile_context_v1" as const;
export const NORMAL_DURATION_HISTORY_READ_LIMIT = 100 as const;
export const NORMAL_DURATION_AUTHORITY_READ_LIMIT = 200 as const;

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type AuthorizedNormalDurationContextReason =
  | "loaded"
  | "development_preview"
  | "supabase_unavailable"
  | "unauthenticated"
  | "profile_missing"
  | "personalization_context_invalid"
  | "authentication_context_invalid"
  | "authentication_read_failed"
  | "profile_read_failed"
  | "personalization_state_invalid"
  | "history_read_failed";

export type AuthorizedNormalDurationContext = Readonly<{
  status: "ready" | "empty" | "degraded";
  reason: AuthorizedNormalDurationContextReason;
  /** Schema provenance plus a bounded revision of the exact stored profile edit. */
  profileVersion: string;
  profile: AuthorizedNormalDurationProfile;
  recentOutcomes: readonly NormalDurationOutcome[];
  methodProfileVersion: string;
  methodEvidence: AuthorizedMethodDecisionEvidence;
}>;

export type LoadAuthorizedNormalDurationContextOptions = {
  developmentPreview?: boolean;
  /**
   * An API route that already called auth.getUser may pass both values to
   * avoid a second client/auth lookup. Every read is still bound to this id.
   */
  supabase?: SupabaseServerClient;
  authenticatedUserId?: string;
  /** One server-owned anchor keeps duration and method evidence on the same clock. */
  now?: Date;
};

type LearnerProfileRow = {
  user_id: string;
  common_blocker: string | null;
  guidance_preference: string | null;
  preferred_session_min: number | null;
  preferred_session_max: number | null;
  explanation_preference: string | null;
  focus_frequency: string | null;
  starting_pattern: string | null;
  energy_window: string | null;
  primary_improvement_goal: string | null;
  additional_context: string | null;
  profile_version: number;
  updated_at: string;
};

type PlanSessionRow = {
  user_id: string;
  id: string;
  plan_id: string;
  estimated_minutes: number;
  step_data: unknown;
  committed_route_revision_id: string | null;
};

type PlanRow = {
  user_id: string;
  id: string;
};

type StudyRouteRow = PersistedStudyRouteRow & {
  user_id: string;
};

type SessionAttemptRow = {
  user_id: string;
  id: string;
  plan_session_id: string;
  started_at: string;
  completed_at: string | null;
  actual_minutes: number | null;
  correct_answers: number | null;
  total_answers: number | null;
  user_feedback: unknown;
  result_data: unknown;
};

type LearningEventRow = {
  user_id: string;
  plan_session_id: string | null;
  occurred_at: string;
  event_data: unknown;
};

type OwnedHistoryRows = {
  attempts: SessionAttemptRow[];
  interruptions: LearningEventRow[];
};

type OwnedAuthorityRows = {
  sessions: PlanSessionRow[];
  plans: PlanRow[];
  routes: StudyRouteRow[];
};

const PROFILE_COLUMNS = [
  "user_id",
  "common_blocker",
  "guidance_preference",
  "preferred_session_min",
  "preferred_session_max",
  "explanation_preference",
  "focus_frequency",
  "starting_pattern",
  "energy_window",
  "primary_improvement_goal",
  "additional_context",
  "profile_version",
  "updated_at",
].join(",");

const ATTEMPT_COLUMNS = [
  "user_id",
  "id",
  "plan_session_id",
  "started_at",
  "completed_at",
  "actual_minutes",
  "correct_answers",
  "total_answers",
  "user_feedback",
  "result_data",
].join(",");

const ROUTE_COLUMNS = [
  "user_id",
  "route_revision_id",
  "route_lineage_id",
  "revision_number",
  "schema_version",
  "lifecycle",
  "plan_id",
  "plan_session_id",
  "predecessor_revision_id",
  "route_payload",
  "created_at",
  "committed_at",
].join(",");

const EMPTY_PROFILE_VERSION = [
  AUTHORIZED_PROFILE_CONTEXT_VERSION,
  "empty",
].join("+");

const DEGRADED_PROFILE_VERSION = [
  AUTHORIZED_PROFILE_CONTEXT_VERSION,
  "degraded",
].join("+");

/**
 * Loads the smallest authenticated server-side context needed by Study Now's
 * normal-session duration recommender. Database rows remain private and all
 * malformed, legacy, or mismatched history is omitted at the adapter boundary.
 */
export async function loadAuthorizedNormalDurationContext(
  options: LoadAuthorizedNormalDurationContextOptions = {},
): Promise<AuthorizedNormalDurationContext> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return degradedContext("personalization_context_invalid", new Date(0));
  }
  if (options.developmentPreview) return emptyContext("development_preview", now);

  const suppliedClient = options.supabase;
  const suppliedUserId = options.authenticatedUserId;
  if ((suppliedClient === undefined) !== (suppliedUserId === undefined)) {
    return degradedContext("authentication_context_invalid", now);
  }

  let supabase: SupabaseServerClient;
  let userId: string;
  if (suppliedClient && suppliedUserId !== undefined) {
    const validatedUserId = validUuid(suppliedUserId);
    if (!validatedUserId) {
      return degradedContext("authentication_context_invalid", now);
    }
    supabase = suppliedClient;
    userId = validatedUserId;
  } else {
    if (!isSupabaseConfigured()) return emptyContext("supabase_unavailable", now);
    try {
      supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) return degradedContext("authentication_read_failed", now);
      if (!data.user) return emptyContext("unauthenticated", now);
      const validatedUserId = validUuid(data.user.id);
      if (!validatedUserId) return degradedContext("authentication_read_failed", now);
      userId = validatedUserId;
    } catch {
      return degradedContext("authentication_read_failed", now);
    }
  }

  let profileResult: Awaited<ReturnType<typeof readLearnerProfile>>;
  try {
    profileResult = await readLearnerProfile(supabase, userId);
  } catch {
    return degradedContext("profile_read_failed", now);
  }
  if (profileResult.error) return degradedContext("profile_read_failed", now);
  if (!profileResult.data) return emptyContext("profile_missing", now);
  const profileRow = profileResult.data as unknown as LearnerProfileRow;
  if (profileRow.user_id !== userId) return degradedContext("profile_read_failed", now);
  if (hasInvalidExplicitPersonalizationState(profileRow.additional_context)) {
    return degradedContext("personalization_state_invalid", now);
  }

  let answers: string[];
  let profileVersion: string;
  try {
    answers = learnerProfileToAnswers(profileRow);
    profileVersion = contextProfileVersion(profileRow);
  } catch {
    return degradedContext("profile_read_failed", now);
  }
  let history: OwnedHistoryRows;
  let authorities: OwnedAuthorityRows;
  try {
    const loadedHistory = await readRecentHistory(supabase, userId);
    if (!loadedHistory) {
      return degradedContextWithAuthorizedProfile(profileVersion, answers, now);
    }
    history = loadedHistory;

    const loadedAuthorities = await readAuthoritiesForHistory(supabase, userId, history);
    if (!loadedAuthorities) {
      return degradedContextWithAuthorizedProfile(profileVersion, answers, now);
    }
    authorities = loadedAuthorities;
  } catch {
    return degradedContextWithAuthorizedProfile(profileVersion, answers, now);
  }

  try {
    const evidence = normalizeDurationEvidence(userId, authorities, history);
    return freezeContext({
      status: "ready",
      reason: "loaded",
      profileVersion,
      profile: buildAuthorizedNormalDurationProfile(answers),
      recentOutcomes: buildAuthorizedNormalDurationOutcomes({
        answers,
        plans: evidence.plans,
        completions: evidence.completions,
        interruptions: evidence.interruptions,
      }),
      methodProfileVersion: methodContextProfileVersion(profileRow),
      methodEvidence: buildAuthorizedMethodDecisionEvidence({
        answers,
        plans: evidence.plans,
        completions: evidence.completions,
        now,
      }),
    });
  } catch {
    return degradedContextWithAuthorizedProfile(profileVersion, answers, now);
  }
}

async function readLearnerProfile(
  supabase: SupabaseServerClient,
  userId: string,
) {
  return supabase
    .from("learner_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
}

async function readRecentHistory(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<OwnedHistoryRows | null> {
  const [attemptResult, interruptionResult] = await Promise.all([
    supabase
      .from("session_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(NORMAL_DURATION_HISTORY_READ_LIMIT),
    supabase
      .from("learning_events")
      .select("user_id,plan_session_id,occurred_at,event_data")
      .eq("user_id", userId)
      .eq("event_type", "session_interrupted")
      .order("occurred_at", { ascending: false })
      .limit(NORMAL_DURATION_HISTORY_READ_LIMIT),
  ]);
  if (
    attemptResult.error
    || interruptionResult.error
    || !isBoundedRowArray(attemptResult.data, NORMAL_DURATION_HISTORY_READ_LIMIT)
    || !isBoundedRowArray(interruptionResult.data, NORMAL_DURATION_HISTORY_READ_LIMIT)
  ) return null;

  const attempts = attemptResult.data as unknown as SessionAttemptRow[];
  const interruptions = interruptionResult.data as unknown as LearningEventRow[];
  if (!rowsBelongToUser(attempts, userId) || !rowsBelongToUser(interruptions, userId)) {
    return null;
  }
  return { attempts, interruptions };
}

async function readAuthoritiesForHistory(
  supabase: SupabaseServerClient,
  userId: string,
  history: OwnedHistoryRows,
): Promise<OwnedAuthorityRows | null> {
  const sessionIds = boundedUniqueUuids([
    ...history.attempts.map((row) => row.plan_session_id),
    ...history.interruptions.map((row) => row.plan_session_id),
  ]);
  if (sessionIds.length === 0) return { sessions: [], plans: [], routes: [] };

  const sessionResult = await supabase
    .from("plan_sessions")
    .select("user_id,id,plan_id,estimated_minutes,step_data,committed_route_revision_id")
    .eq("user_id", userId)
    .in("id", sessionIds)
    .limit(NORMAL_DURATION_AUTHORITY_READ_LIMIT);
  if (
    sessionResult.error
    || !isBoundedRowArray(sessionResult.data, NORMAL_DURATION_AUTHORITY_READ_LIMIT)
  ) return null;
  const sessions = sessionResult.data as PlanSessionRow[];
  if (!rowsBelongToUser(sessions, userId)) return null;

  const planIds = boundedUniqueUuids(sessions.map((row) => row.plan_id));
  const routeRevisionIds = boundedUniqueUuids(
    sessions.map((row) => row.committed_route_revision_id),
  );
  const [planResult, routeResult] = await Promise.all([
    planIds.length > 0
      ? supabase
        .from("plans")
        .select("user_id,id")
        .eq("user_id", userId)
        .in("id", planIds)
        .limit(NORMAL_DURATION_AUTHORITY_READ_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    routeRevisionIds.length > 0
      ? supabase
        .from("study_routes")
        .select(ROUTE_COLUMNS)
        .eq("user_id", userId)
        .eq("lifecycle", "committed")
        .in("route_revision_id", routeRevisionIds)
        .limit(NORMAL_DURATION_AUTHORITY_READ_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    planResult.error
    || routeResult.error
    || !isBoundedRowArray(planResult.data, NORMAL_DURATION_AUTHORITY_READ_LIMIT)
    || !isBoundedRowArray(routeResult.data, NORMAL_DURATION_AUTHORITY_READ_LIMIT)
  ) return null;
  const plans = planResult.data as PlanRow[];
  const routes = routeResult.data as StudyRouteRow[];
  if (!rowsBelongToUser(plans, userId) || !rowsBelongToUser(routes, userId)) return null;
  return { sessions, plans, routes };
}

function normalizeDurationEvidence(
  userId: string,
  authorities: OwnedAuthorityRows,
  history: OwnedHistoryRows,
) {
  if (
    !rowsBelongToUser(authorities.sessions, userId)
    || !rowsBelongToUser(authorities.plans, userId)
    || !rowsBelongToUser(authorities.routes, userId)
    || !rowsBelongToUser(history.attempts, userId)
    || !rowsBelongToUser(history.interruptions, userId)
  ) return { plans: [], completions: [], interruptions: [] };

  const planRowsById = uniqueRowsByKey(authorities.plans, (row) => validUuid(row.id));
  const sessionRowsById = uniqueRowsByKey(authorities.sessions, (row) => validUuid(row.id));
  const routeRowsById = uniqueRowsByKey(
    authorities.routes,
    (row) => validUuid(row.route_revision_id),
  );
  const evidenceSessionsByPlanId = new Map<string, NormalDurationEvidenceSession[]>();

  for (const sessionRow of sessionRowsById.values()) {
    const planId = validUuid(sessionRow.plan_id);
    const sessionId = validUuid(sessionRow.id);
    const routeRevisionId = validUuid(sessionRow.committed_route_revision_id);
    if (
      !planId
      || !sessionId
      || !routeRevisionId
      || !planRowsById.has(planId)
      || !Number.isInteger(sessionRow.estimated_minutes)
    ) continue;

    const routeRow = routeRowsById.get(routeRevisionId);
    const route = routeRow ? studyRouteFromPersistenceRow(routeRow) : null;
    if (
      !route
      || route.identity.routeRevisionId !== routeRevisionId
      || route.identity.planId !== planId
      || route.identity.sessionId !== sessionId
      || route.identity.lifecycleStatus !== "committed"
    ) continue;

    const reviewMetadata = readReviewMetadata(sessionRow.step_data);
    const resource = readSessionResourceFromStepData(sessionRow.step_data);
    if (!reviewMetadata || (hasOwn(sessionRow.step_data, "generatedSession") && !resource)) {
      continue;
    }

    const evidenceSession: NormalDurationEvidenceSession = {
      id: sessionId,
      estimatedMinutes: sessionRow.estimated_minutes,
      ...(reviewMetadata.reviewType ? { reviewType: reviewMetadata.reviewType } : {}),
      ...(reviewMetadata.reviewConcept ? { reviewConcept: reviewMetadata.reviewConcept } : {}),
      ...(resource ? { resource } : {}),
      studyRoute: route,
    };
    const sessions = evidenceSessionsByPlanId.get(planId) ?? [];
    sessions.push(evidenceSession);
    evidenceSessionsByPlanId.set(planId, sessions);
  }

  const plans: NormalDurationEvidencePlan[] = [...evidenceSessionsByPlanId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, sessions]) => ({
      id,
      sessions: [...sessions].sort((left, right) => left.id.localeCompare(right.id)),
    }));
  const sessionPlanIds = new Map<string, string>();
  for (const sessionRow of sessionRowsById.values()) {
    const sessionId = validUuid(sessionRow.id);
    const planId = validUuid(sessionRow.plan_id);
    if (sessionId && planId && planRowsById.has(planId)) sessionPlanIds.set(sessionId, planId);
  }

  return {
    plans,
    completions: history.attempts.flatMap((row) => {
      const completion = completionFromRow(row, sessionPlanIds);
      return completion ? [completion] : [];
    }),
    interruptions: history.interruptions.flatMap((row) => {
      const interruption = interruptionFromRow(row, sessionPlanIds);
      return interruption ? [interruption] : [];
    }),
  };
}

function completionFromRow(
  row: SessionAttemptRow,
  planIdBySessionId: ReadonlyMap<string, string>,
): SessionCompletion | null {
  const id = validUuid(row.id);
  const sessionId = validUuid(row.plan_session_id);
  const planId = sessionId ? planIdBySessionId.get(sessionId) : undefined;
  const routeRevisionId = readUuidProperty(row.result_data, "routeRevisionId");
  const plannedMinutes = readIntegerProperty(row.result_data, "plannedMinutes");
  if (
    !id
    || !sessionId
    || !planId
    || !routeRevisionId
    || !row.completed_at
    || !Number.isInteger(row.actual_minutes)
    || !Number.isInteger(row.correct_answers)
    || !Number.isInteger(row.total_answers)
    || !isSessionFeedback(row.user_feedback)
    || plannedMinutes === null
  ) return null;

  return {
    id,
    planId,
    planSessionId: sessionId,
    routeRevisionId,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    plannedMinutes,
    actualMinutes: row.actual_minutes as number,
    correctAnswers: row.correct_answers as number,
    totalAnswers: row.total_answers as number,
    feedback: row.user_feedback,
    observedGap: "",
    conceptEvidence: [],
    confidenceEvidence: [],
  };
}

function interruptionFromRow(
  row: LearningEventRow,
  planIdBySessionId: ReadonlyMap<string, string>,
): SessionInterruption | null {
  const sessionId = validUuid(row.plan_session_id);
  const planId = sessionId ? planIdBySessionId.get(sessionId) : undefined;
  const id = readUuidProperty(row.event_data, "attemptId");
  const routeRevisionId = readUuidProperty(row.event_data, "routeRevisionId");
  const startedAt = readTextProperty(row.event_data, "startedAt");
  const plannedMinutes = readIntegerProperty(row.event_data, "plannedMinutes");
  const actualMinutes = readIntegerProperty(row.event_data, "actualMinutes");
  const completedSteps = readIntegerProperty(row.event_data, "completedSteps");
  const totalSteps = readIntegerProperty(row.event_data, "totalSteps");
  if (
    !sessionId
    || !planId
    || !id
    || !routeRevisionId
    || !startedAt
    || plannedMinutes === null
    || actualMinutes === null
    || completedSteps === null
    || totalSteps === null
  ) return null;

  return {
    id,
    planId,
    planSessionId: sessionId,
    routeRevisionId,
    startedAt,
    interruptedAt: row.occurred_at,
    plannedMinutes,
    actualMinutes,
    completedSteps,
    totalSteps,
  };
}

function learnerProfileToAnswers(profile: LearnerProfileRow) {
  const answers = Array.from({ length: LEARNER_ANSWER_COUNT }, () => "");
  answers[0] = onboardingAnswerId(0, profile.common_blocker) ?? profile.common_blocker ?? "";
  answers[1] = onboardingAnswerId(1, profile.guidance_preference) ?? profile.guidance_preference ?? "";
  answers[2] = onboardingAnswerId(
    2,
    formatSessionRange(profile.preferred_session_min, profile.preferred_session_max),
  ) ?? "";
  answers[3] = onboardingAnswerId(3, profile.explanation_preference)
    ?? profile.explanation_preference
    ?? "";
  answers[4] = onboardingAnswerId(4, profile.focus_frequency) ?? profile.focus_frequency ?? "";
  answers[5] = onboardingAnswerId(5, profile.starting_pattern) ?? profile.starting_pattern ?? "";
  answers[6] = onboardingAnswerId(6, profile.energy_window) ?? profile.energy_window ?? "";
  answers[7] = onboardingAnswerId(7, profile.primary_improvement_goal)
    ?? profile.primary_improvement_goal
    ?? "";
  return mergeStoredAdditionalContext(answers, profile.additional_context);
}

function formatSessionRange(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return "";
  return `${minimum} to ${maximum} minutes`;
}

function readReviewMetadata(stepData: unknown): Pick<
  NormalDurationEvidenceSession,
  "reviewType" | "reviewConcept"
> | null {
  if (!isRecord(stepData)) return {};
  const reviewType = stepData.reviewType;
  if (
    reviewType !== undefined
    && reviewType !== null
    && reviewType !== ""
    && reviewType !== "repair_and_retrieve"
    && reviewType !== "verify"
    && reviewType !== "maintenance_transfer"
  ) return null;
  const reviewConcept = stepData.reviewConcept;
  if (
    reviewConcept !== undefined
    && reviewConcept !== null
    && typeof reviewConcept !== "string"
  ) return null;
  return {
    ...(typeof reviewType === "string" && reviewType
      ? { reviewType: reviewType as NonNullable<NormalDurationEvidenceSession["reviewType"]> }
      : {}),
    ...(typeof reviewConcept === "string" && reviewConcept.trim()
      ? { reviewConcept: reviewConcept }
      : {}),
  };
}

function contextProfileVersion(profile: LearnerProfileRow) {
  return [
    AUTHORIZED_PROFILE_CONTEXT_VERSION,
    ...storedProfileVersionComponents(profile),
  ].join("+").slice(0, 200);
}

function methodContextProfileVersion(profile: LearnerProfileRow) {
  return contextProfileVersion(profile);
}

function storedProfileVersionComponents(profile: LearnerProfileRow) {
  const components: string[] = [];
  const profileUpdatedAt = Date.parse(profile.updated_at);
  if (Number.isFinite(profileUpdatedAt)) {
    components.push(`profile_revision_${profileUpdatedAt.toString(36)}`);
  }
  const storedProfileVersion = boundedPositiveInteger(profile.profile_version, 999);
  components.push(storedProfileVersion === null
    ? "learner_profile_schema_unknown"
    : `learner_profile_schema_v${storedProfileVersion}`);

  const storedContext = parseJsonRecord(profile.additional_context, 50_000);
  const contextVersion = boundedPositiveInteger(storedContext?.schemaVersion, 99);
  if (contextVersion !== null) components.push(`additional_context_v${contextVersion}`);
  const serializedState = typeof storedContext?.personalizationState === "string"
    ? storedContext.personalizationState
    : null;
  const rawState = parseJsonRecord(serializedState, PERSONALIZATION_STATE_MAX_LENGTH);
  if (rawState?.version === PERSONALIZATION_STATE_VERSION) {
    components.push(`personalization_state_v${PERSONALIZATION_STATE_VERSION}`);
    if (
      isRecord(rawState.studyProfile)
      && rawState.studyProfile.modelVersion === STUDY_PROFILE_MODEL_VERSION
    ) components.push(STUDY_PROFILE_MODEL_VERSION);
  }
  return components;
}

/**
 * A missing state is a supported legacy profile. Once a nonempty state is
 * stored, however, it is the learner's authorization boundary: a malformed or
 * future shape must not be normalized into permissive default controls.
 */
function hasInvalidExplicitPersonalizationState(additionalContext: string | null) {
  const storedContext = parseJsonRecord(additionalContext, 50_000);
  if (!storedContext || !hasOwn(storedContext, "personalizationState")) return false;

  const serializedState = storedContext.personalizationState;
  if (serializedState === null || serializedState === undefined) return false;
  if (typeof serializedState !== "string") return true;
  if (!serializedState.trim()) return false;
  if (serializedState.length > PERSONALIZATION_STATE_MAX_LENGTH) return true;

  const rawState = parseJsonRecord(serializedState, PERSONALIZATION_STATE_MAX_LENGTH);
  if (
    rawState?.version !== PERSONALIZATION_STATE_VERSION
    || !isRecord(rawState.studyProfile)
    || rawState.studyProfile.modelVersion !== STUDY_PROFILE_MODEL_VERSION
  ) return true;

  try {
    return serializePersonalizationState(
      readPersonalizationStateValue(serializedState),
    ) !== serializedState;
  } catch {
    return true;
  }
}

function emptyContext(
  reason: Extract<AuthorizedNormalDurationContextReason,
    "development_preview" | "supabase_unavailable" | "unauthenticated" | "profile_missing">,
  now: Date,
) {
  return freezeContext({
    status: "empty",
    reason,
    profileVersion: EMPTY_PROFILE_VERSION,
    profile: buildAuthorizedNormalDurationProfile([]),
    recentOutcomes: [],
    methodProfileVersion: EMPTY_PROFILE_VERSION,
    methodEvidence: buildAuthorizedMethodDecisionEvidence({
      answers: [],
      plans: [],
      completions: [],
      now,
    }),
  });
}

function degradedContext(
  reason: Extract<AuthorizedNormalDurationContextReason,
    | "authentication_context_invalid"
    | "personalization_context_invalid"
    | "authentication_read_failed"
    | "profile_read_failed"
    | "personalization_state_invalid"
    | "history_read_failed">,
  now: Date,
) {
  return freezeContext({
    status: "degraded",
    reason,
    profileVersion: DEGRADED_PROFILE_VERSION,
    profile: buildAuthorizedNormalDurationProfile([]),
    recentOutcomes: [],
    methodProfileVersion: DEGRADED_PROFILE_VERSION,
    methodEvidence: buildAuthorizedMethodDecisionEvidence({
      answers: [],
      plans: [],
      completions: [],
      now,
    }),
  });
}

function degradedContextWithAuthorizedProfile(
  profileVersion: string,
  answers: readonly string[],
  now: Date,
) {
  return freezeContext({
    status: "degraded",
    reason: "history_read_failed",
    profileVersion,
    profile: buildAuthorizedNormalDurationProfile(answers),
    recentOutcomes: [],
    methodProfileVersion: methodProfileVersionFromDurationVersion(profileVersion),
    methodEvidence: buildAuthorizedMethodDecisionEvidence({
      answers,
      plans: [],
      completions: [],
      now,
    }),
  });
}

function methodProfileVersionFromDurationVersion(profileVersion: string) {
  return profileVersion;
}

function freezeContext(value: AuthorizedNormalDurationContext) {
  if (!Object.isFrozen(value.recentOutcomes)) Object.freeze(value.recentOutcomes);
  return Object.freeze(value);
}

function rowsBelongToUser(rows: readonly unknown[], userId: string) {
  return rows.every((row) => isRecord(row) && row.user_id === userId);
}

function uniqueRowsByKey<Row>(
  rows: readonly Row[],
  keyFor: (row: Row) => string | null,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(rows.flatMap((row) => {
    const key = keyFor(row);
    return key && counts.get(key) === 1 ? [[key, row] as const] : [];
  }));
}

function boundedUniqueUuids(values: readonly unknown[]) {
  return [...new Set(values.flatMap((value) => {
    const uuid = validUuid(value);
    return uuid ? [uuid] : [];
  }))].sort().slice(0, NORMAL_DURATION_AUTHORITY_READ_LIMIT);
}

function validUuid(value: unknown): string | null {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function readUuidProperty(value: unknown, key: string) {
  return validUuid(isRecord(value) ? value[key] : null);
}

function readTextProperty(value: unknown, key: string) {
  const property = isRecord(value) ? value[key] : null;
  return typeof property === "string" ? property : "";
}

function readIntegerProperty(value: unknown, key: string) {
  const property = isRecord(value) ? value[key] : null;
  return typeof property === "number" && Number.isInteger(property) ? property : null;
}

function isSessionFeedback(value: unknown): value is SessionCompletion["feedback"] {
  return value === "too_easy" || value === "about_right" || value === "too_difficult";
}

function boundedPositiveInteger(value: unknown, maximum: number) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= maximum
    ? value
    : null;
}

function parseJsonRecord(value: string | null, maximumLength: number) {
  if (!value || value.length > maximumLength) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasOwn(value: unknown, key: string) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isBoundedRowArray(
  value: unknown,
  maximumLength: number,
): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

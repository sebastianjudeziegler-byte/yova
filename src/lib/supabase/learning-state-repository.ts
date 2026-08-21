"use client";

import type {
  DeadlineMilestone,
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
  PlanStatus,
  SessionCompletion,
  SessionInterruption,
  SessionStatus,
  SourceMode,
  StudyMode,
} from "@/lib/domain";
import { readConceptEvidenceProperty } from "@/lib/learning/concept-evidence";
import {
  normalizeSessionCompletionMode,
  normalizeSessionCompletionProvenance,
} from "@/lib/learning/session-completion-provenance";
import { readConfidenceEvidenceProperty } from "@/lib/learning/confidence-calibration";
import {
  compareActiveSessionCheckpointProgress,
  readActiveSessionCheckpoint,
  type ActiveSessionCheckpointV1,
} from "@/lib/learning/active-session-checkpoint";
import { readSessionActivityProgress } from "@/lib/learning/session-activity-progress";
import {
  readSessionAdjustmentSnapshot,
  readSessionEvidenceSnapshot,
  readSessionPendingRepair,
} from "@/lib/learning/session-resume";
import { inferLegacySessionLearningMode } from "@/lib/learning/learning-intent";
import { resolveLearningTitle, resolveLearningTopic } from "@/lib/intake/interpret";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
} from "@/lib/knowledge-map/schema";
import { deadlineMilestoneFromRow } from "@/lib/milestones/schema";
import { readSessionAdaptationNote } from "@/lib/personalization/adaptation-note";
import {
  encodeAdditionalLearnerContext,
  LEARNER_ANSWER_COUNT,
  mergeStoredAdditionalContext,
} from "@/lib/personalization/learner-profile";
import {
  onboardingAnswerId,
  onboardingAnswerLabel,
} from "@/lib/sample-data";
import { readSessionResourceFromStepData } from "@/lib/session-generation/resource";
import { resolveSessionArchitectureVersion } from "@/lib/session-generation/architecture";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  CloudAccountIdentityMismatchError,
  CloudSyncTemporarilyUnavailableError,
  LEARNER_PROFILE_IDENTITY_SYNC_WARNING,
  LEARNER_PROFILE_SAVE_SYNC_WARNING,
} from "@/lib/supabase/cloud-sync-error";

type ProfileRow = {
  display_name: string;
  onboarding_completed_at: string | null;
};

type LearnerProfileRow = {
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
};

type LearningItemRow = {
  id: string;
  title: string;
  kind: LearningPlan["kind"];
  topic: string;
  deadline: string | null;
  source_mode: SourceMode;
  study_mode: StudyMode;
  created_at: string;
};

type PlanRow = {
  id: string;
  learning_item_id: string;
  status: PlanStatus;
  rationale: string;
  generation_inputs: unknown;
  knowledge_map: unknown;
  created_at: string;
};

type PlanSessionRow = {
  id: string;
  plan_id: string;
  sequence: number;
  title: string;
  objective: string;
  method: string;
  method_rationale: string;
  scheduled_for: string | null;
  estimated_minutes: number;
  status: SessionStatus;
  step_data: unknown;
};

type SessionAttemptRow = {
  id: string;
  plan_session_id: string;
  started_at: string;
  completed_at: string | null;
  actual_minutes: number | null;
  correct_answers: number | null;
  total_answers: number | null;
  user_feedback: SessionCompletion["feedback"] | null;
  result_data: unknown;
};

type MaterialRow = {
  id: string;
  learning_item_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  processing_status: string;
  metadata: unknown;
};

type LearningEventRow = {
  plan_session_id: string | null;
  occurred_at: string;
  event_data: unknown;
};

export type CloudLearningState = {
  displayName: string;
  onboardingCompleted: boolean;
  onboardingAnswers: string[];
  plans: LearningPlan[];
  deadlineMilestones: DeadlineMilestone[];
  sessionCompletions: SessionCompletion[];
  sessionInterruptions: SessionInterruption[];
  activeSessionCheckpoints: ActiveSessionCheckpointV1[];
};

const AUTHENTICATED_STATE_RETRY_DELAYS_MS = [150, 400] as const;

export async function loadAuthenticatedLearningStateWithRetry(
  read: () => Promise<CloudLearningState | null> = loadAuthenticatedLearningState,
  retryDelaysMs: readonly number[] = AUTHENTICATED_STATE_RETRY_DELAYS_MS,
  wait: (milliseconds: number) => Promise<void> = delay,
): Promise<CloudLearningState> {
  let lastIssue: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const state = await read();
      if (state) return state;
      lastIssue = new Error("The authenticated cloud state was temporarily unavailable.");
    } catch (error) {
      lastIssue = error;
    }

    const retryDelay = retryDelaysMs[attempt];
    if (retryDelay !== undefined) await wait(retryDelay);
  }

  throw lastIssue instanceof Error
    ? lastIssue
    : new Error("YOVA could not load your cloud learning data.");
}

export async function loadAuthenticatedLearningState(): Promise<CloudLearningState | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabaseBrowserClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const [profileResult, learnerProfileResult, itemsResult, plansResult, sessionsResult, attemptsResult, materialsResult, interruptionsResult, milestonesResult] = await Promise.all([
    supabase.from("profiles").select("display_name,onboarding_completed_at").maybeSingle(),
    supabase.from("learner_profiles").select("common_blocker,guidance_preference,preferred_session_min,preferred_session_max,explanation_preference,focus_frequency,starting_pattern,energy_window,primary_improvement_goal,additional_context").maybeSingle(),
    supabase.from("learning_items").select("id,title,kind,topic,deadline,source_mode,study_mode,created_at").order("created_at", { ascending: true }),
    supabase.from("plans").select("id,learning_item_id,status,rationale,generation_inputs,knowledge_map,created_at").order("created_at", { ascending: true }),
    supabase.from("plan_sessions").select("id,plan_id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data").order("sequence", { ascending: true }),
    supabase.from("session_attempts").select("id,plan_session_id,started_at,completed_at,actual_minutes,correct_answers,total_answers,user_feedback,result_data").not("completed_at", "is", null).order("completed_at", { ascending: true }),
    supabase.from("materials").select("id,learning_item_id,filename,mime_type,byte_size,processing_status,metadata").eq("processing_status", "ready").order("created_at", { ascending: true }),
    supabase.from("learning_events").select("plan_session_id,occurred_at,event_data").eq("event_type", "session_interrupted").order("occurred_at", { ascending: true }),
    supabase.from("deadline_milestones").select("id,title,description,due_at,status,linked_learning_item_id,created_at").order("due_at", { ascending: true }),
  ]);

  const error = profileResult.error
    ?? learnerProfileResult.error
    ?? itemsResult.error
    ?? plansResult.error
    ?? sessionsResult.error
    ?? attemptsResult.error
    ?? materialsResult.error
    ?? interruptionsResult.error;
  if (error) throw new Error("YOVA could not load your cloud learning data.");

  const profile = profileResult.data as ProfileRow | null;
  // Account creation inserts this row from the auth.users trigger. An
  // authenticated read without it is therefore indeterminate (for example,
  // while a recovery session is settling), not evidence of a new learner.
  if (!profile) throw new Error("YOVA could not load your cloud learning profile.");
  const learnerProfile = learnerProfileResult.data as LearnerProfileRow | null;
  const itemRows = (itemsResult.data ?? []) as LearningItemRow[];
  const planRows = (plansResult.data ?? []) as PlanRow[];
  const sessionRows = (sessionsResult.data ?? []) as PlanSessionRow[];
  const attemptRows = (attemptsResult.data ?? []) as SessionAttemptRow[];
  const materialRows = (materialsResult.data ?? []) as MaterialRow[];
  const interruptionRows = (interruptionsResult.data ?? []) as LearningEventRow[];
  const deadlineMilestones = milestonesResult.error ? [] : (milestonesResult.data ?? []).flatMap<DeadlineMilestone>((row) => {
    try {
      return [deadlineMilestoneFromRow({
        ...row,
        description: row.description ?? "",
        status: row.status === "completed" ? "completed" : "open",
        linked_learning_item_id: row.linked_learning_item_id ?? null,
      })];
    } catch {
      // Deadline reads are intentionally non-blocking. Ignore a malformed row
      // rather than preventing the learner's remaining cloud state from loading.
      return [];
    }
  });

  const itemsById = new Map(itemRows.map((item) => [item.id, item]));
  const sessionsByPlanId = new Map<string, LearningPlanSession[]>();
  const planIdBySessionId = new Map<string, string>();
  const plannedMinutesBySessionId = new Map<string, number>();
  const materialsByItemId = new Map<string, LearningPlan["materials"]>();
  const activeSessionCheckpoints: ActiveSessionCheckpointV1[] = [];
  const checkpointReadAt = Date.now();

  for (const row of materialRows) {
    const current = materialsByItemId.get(row.learning_item_id) ?? [];
    current.push({
      id: row.id,
      name: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.byte_size,
      textContent: null,
      processingStatus: "ready",
      understanding: readMaterialUnderstanding(row.metadata),
    });
    materialsByItemId.set(row.learning_item_id, current);
  }

  for (const row of sessionRows) {
    const amountLabel = readTextProperty(row.step_data, "amountLabel")
      || `${row.estimated_minutes} min`;
    const session: LearningPlanSession = {
      id: row.id,
      sequence: row.sequence,
      title: row.title,
      objective: row.objective,
      method: row.method,
      methodReason: row.method_rationale,
      scheduledFor: row.scheduled_for ?? new Date().toISOString(),
      estimatedMinutes: row.estimated_minutes,
      amountLabel,
      learningMode: readLearningMode(row.step_data) ?? inferLegacySessionLearningMode(row.method, row.objective),
      topicIds: readStringArrayProperty(row.step_data, "topicIds"),
      contentTargets: readStringArrayProperty(row.step_data, "contentTargets"),
      completionEvidence: readStringArrayProperty(row.step_data, "completionEvidence"),
      originSessionId: readTextProperty(row.step_data, "originSessionId") || undefined,
      originalContentMinutes: readPositiveIntegerProperty(row.step_data, "originalContentMinutes"),
      segmentIndex: readPositiveIntegerProperty(row.step_data, "segmentIndex"),
      segmentCount: readPositiveIntegerProperty(row.step_data, "segmentCount"),
      status: row.status,
      resource: readSessionResourceFromStepData(row.step_data),
      adaptationNote: readSessionAdaptationNote(row.step_data),
      reviewConcept: readTextProperty(row.step_data, "reviewConcept") || undefined,
      reviewType: readConceptReviewType(row.step_data),
    };

    const current = sessionsByPlanId.get(row.plan_id) ?? [];
    current.push(session);
    sessionsByPlanId.set(row.plan_id, current);
    planIdBySessionId.set(row.id, row.plan_id);
    plannedMinutesBySessionId.set(row.id, row.estimated_minutes);

    const activeSessionCheckpoint = readActiveSessionCheckpoint(
      readProperty(row.step_data, "activeSessionCheckpoint"),
      checkpointReadAt,
    );
    if (
      activeSessionCheckpoint
      && activeSessionCheckpoint.resourceGeneratedAt
      && activeSessionCheckpoint.accountId === authData.user.id
      && activeSessionCheckpoint.planId === row.plan_id
      && activeSessionCheckpoint.planSessionId === row.id
    ) {
      activeSessionCheckpoints.push(activeSessionCheckpoint);
    }
  }

  const plans = planRows.flatMap<LearningPlan>((planRow) => {
    const item = itemsById.get(planRow.learning_item_id);
    if (!item) return [];
    const sessions = sessionsByPlanId.get(planRow.id) ?? [];
    sessions.sort((left, right) => left.sequence - right.sequence);
    const knowledgeMap = readPlanKnowledgeMap(planRow.knowledge_map);
    const topic = resolveLearningTopic(item.topic, item.title);

    return [{
      id: planRow.id,
      learningItemId: item.id,
      title: resolveLearningTitle(item.title, topic),
      topic,
      kind: item.kind,
      deadline: item.deadline,
      status: planRow.status,
      sourceMode: item.source_mode,
      studyMode: item.study_mode,
      learningIntent: readLearningIntent(planRow.generation_inputs),
      creationIntent: readCreationIntent(planRow.generation_inputs),
      sessionArchitectureVersion: resolveSessionArchitectureVersion(planRow.generation_inputs, knowledgeMap),
      rationale: planRow.rationale,
      createdAt: planRow.created_at || item.created_at,
      knowledgeMap,
      materials: materialsByItemId.get(item.id) ?? [],
      sessions,
    }];
  });

  const sessionCompletions = attemptRows.flatMap<SessionCompletion>((attempt) => {
    const planId = planIdBySessionId.get(attempt.plan_session_id);
    if (!planId || !attempt.completed_at) return [];

    return [normalizeSessionCompletionProvenance({
      id: attempt.id,
      planId,
      planSessionId: attempt.plan_session_id,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
      plannedMinutes: plannedMinutesBySessionId.get(attempt.plan_session_id) ?? attempt.actual_minutes ?? 1,
      actualMinutes: attempt.actual_minutes ?? 1,
      correctAnswers: attempt.correct_answers ?? 0,
      totalAnswers: attempt.total_answers ?? 0,
      feedback: isSessionFeedback(attempt.user_feedback) ? attempt.user_feedback : "about_right",
      observedGap: readTextProperty(attempt.result_data, "observedGap") || "No observation recorded",
      completionMode: normalizeSessionCompletionMode(
        readTextProperty(attempt.result_data, "completionMode"),
      ),
      conceptEvidence: readConceptEvidenceProperty(attempt.result_data),
      confidenceEvidence: readConfidenceEvidenceProperty(attempt.result_data),
    })];
  });

  const sessionInterruptions = interruptionRows.flatMap<SessionInterruption>((event) => {
    if (!event.plan_session_id) return [];
    const planId = planIdBySessionId.get(event.plan_session_id);
    const attemptId = readTextProperty(event.event_data, "attemptId");
    const startedAt = readTextProperty(event.event_data, "startedAt");
    const plannedMinutes = readNumberProperty(event.event_data, "plannedMinutes");
    const actualMinutes = readNumberProperty(event.event_data, "actualMinutes");
    const completedSteps = readNumberProperty(event.event_data, "completedSteps");
    const totalSteps = readNumberProperty(event.event_data, "totalSteps");
    const resumeStep = readNumberProperty(event.event_data, "resumeStep");
    const evidence = readSessionEvidenceSnapshot(readProperty(event.event_data, "evidence"));
    const pendingRepair = readSessionPendingRepair(readProperty(event.event_data, "pendingRepair"));
    const sessionAdjustment = readSessionAdjustmentSnapshot(readProperty(event.event_data, "sessionAdjustment"));
    const activityProgress = readSessionActivityProgress(readProperty(event.event_data, "activityProgress"));
    if (!planId || !attemptId || !startedAt || plannedMinutes === null || actualMinutes === null || completedSteps === null || totalSteps === null) return [];

    return [{
      id: attemptId,
      planId,
      planSessionId: event.plan_session_id,
      startedAt,
      interruptedAt: event.occurred_at,
      plannedMinutes,
      actualMinutes,
      completedSteps,
      totalSteps,
      ...(resumeStep === null ? {} : { resumeStep }),
      ...(evidence ? { evidence } : {}),
      ...(pendingRepair ? { pendingRepair } : {}),
      ...(sessionAdjustment ? { sessionAdjustment } : {}),
      ...(activityProgress ? { activityProgress } : {}),
    }];
  });

  return {
    displayName: profile.display_name?.trim() ?? "",
    onboardingCompleted: Boolean(profile.onboarding_completed_at),
    onboardingAnswers: learnerProfileToAnswers(learnerProfile),
    plans,
    deadlineMilestones,
    sessionCompletions,
    sessionInterruptions,
    activeSessionCheckpoints,
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function readLearningMode(value: unknown) {
  const candidate = readTextProperty(value, "learningMode");
  return candidate === "learn" || candidate === "study" ? candidate : null;
}

function readLearningIntent(value: unknown) {
  const candidate = readTextProperty(value, "learningIntent");
  return candidate === "learn" || candidate === "study" ? candidate : "study";
}

function readCreationIntent(value: unknown): LearningPlan["creationIntent"] {
  const candidate = readTextProperty(value, "intent");
  return candidate === "study_now" ? "study_now" : "plan";
}

export class ActiveSessionCheckpointConflictError extends Error {
  constructor() {
    super("YOVA found a different saved version of this lesson in your account.");
    this.name = "ActiveSessionCheckpointConflictError";
  }
}

export class ActiveSessionCheckpointTerminalError extends Error {
  constructor() {
    super("This lesson is already complete and its recovery marker was removed.");
    this.name = "ActiveSessionCheckpointTerminalError";
  }
}

type ActiveSessionCheckpointWriteWaiter = {
  resolve: (checkpoint: ActiveSessionCheckpointV1) => void;
  reject: (reason: unknown) => void;
};

type CloudSyncActiveSessionCheckpoint = ActiveSessionCheckpointV1 & {
  resourceGeneratedAt: string;
};

type ActiveSessionCheckpointWriteQueue = {
  latestRequested: CloudSyncActiveSessionCheckpoint;
  pending: CloudSyncActiveSessionCheckpoint | null;
  waiters: ActiveSessionCheckpointWriteWaiter[];
  running: boolean;
};

const activeSessionCheckpointWriteQueues = new Map<string, ActiveSessionCheckpointWriteQueue>();

/**
 * Keeps at most one save in flight for each lesson. Writes queued behind it are
 * collapsed to the checkpoint with the most progress so an older browser event
 * cannot roll back a newer completed step. Every caller waits for the queue to
 * drain and receives the final authoritative server checkpoint.
 */
export function saveAuthenticatedActiveSessionCheckpoint(
  value: ActiveSessionCheckpointV1,
) {
  const checkpoint = readActiveSessionCheckpoint(value);
  if (!checkpoint || !checkpoint.resourceGeneratedAt) {
    return Promise.reject(new Error("YOVA refused to sync an invalid session recovery marker."));
  }
  if (!isSupabaseConfigured()) return Promise.resolve(checkpoint);
  const cloudCheckpoint: CloudSyncActiveSessionCheckpoint = {
    ...checkpoint,
    resourceGeneratedAt: checkpoint.resourceGeneratedAt,
  };

  return new Promise<ActiveSessionCheckpointV1>((resolve, reject) => {
    const queue = activeSessionCheckpointWriteQueues.get(cloudCheckpoint.planSessionId);
    if (queue) {
      if (preferQueuedActiveSessionCheckpoint(cloudCheckpoint, queue.latestRequested)) {
        queue.latestRequested = cloudCheckpoint;
        queue.pending = cloudCheckpoint;
      }
      queue.waiters.push({ resolve, reject });
    } else {
      activeSessionCheckpointWriteQueues.set(cloudCheckpoint.planSessionId, {
        latestRequested: cloudCheckpoint,
        pending: cloudCheckpoint,
        waiters: [{ resolve, reject }],
        running: false,
      });
    }

    const activeQueue = activeSessionCheckpointWriteQueues.get(cloudCheckpoint.planSessionId);
    if (activeQueue && !activeQueue.running) {
      activeQueue.running = true;
      void drainActiveSessionCheckpointWrites(cloudCheckpoint.planSessionId);
    }
  });
}

async function drainActiveSessionCheckpointWrites(planSessionId: string) {
  const queue = activeSessionCheckpointWriteQueues.get(planSessionId);
  if (!queue) return;
  let authoritative: ActiveSessionCheckpointV1 | null = null;
  let finalIssue: unknown = null;

  while (queue.pending) {
    const checkpoint = queue.pending;
    queue.pending = null;
    try {
      authoritative = await persistAuthenticatedActiveSessionCheckpoint(checkpoint);
      finalIssue = null;
    } catch (error) {
      finalIssue = error;
    }
  }

  activeSessionCheckpointWriteQueues.delete(planSessionId);
  if (finalIssue || !authoritative) {
    const issue = finalIssue ?? new Error("YOVA could not confirm this lesson's cloud recovery point.");
    queue.waiters.forEach((waiter) => waiter.reject(issue));
  } else {
    queue.waiters.forEach((waiter) => waiter.resolve(authoritative));
  }
}

async function persistAuthenticatedActiveSessionCheckpoint(
  checkpoint: CloudSyncActiveSessionCheckpoint,
) {
  const supabase = createSupabaseBrowserClient();
  let data: unknown = null;
  let error: unknown = null;
  try {
    const result = await supabase.rpc("save_active_session_checkpoint_with_completion_mode", {
      payload: activeSessionCheckpointCloudPayload(checkpoint),
    });
    data = result.data;
    error = result.error;
  } catch (cause) {
    throw new CloudSyncTemporarilyUnavailableError(
      "YOVA kept this lesson on this device but could not sync its recovery point.",
      cause,
    );
  }

  if (error) {
    if (isActiveSessionCheckpointTerminalIssue(error)) {
      throw new ActiveSessionCheckpointTerminalError();
    }
    if (isActiveSessionCheckpointConflictIssue(error)) {
      throw new ActiveSessionCheckpointConflictError();
    }
    throw new CloudSyncTemporarilyUnavailableError(
      "YOVA kept this lesson on this device but could not sync its recovery point.",
      error,
    );
  }

  const authoritative = readActiveSessionCheckpoint(data);
  if (!authoritative) {
    throw new Error("YOVA received an invalid cloud recovery point for this lesson.");
  }
  if (
    authoritative.accountId !== checkpoint.accountId
    || authoritative.planId !== checkpoint.planId
    || authoritative.planSessionId !== checkpoint.planSessionId
    || authoritative.runId !== checkpoint.runId
    || authoritative.resourceFingerprint !== checkpoint.resourceFingerprint
    || authoritative.resourceGeneratedAt !== checkpoint.resourceGeneratedAt
  ) {
    throw new ActiveSessionCheckpointConflictError();
  }
  return authoritative;
}

export async function deleteAuthenticatedActiveSessionCheckpoint(
  planSessionId: string,
  runId?: string,
) {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("delete_active_session_checkpoint", {
    requested_plan_session_id: planSessionId,
    requested_run_id: runId ?? null,
  });
  if (error) {
    throw new Error("YOVA could not remove this lesson recovery point from the cloud.");
  }
}

function preferQueuedActiveSessionCheckpoint(
  candidate: CloudSyncActiveSessionCheckpoint,
  current: CloudSyncActiveSessionCheckpoint,
) {
  if (
    candidate.runId === current.runId
    && candidate.resourceFingerprint === current.resourceFingerprint
    && candidate.resourceGeneratedAt === current.resourceGeneratedAt
  ) {
    return compareActiveSessionCheckpointProgress(candidate, current) > 0;
  }
  return Date.parse(candidate.savedAt) > Date.parse(current.savedAt);
}

function activeSessionCheckpointCloudPayload(checkpoint: CloudSyncActiveSessionCheckpoint) {
  return {
    version: checkpoint.version,
    runId: checkpoint.runId,
    planSessionId: checkpoint.planSessionId,
    status: checkpoint.status,
    startedAt: checkpoint.startedAt,
    savedAt: checkpoint.savedAt,
    activeSeconds: checkpoint.activeSeconds,
    plannedMinutes: checkpoint.plannedMinutes,
    completedSteps: checkpoint.completedSteps,
    totalSteps: checkpoint.totalSteps,
    resumeStep: checkpoint.resumeStep,
    resourceFingerprint: checkpoint.resourceFingerprint,
    resourceGeneratedAt: checkpoint.resourceGeneratedAt,
    ...(checkpoint.completionMode ? { completionMode: checkpoint.completionMode } : {}),
    ...(checkpoint.evidence ? { evidence: checkpoint.evidence } : {}),
    ...(checkpoint.pendingRepair ? { pendingRepair: checkpoint.pendingRepair } : {}),
    ...(checkpoint.activityProgress ? { activityProgress: checkpoint.activityProgress } : {}),
    ...(checkpoint.status === "awaiting_finish" ? {
      completedAt: checkpoint.completedAt,
      completionFeedback: checkpoint.completionFeedback,
    } : {}),
  };
}

function isActiveSessionCheckpointConflictIssue(error: unknown) {
  const code = readTextProperty(error, "code");
  const message = readTextProperty(error, "message").toLowerCase();
  return code === "40001" || message.includes("active_session_checkpoint_conflict");
}

function isActiveSessionCheckpointTerminalIssue(error: unknown) {
  const code = readTextProperty(error, "code");
  const message = readTextProperty(error, "message").toLowerCase();
  return code === "55000" || message.includes("active_session_checkpoint_terminal");
}

type LearnerProfileSaveInput = {
  accountId: string;
  displayName: string;
  onboardingAnswers: string[];
};

type QueuedLearnerProfileWrite = {
  input: LearnerProfileSaveInput;
  cancelled: boolean;
  waiters: Array<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  }>;
};

const pendingLearnerProfileWrites = new Map<string, QueuedLearnerProfileWrite>();
let activeLearnerProfileWrite: QueuedLearnerProfileWrite | null = null;
let learnerProfileWriteRunning = false;

/**
 * Profile edits can arrive close together (for example, a receipt followed by
 * a preference change). Keep one cloud write in flight and coalesce anything
 * waiting behind it so an older request can never finish after a newer one.
 */
export function saveAuthenticatedLearnerProfile(input: LearnerProfileSaveInput) {
  if (!isSupabaseConfigured()) return Promise.resolve();
  const queuedInput = {
    accountId: input.accountId,
    displayName: input.displayName,
    onboardingAnswers: [...input.onboardingAnswers],
  };

  return new Promise<void>((resolve, reject) => {
    const pendingWrite = pendingLearnerProfileWrites.get(input.accountId);
    if (pendingWrite) {
      pendingWrite.input = queuedInput;
      pendingWrite.waiters.push({ resolve, reject });
    } else {
      pendingLearnerProfileWrites.set(input.accountId, {
        input: queuedInput,
        cancelled: false,
        waiters: [{ resolve, reject }],
      });
    }

    if (!learnerProfileWriteRunning) {
      learnerProfileWriteRunning = true;
      void drainLearnerProfileWrites();
    }
  });
}

/**
 * A confirmed sign-out invalidates only that account's queued profile work.
 * Writes for a later account stay separate and wait for the active request to
 * settle before the provider identity is checked again.
 */
export function cancelAuthenticatedLearnerProfileWrites(accountId: string) {
  const issue = new CloudAccountIdentityMismatchError();
  const pendingWrite = pendingLearnerProfileWrites.get(accountId);
  if (pendingWrite) {
    pendingLearnerProfileWrites.delete(accountId);
    pendingWrite.cancelled = true;
    pendingWrite.waiters.forEach((waiter) => waiter.reject(issue));
  }
  if (activeLearnerProfileWrite?.input.accountId === accountId) {
    activeLearnerProfileWrite.cancelled = true;
  }
}

async function drainLearnerProfileWrites() {
  while (pendingLearnerProfileWrites.size > 0) {
    const next = pendingLearnerProfileWrites.entries().next().value as
      | [string, QueuedLearnerProfileWrite]
      | undefined;
    if (!next) break;
    const [accountId, write] = next;
    pendingLearnerProfileWrites.delete(accountId);
    activeLearnerProfileWrite = write;
    try {
      if (write.cancelled) throw new CloudAccountIdentityMismatchError();
      await persistAuthenticatedLearnerProfile(write.input, () => write.cancelled);
      if (write.cancelled) throw new CloudAccountIdentityMismatchError();
      write.waiters.forEach((waiter) => waiter.resolve());
    } catch (error) {
      write.waiters.forEach((waiter) => waiter.reject(error));
    } finally {
      activeLearnerProfileWrite = null;
    }
  }
  learnerProfileWriteRunning = false;
}

async function persistAuthenticatedLearnerProfile(
  input: LearnerProfileSaveInput,
  isCancelled: () => boolean,
) {
  const [preferredSessionMin, preferredSessionMax] = parseSessionRange(input.onboardingAnswers[2]);
  const supabase = createSupabaseBrowserClient();
  let user: { id: string } | null = null;
  let identityError: unknown = null;
  try {
    const identity = await supabase.auth.getUser();
    user = identity.data.user;
    identityError = identity.error;
  } catch (cause) {
    throw new CloudSyncTemporarilyUnavailableError(
      LEARNER_PROFILE_IDENTITY_SYNC_WARNING,
      cause,
    );
  }
  if (isCancelled()) throw new CloudAccountIdentityMismatchError();
  if (identityError || !user) {
    throw new CloudSyncTemporarilyUnavailableError(
      LEARNER_PROFILE_IDENTITY_SYNC_WARNING,
      identityError,
    );
  }
  if (user.id !== input.accountId) throw new CloudAccountIdentityMismatchError();

  let saveError: unknown = null;
  try {
    const result = await supabase.rpc("save_learner_profile", {
      payload: {
        expectedAccountId: input.accountId,
        displayName: input.displayName.trim(),
        onboardingCompletedAt: new Date().toISOString(),
        commonBlocker: onboardingAnswerId(0, input.onboardingAnswers[0]) ?? input.onboardingAnswers[0] ?? "",
        guidancePreference: onboardingAnswerId(1, input.onboardingAnswers[1]) ?? input.onboardingAnswers[1] ?? "",
        preferredSessionMin,
        preferredSessionMax,
        explanationPreference: onboardingAnswerId(3, input.onboardingAnswers[3]) ?? input.onboardingAnswers[3] ?? "",
        focusFrequency: onboardingAnswerId(4, input.onboardingAnswers[4]) ?? input.onboardingAnswers[4] ?? "",
        startingPattern: onboardingAnswerId(5, input.onboardingAnswers[5]) ?? input.onboardingAnswers[5] ?? "",
        energyWindow: onboardingAnswerId(6, input.onboardingAnswers[6]) ?? input.onboardingAnswers[6] ?? "",
        primaryImprovementGoal: onboardingAnswerId(7, input.onboardingAnswers[7]) ?? input.onboardingAnswers[7] ?? "",
        additionalContext: encodeAdditionalLearnerContext(input.onboardingAnswers),
      },
    });
    saveError = result.error;
  } catch (cause) {
    throw new CloudSyncTemporarilyUnavailableError(
      LEARNER_PROFILE_SAVE_SYNC_WARNING,
      cause,
    );
  }

  if (saveError) {
    throw new CloudSyncTemporarilyUnavailableError(
      LEARNER_PROFILE_SAVE_SYNC_WARNING,
      saveError,
    );
  }
}

export async function completeAuthenticatedPlanSession(
  completion: SessionCompletion,
  adaptation?: NextSessionAdaptation | null,
  followUpSession?: LearningPlanSession | null,
) {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const normalizedCompletion = normalizeSessionCompletionProvenance(completion);
  const completionMode = normalizeSessionCompletionMode(normalizedCompletion.completionMode);
  if (
    completionMode === "unguided_practice"
    && (!followUpSession
      || followUpSession.reviewType !== "verify"
      || followUpSession.learningMode !== "study")
  ) {
    throw new Error("YOVA cannot complete ungraded practice without preserving its required guided verification.");
  }
  const completionRpc = completionMode === "unguided_practice"
    ? "complete_unguided_plan_session"
    : "complete_plan_session";
  const { error } = await supabase.rpc(completionRpc, {
    payload: {
      attemptId: normalizedCompletion.id,
      planSessionId: normalizedCompletion.planSessionId,
      startedAt: normalizedCompletion.startedAt,
      completedAt: normalizedCompletion.completedAt,
      plannedMinutes: normalizedCompletion.plannedMinutes,
      actualMinutes: normalizedCompletion.actualMinutes,
      correctAnswers: normalizedCompletion.correctAnswers,
      totalAnswers: normalizedCompletion.totalAnswers,
      feedback: normalizedCompletion.feedback,
      observedGap: normalizedCompletion.observedGap,
      completionMode,
      conceptEvidence: normalizedCompletion.conceptEvidence,
      confidenceEvidence: normalizedCompletion.confidenceEvidence,
      nextSessionAdjustment: adaptation ?? null,
      followUpSession: followUpSession ? {
        id: followUpSession.id,
        sequence: followUpSession.sequence,
        title: followUpSession.title,
        objective: followUpSession.objective,
        method: followUpSession.method,
        methodReason: followUpSession.methodReason,
        scheduledFor: followUpSession.scheduledFor,
        estimatedMinutes: followUpSession.estimatedMinutes,
        amountLabel: followUpSession.amountLabel,
        learningMode: followUpSession.learningMode,
        explanation: followUpSession.adaptationNote?.explanation ?? followUpSession.methodReason,
        topicIds: followUpSession.topicIds ?? [],
        contentTargets: followUpSession.contentTargets ?? [],
        completionEvidence: followUpSession.completionEvidence ?? [],
        reviewConcept: followUpSession.reviewConcept,
        reviewType: followUpSession.reviewType,
      } : null,
    },
  });

  if (error) throw new Error("YOVA saved this session in your browser but could not sync it to the cloud.");
  if (adaptation) {
    const { error: modeError } = await supabase.rpc("set_plan_session_learning_mode", {
      requested_session_id: adaptation.planSessionId,
      requested_learning_mode: adaptation.learningMode,
    });
    if (modeError) throw new Error("YOVA saved this session but could not sync the next session’s teaching approach.");
  }
}

export async function activateAuthenticatedConceptReviewSession(
  planId: string,
  session: LearningPlanSession,
) {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("activate_concept_review", {
    payload: {
      planId,
      session: {
        id: session.id,
        sequence: session.sequence,
        title: session.title,
        objective: session.objective,
        method: session.method,
        methodReason: session.methodReason,
        scheduledFor: session.scheduledFor,
        estimatedMinutes: session.estimatedMinutes,
        amountLabel: session.amountLabel,
        learningMode: session.learningMode,
        explanation: session.adaptationNote?.explanation ?? session.methodReason,
        topicIds: session.topicIds ?? [],
        reviewConcept: session.reviewConcept,
        reviewType: session.reviewType,
      },
    },
  });

  if (error) throw new Error("YOVA could not reopen this goal for its scheduled review.");
}

export async function recordAuthenticatedSessionInterruption(interruption: SessionInterruption) {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const rpcName = interruption.activityProgress
    ? "record_session_interruption_with_activity_progress"
    : "record_session_interruption";
  const { error } = await supabase.rpc(rpcName, {
    payload: {
      attemptId: interruption.id,
      planSessionId: interruption.planSessionId,
      startedAt: interruption.startedAt,
      interruptedAt: interruption.interruptedAt,
      plannedMinutes: interruption.plannedMinutes,
      actualMinutes: interruption.actualMinutes,
      completedSteps: interruption.completedSteps,
      totalSteps: interruption.totalSteps,
      resumeStep: interruption.resumeStep,
      evidence: interruption.evidence,
      pendingRepair: interruption.pendingRepair,
      sessionAdjustment: interruption.sessionAdjustment,
      ...(interruption.activityProgress ? { activityProgress: interruption.activityProgress } : {}),
    },
  });

  if (error) throw new Error("YOVA kept this session open but could not sync the interruption to the cloud.");
}

function learnerProfileToAnswers(profile: LearnerProfileRow | null) {
  const answers = Array.from({ length: LEARNER_ANSWER_COUNT }, () => "");
  if (!profile) return answers;

  answers[0] = onboardingAnswerId(0, profile.common_blocker) ?? profile.common_blocker ?? "";
  answers[1] = onboardingAnswerId(1, profile.guidance_preference) ?? profile.guidance_preference ?? "";
  answers[2] = onboardingAnswerId(
    2,
    formatSessionRange(profile.preferred_session_min, profile.preferred_session_max),
  ) ?? "";
  answers[3] = onboardingAnswerId(3, profile.explanation_preference) ?? profile.explanation_preference ?? "";
  answers[4] = onboardingAnswerId(4, profile.focus_frequency) ?? profile.focus_frequency ?? "";
  answers[5] = onboardingAnswerId(5, profile.starting_pattern) ?? profile.starting_pattern ?? "";
  answers[6] = onboardingAnswerId(6, profile.energy_window) ?? profile.energy_window ?? "";
  answers[7] = onboardingAnswerId(7, profile.primary_improvement_goal) ?? profile.primary_improvement_goal ?? "";
  // Functional support context is restored from additional_context. Older
  // diagnosis-style answers were never stored there and are not migrated.
  return mergeStoredAdditionalContext(answers, profile.additional_context);
}

function parseSessionRange(answer?: string): [number | null, number | null] {
  const label = onboardingAnswerLabel(2, answer);
  if (!label) return [null, null];
  const values = label.match(/\d+/g)?.map(Number) ?? [];
  if (values.length < 2) return [null, null];
  return [values[0], values[1]];
}

function formatSessionRange(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return "";
  return `${minimum} to ${maximum} minutes`;
}

function isSessionFeedback(value: unknown): value is SessionCompletion["feedback"] {
  return value === "too_easy" || value === "about_right" || value === "too_difficult";
}

function readConceptReviewType(value: unknown): LearningPlanSession["reviewType"] | undefined {
  const candidate = readTextProperty(value, "reviewType");
  return candidate === "repair_and_retrieve" || candidate === "verify" || candidate === "maintenance_transfer"
    ? candidate
    : undefined;
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function readProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function readNumberProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" && Number.isFinite(property) ? property : null;
}

function readPositiveIntegerProperty(value: unknown, key: string) {
  const property = readNumberProperty(value, key);
  return property !== null && Number.isInteger(property) && property > 0
    ? property
    : undefined;
}

function readStringArrayProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const property = (value as Record<string, unknown>)[key];
  if (!Array.isArray(property)) return [];
  return property.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6);
}

function readPlanKnowledgeMap(value: unknown) {
  const parsed = PlanKnowledgeMapSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readMaterialUnderstanding(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = MaterialUnderstandingSchema.safeParse((value as Record<string, unknown>).understanding);
  return parsed.success ? parsed.data : null;
}

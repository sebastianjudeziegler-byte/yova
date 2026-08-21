"use client";

import { z } from "zod";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletionMode,
  SessionInterruption,
  SessionResource,
} from "@/lib/domain";
import {
  MethodWorkProgressSchema,
  type MethodWorkProgress,
} from "@/lib/learning/method-work-progress";
import {
  SessionActivityProgressSchema,
  sessionActivityProgressRank,
  type SessionActivityProgress,
} from "@/lib/learning/session-activity-progress";
import {
  resumableSessionProgress,
  SessionAdjustmentSnapshotSchema,
  SessionEvidenceSnapshotSchema,
} from "@/lib/learning/session-resume";

const STORAGE_KEY = "yova.active-session-checkpoints.v1";
const MAX_CHECKPOINTS_PER_ACCOUNT = 12;
const MAX_STORED_CHECKPOINTS = 48;
const MAX_STORAGE_CHARACTERS = 500_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const ACTIVE_SESSION_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const SafeIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const ResourceFingerprintSchema = z.string().regex(/^sr1:[0-9a-f]{16}$/);

const CheckpointPendingRepairSchema = z.object({
  concept: z.string().trim().min(2).max(120),
  correctAnswer: z.string().trim().min(1).max(700),
}).strict();

const CheckpointBaseShape = {
  version: z.literal(1),
  accountId: SafeIdentifierSchema,
  runId: SafeIdentifierSchema,
  planId: SafeIdentifierSchema,
  planSessionId: SafeIdentifierSchema,
  startedAt: z.string().datetime({ offset: true }),
  savedAt: z.string().datetime({ offset: true }),
  activeSeconds: z.number().int().min(0).max(21_600),
  plannedMinutes: z.number().int().min(5).max(180),
  completedSteps: z.number().int().min(0).max(24),
  totalSteps: z.number().int().min(1).max(24),
  resumeStep: z.number().int().min(0).max(24),
  resourceFingerprint: ResourceFingerprintSchema,
  resourceGeneratedAt: z.string().datetime({ offset: true }).optional(),
  completionMode: z.enum(["guided", "unguided_practice"]).optional(),
  methodWork: MethodWorkProgressSchema.optional(),
  sessionAdjustment: SessionAdjustmentSnapshotSchema.optional(),
};

const WorkingCheckpointSchema = z.object({
  ...CheckpointBaseShape,
  status: z.literal("working"),
  evidence: SessionEvidenceSnapshotSchema.optional(),
  pendingRepair: CheckpointPendingRepairSchema.optional(),
  activityProgress: SessionActivityProgressSchema.optional(),
  completedAt: z.never().optional(),
}).strict();

const AwaitingFinishCheckpointSchema = z.object({
  ...CheckpointBaseShape,
  status: z.literal("awaiting_finish"),
  evidence: SessionEvidenceSnapshotSchema,
  pendingRepair: z.never().optional(),
  activityProgress: z.never().optional(),
  completedAt: z.string().datetime({ offset: true }),
  completionFeedback: z.enum(["too_easy", "about_right", "too_difficult"]),
}).strict();

export const ActiveSessionCheckpointV1Schema = z.discriminatedUnion("status", [
  WorkingCheckpointSchema,
  AwaitingFinishCheckpointSchema,
]).superRefine((checkpoint, context) => {
  const startedAt = Date.parse(checkpoint.startedAt);
  const savedAt = Date.parse(checkpoint.savedAt);

  if (startedAt > savedAt) {
    context.addIssue({
      code: "custom",
      message: "The checkpoint cannot be saved before the session starts.",
      path: ["savedAt"],
    });
  }
  if (checkpoint.resumeStep > checkpoint.totalSteps) {
    context.addIssue({
      code: "custom",
      message: "The resume step cannot exceed the session length.",
      path: ["resumeStep"],
    });
  }
  if (checkpoint.resumeStep > checkpoint.completedSteps) {
    context.addIssue({
      code: "custom",
      message: "The resume step cannot skip unfinished work.",
      path: ["resumeStep"],
    });
  }
  if (checkpoint.status === "working" && checkpoint.completedSteps >= checkpoint.totalSteps) {
    context.addIssue({
      code: "custom",
      message: "A working checkpoint must have unfinished steps.",
      path: ["completedSteps"],
    });
  }
  if (checkpoint.status === "awaiting_finish") {
    const completedAt = Date.parse(checkpoint.completedAt);
    if (checkpoint.completedSteps !== checkpoint.totalSteps) {
      context.addIssue({
        code: "custom",
        message: "A finished checkpoint must include every session step.",
        path: ["completedSteps"],
      });
    }
    if (completedAt < startedAt || completedAt > savedAt + MAX_FUTURE_CLOCK_SKEW_MS) {
      context.addIssue({
        code: "custom",
        message: "The completion time is outside the checkpoint window.",
        path: ["completedAt"],
      });
    }
  }
});

export type ActiveSessionCheckpointV1 = z.infer<typeof ActiveSessionCheckpointV1Schema>;

export type ActiveSessionCheckpointMergeResult = {
  checkpoints: ActiveSessionCheckpointV1[];
  cloudRunIds: Set<string>;
  checkpointsToUpload: ActiveSessionCheckpointV1[];
  conflictingLocalRuns: ActiveSessionCheckpointV1[];
};

export type ActiveSessionCheckpointResumePoint = SessionInterruption & {
  source: "active_session_checkpoint";
  checkpointStatus: ActiveSessionCheckpointV1["status"];
  runId: string;
  activeSeconds: number;
  savedAt: string;
  resourceFingerprint: string;
  resourceGeneratedAt?: string;
  completionMode: SessionCompletionMode;
  completedAt?: string;
  completionFeedback?: "too_easy" | "about_right" | "too_difficult";
  methodWork?: MethodWorkProgress;
  activityProgress?: SessionActivityProgress;
};

/**
 * Cloud checkpoint data is untrusted JSON. In addition to the bounded schema,
 * reject any raw learner-answer or generated-tutor fields even when they are
 * nested somewhere Zod would otherwise strip. This keeps an accidental future
 * server payload from turning a recovery marker into a transcript store.
 */
export function readActiveSessionCheckpoint(
  value: unknown,
  now = Date.now(),
): ActiveSessionCheckpointV1 | null {
  if (hasForbiddenCheckpointContent(value)) return null;
  try {
    const parsed = ActiveSessionCheckpointV1Schema.safeParse(value);
    return parsed.success && isCheckpointFresh(parsed.data, now) ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Returns a positive number when `left` contains more recoverable progress.
 * Wall-clock time is deliberately the final tie-breaker so a late, stale write
 * cannot roll back a completed step or the awaiting-finish screen.
 */
export function compareActiveSessionCheckpointProgress(
  left: ActiveSessionCheckpointV1,
  right: ActiveSessionCheckpointV1,
) {
  const statusDifference = checkpointStatusRank(left.status) - checkpointStatusRank(right.status);
  if (statusDifference !== 0) return statusDifference;
  if (left.completedSteps !== right.completedSteps) {
    return left.completedSteps - right.completedSteps;
  }
  if (left.resumeStep !== right.resumeStep) return left.resumeStep - right.resumeStep;
  const activityProgressDifference = sessionActivityProgressRank(left.activityProgress)
    - sessionActivityProgressRank(right.activityProgress);
  if (activityProgressDifference !== 0) return activityProgressDifference;
  const methodWorkDifference = methodWorkProgressRank(left.methodWork)
    - methodWorkProgressRank(right.methodWork);
  if (methodWorkDifference !== 0) return methodWorkDifference;
  if (left.activeSeconds !== right.activeSeconds) return left.activeSeconds - right.activeSeconds;
  return compareIsoTimestamps(left.savedAt, right.savedAt);
}

/**
 * Reconciles browser recovery with the account's cloud recovery marker.
 * A different cloud run (or lesson fingerprint) wins outright: another device
 * may own that lesson and uploading the browser copy would overwrite it. For
 * the same run and lesson, the checkpoint with the most actual progress wins.
 */
export function mergeActiveSessionCheckpoints(
  localValues: readonly ActiveSessionCheckpointV1[],
  cloudValues: readonly ActiveSessionCheckpointV1[],
  now = Date.now(),
): ActiveSessionCheckpointMergeResult {
  const localBySession = checkpointsBySession(localValues, now);
  const cloudBySession = checkpointsBySession(cloudValues, now);
  const cloudRunIds = new Set<string>();
  const checkpointsToUpload: ActiveSessionCheckpointV1[] = [];
  const conflictingLocalRuns: ActiveSessionCheckpointV1[] = [];
  const checkpoints: ActiveSessionCheckpointV1[] = [];
  const sessionIds = new Set([...localBySession.keys(), ...cloudBySession.keys()]);

  for (const planSessionId of sessionIds) {
    const local = localBySession.get(planSessionId);
    const cloud = cloudBySession.get(planSessionId);
    if (!local && !cloud) continue;
    if (!local && cloud) {
      checkpoints.push(cloud);
      cloudRunIds.add(cloud.runId);
      continue;
    }
    if (local && !cloud) {
      checkpoints.push(local);
      checkpointsToUpload.push(local);
      continue;
    }
    if (!local || !cloud) continue;

    if (
      local.accountId !== cloud.accountId
      || local.planId !== cloud.planId
      || local.runId !== cloud.runId
      || local.resourceFingerprint !== cloud.resourceFingerprint
      || local.resourceGeneratedAt !== cloud.resourceGeneratedAt
    ) {
      checkpoints.push(cloud);
      cloudRunIds.add(cloud.runId);
      conflictingLocalRuns.push(local);
      continue;
    }

    if (compareActiveSessionCheckpointProgress(local, cloud) > 0) {
      checkpoints.push(local);
      checkpointsToUpload.push(local);
    } else {
      checkpoints.push(cloud);
      cloudRunIds.add(cloud.runId);
    }
  }

  checkpoints.sort((left, right) => compareIsoTimestamps(right.savedAt, left.savedAt));
  checkpointsToUpload.sort((left, right) => compareIsoTimestamps(left.savedAt, right.savedAt));
  conflictingLocalRuns.sort((left, right) => compareIsoTimestamps(right.savedAt, left.savedAt));

  return {
    checkpoints,
    cloudRunIds,
    checkpointsToUpload,
    conflictingLocalRuns,
  };
}

export function saveActiveSessionCheckpoint(checkpoint: ActiveSessionCheckpointV1) {
  const parsed = ActiveSessionCheckpointV1Schema.safeParse(checkpoint);
  if (!parsed.success || !isCheckpointFresh(parsed.data, Date.now())) return false;

  const storage = browserStorage();
  if (!storage) return false;
  const stored = readStoredCheckpoints(storage, Date.now());
  if (!stored.ok) return false;

  return writeStoredCheckpoints(
    storage,
    normalizeStoredCheckpoints([...stored.checkpoints, parsed.data], Date.now()),
  );
}

export function loadActiveSessionCheckpoints(accountId: string) {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  if (!parsedAccountId.success) return [];

  const storage = browserStorage();
  if (!storage) return [];
  const stored = readStoredCheckpoints(storage, Date.now());
  if (!stored.ok) return [];

  return stored.checkpoints
    .filter((checkpoint) => checkpoint.accountId === parsedAccountId.data)
    .sort((left, right) => compareIsoTimestamps(right.savedAt, left.savedAt));
}

/** Fail-closed reader used by the portable current-device export. */
export function readActiveSessionCheckpointsForExport(accountId: string):
  | { ok: true; value: ActiveSessionCheckpointV1[] }
  | { ok: false } {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  if (!parsedAccountId.success) return { ok: false };
  const storage = browserStorage();
  if (!storage) return { ok: false };

  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return { ok: true, value: [] };
    if (stored.length > MAX_STORAGE_CHARACTERS) return { ok: false };
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length > MAX_STORED_CHECKPOINTS * 2) {
      return { ok: false };
    }
    const validated = parsed.map((entry) => {
      if (hasForbiddenCheckpointContent(entry)) return null;
      const result = ActiveSessionCheckpointV1Schema.safeParse(entry);
      return result.success ? result.data : null;
    });
    if (validated.some((checkpoint) => checkpoint === null)) return { ok: false };
    return {
      ok: true,
      value: normalizeStoredCheckpoints(
        validated.filter((checkpoint): checkpoint is ActiveSessionCheckpointV1 => checkpoint !== null),
        Date.now(),
      ).filter((checkpoint) => checkpoint.accountId === parsedAccountId.data)
        .sort((left, right) => compareIsoTimestamps(right.savedAt, left.savedAt)),
    };
  } catch {
    return { ok: false };
  }
}

export function latestActiveSessionCheckpointFor(
  planSessionId: string,
  checkpoints: readonly ActiveSessionCheckpointV1[],
) {
  return checkpoints
    .filter((checkpoint) => checkpoint.planSessionId === planSessionId)
    .sort((left, right) => compareIsoTimestamps(right.savedAt, left.savedAt))[0] ?? null;
}

export function removeActiveSessionCheckpoint(
  accountId: string,
  planSessionId: string,
  runId?: string,
) {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  const parsedPlanSessionId = SafeIdentifierSchema.safeParse(planSessionId);
  const parsedRunId = runId === undefined ? null : SafeIdentifierSchema.safeParse(runId);
  if (
    !parsedAccountId.success
    || !parsedPlanSessionId.success
    || (parsedRunId !== null && !parsedRunId.success)
  ) return false;

  const storage = browserStorage();
  if (!storage) return false;
  const stored = readStoredCheckpoints(storage, Date.now());
  if (!stored.ok) return false;

  return writeStoredCheckpoints(storage, stored.checkpoints.filter((checkpoint) => !(
    checkpoint.accountId === parsedAccountId.data
    && checkpoint.planSessionId === parsedPlanSessionId.data
    && (parsedRunId === null || checkpoint.runId === parsedRunId.data)
  )));
}

export function clearActiveSessionCheckpoints(accountId: string) {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  if (!parsedAccountId.success) return false;

  const storage = browserStorage();
  if (!storage) return false;
  const stored = readStoredCheckpoints(storage, Date.now());
  if (!stored.ok) return false;

  return writeStoredCheckpoints(
    storage,
    stored.checkpoints.filter((checkpoint) => checkpoint.accountId !== parsedAccountId.data),
  );
}

export function removeActiveSessionCheckpointsForPlan(accountId: string, planId: string) {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  const parsedPlanId = SafeIdentifierSchema.safeParse(planId);
  if (!parsedAccountId.success || !parsedPlanId.success) return false;

  const storage = browserStorage();
  if (!storage) return false;
  const stored = readStoredCheckpoints(storage, Date.now());
  if (!stored.ok) return false;

  return writeStoredCheckpoints(
    storage,
    stored.checkpoints.filter((checkpoint) => !(
      checkpoint.accountId === parsedAccountId.data
      && checkpoint.planId === parsedPlanId.data
    )),
  );
}

/**
 * Replaces one account's recovery markers in a single localStorage write while
 * preserving every other account. Startup reconciliation uses this instead of
 * ordinary saves because a cloud-authoritative different run must be able to
 * replace a browser checkpoint even when the browser timestamp is newer.
 */
export function replaceActiveSessionCheckpointsForAccount(
  accountId: string,
  checkpoints: readonly ActiveSessionCheckpointV1[],
) {
  const parsedAccountId = SafeIdentifierSchema.safeParse(accountId);
  if (!parsedAccountId.success) return false;
  const now = Date.now();
  const parsedCheckpoints: ActiveSessionCheckpointV1[] = [];
  for (const value of checkpoints) {
    const parsed = readActiveSessionCheckpoint(value, now);
    if (!parsed || parsed.accountId !== parsedAccountId.data) return false;
    parsedCheckpoints.push(parsed);
  }

  const storage = browserStorage();
  if (!storage) return false;
  const stored = readStoredCheckpoints(storage, now);
  if (!stored.ok) return false;

  return writeStoredCheckpoints(
    storage,
    normalizeStoredCheckpoints([
      ...stored.checkpoints.filter((checkpoint) => checkpoint.accountId !== parsedAccountId.data),
      ...parsedCheckpoints,
    ], now),
  );
}

export function fingerprintSessionResource(resource: SessionResource) {
  return fingerprintCheckpointIdentity(Object.fromEntries(
    Object.entries(resource).filter(([key]) => key !== "generatedAt"),
  ));
}

export function fingerprintMethodWorkSession({
  studyMode,
  session,
  topics,
  sourceFirstRequired,
}: {
  studyMode: LearningPlan["studyMode"];
  session: Pick<
    LearningPlanSession,
    | "objective"
    | "method"
    | "methodReason"
    | "estimatedMinutes"
    | "learningMode"
    | "contentTargets"
    | "completionEvidence"
  >;
  topics: readonly string[];
  sourceFirstRequired: boolean;
}) {
  return fingerprintCheckpointIdentity({
    kind: "method_work",
    studyMode,
    objective: session.objective,
    method: session.method,
    methodReason: session.methodReason,
    estimatedMinutes: session.estimatedMinutes,
    learningMode: session.learningMode,
    contentTargets: session.contentTargets ?? [],
    completionEvidence: session.completionEvidence ?? [],
    topics,
    sourceFirstRequired,
  });
}

export function checkpointMatchesMethodWorkSession(
  checkpoint: Pick<ActiveSessionCheckpointV1, "resourceFingerprint" | "methodWork">,
  input: Parameters<typeof fingerprintMethodWorkSession>[0],
) {
  return Boolean(
    checkpoint.methodWork
    && checkpoint.resourceFingerprint === fingerprintMethodWorkSession(input),
  );
}

export function checkpointMatchesSessionResource(
  checkpoint: Pick<
    ActiveSessionCheckpointV1,
    "resourceFingerprint" | "resourceGeneratedAt"
  >,
  resource: SessionResource,
) {
  return fingerprintSessionResource(resource) === checkpoint.resourceFingerprint
    && (
      checkpoint.resourceGeneratedAt === undefined
      || checkpoint.resourceGeneratedAt === resource.generatedAt
    );
}

export function checkpointToSessionResumePoint(
  checkpoint: ActiveSessionCheckpointV1,
): ActiveSessionCheckpointResumePoint {
  const repairReference = checkpoint.pendingRepair?.correctAnswer.slice(0, 520);
  return {
    id: checkpoint.runId,
    planId: checkpoint.planId,
    planSessionId: checkpoint.planSessionId,
    startedAt: checkpoint.startedAt,
    interruptedAt: checkpoint.savedAt,
    plannedMinutes: checkpoint.plannedMinutes,
    actualMinutes: Math.max(1, Math.ceil(checkpoint.activeSeconds / 60)),
    completedSteps: checkpoint.completedSteps,
    totalSteps: checkpoint.totalSteps,
    resumeStep: checkpoint.resumeStep,
    ...(checkpoint.evidence ? { evidence: checkpoint.evidence } : {}),
    ...(checkpoint.pendingRepair ? {
      pendingRepair: {
        concept: checkpoint.pendingRepair.concept,
        title: `Try ${checkpoint.pendingRepair.concept} again`,
        body: `Use this correction: ${repairReference}. Then explain ${checkpoint.pendingRepair.concept} again without looking.`,
        correctAnswer: checkpoint.pendingRepair.correctAnswer,
        feedback: "Compare your explanation with the reference answer, then retry from memory.",
      },
    } : {}),
    ...(checkpoint.sessionAdjustment ? { sessionAdjustment: checkpoint.sessionAdjustment } : {}),
    source: "active_session_checkpoint",
    checkpointStatus: checkpoint.status,
    runId: checkpoint.runId,
    activeSeconds: checkpoint.activeSeconds,
    savedAt: checkpoint.savedAt,
    resourceFingerprint: checkpoint.resourceFingerprint,
    ...(checkpoint.resourceGeneratedAt ? {
      resourceGeneratedAt: checkpoint.resourceGeneratedAt,
    } : {}),
    completionMode: checkpoint.completionMode ?? "guided",
    ...(checkpoint.methodWork ? { methodWork: checkpoint.methodWork } : {}),
    ...(checkpoint.activityProgress ? { activityProgress: checkpoint.activityProgress } : {}),
    ...(checkpoint.status === "awaiting_finish" ? {
      completedAt: checkpoint.completedAt,
      completionFeedback: checkpoint.completionFeedback,
    } : {}),
  };
}

export function chooseLatestSessionResumePoint(
  planSessionId: string,
  interruptions: SessionInterruption[],
  checkpoints: readonly ActiveSessionCheckpointV1[],
): SessionInterruption | ActiveSessionCheckpointResumePoint | null {
  const legacyInterruption = resumableSessionProgress(planSessionId, interruptions);
  const checkpoint = latestActiveSessionCheckpointFor(planSessionId, checkpoints);
  if (!checkpoint) return legacyInterruption;

  const checkpointResumePoint = checkpointToSessionResumePoint(checkpoint);
  if (!legacyInterruption) return checkpointResumePoint;
  return compareIsoTimestamps(checkpointResumePoint.interruptedAt, legacyInterruption.interruptedAt) >= 0
    ? checkpointResumePoint
    : legacyInterruption;
}

/**
 * A generated or built-in session can be intentionally browser-persisted when
 * cloud caching is unavailable. Restore only a missing cloud resource, and
 * only when the same-account checkpoint proves the local resource is the exact
 * lesson the learner was using. An existing cloud resource remains
 * authoritative so regenerated content invalidates an older checkpoint.
 */
export function restoreCheckpointSessionResources(
  cloudPlans: readonly LearningPlan[],
  localPlans: readonly LearningPlan[],
  checkpoints: readonly ActiveSessionCheckpointV1[],
) {
  const checkpointBySession = new Map(
    checkpoints.map((checkpoint) => [checkpoint.planSessionId, checkpoint]),
  );
  const localPlanById = new Map(localPlans.map((plan) => [plan.id, plan]));

  return cloudPlans.map((cloudPlan) => {
    const localPlan = localPlanById.get(cloudPlan.id);
    if (!localPlan) return cloudPlan;
    const localSessionById = new Map(localPlan.sessions.map((session) => [session.id, session]));
    let changed = false;
    const sessions = cloudPlan.sessions.map((cloudSession) => {
      if (cloudSession.status !== "ready") return cloudSession;
      const checkpoint = checkpointBySession.get(cloudSession.id);
      const localSession = localSessionById.get(cloudSession.id);
      if (
        !checkpoint
        || checkpoint.planId !== cloudPlan.id
        || !localSession?.resource
        || !checkpointMatchesSessionResource(checkpoint, localSession.resource)
      ) return cloudSession;
      if (cloudSession.resource) {
        if (checkpointMatchesSessionResource(checkpoint, cloudSession.resource)) {
          return cloudSession;
        }
        const cloudGeneratedAt = Date.parse(cloudSession.resource.generatedAt);
        const localGeneratedAt = Date.parse(localSession.resource.generatedAt);
        if (
          !Number.isFinite(cloudGeneratedAt)
          || !Number.isFinite(localGeneratedAt)
          || localGeneratedAt <= cloudGeneratedAt
        ) {
          return cloudSession;
        }
      }
      changed = true;
      return { ...cloudSession, resource: localSession.resource };
    });
    return changed ? { ...cloudPlan, sessions } : cloudPlan;
  });
}

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredCheckpoints(storage: Storage, now: number): {
  ok: boolean;
  checkpoints: ActiveSessionCheckpointV1[];
} {
  let stored: string | null;
  try {
    stored = storage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, checkpoints: [] };
  }
  if (!stored) return { ok: true, checkpoints: [] };

  try {
    if (stored.length > MAX_STORAGE_CHARACTERS) {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, checkpoints: [] };
    }

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, checkpoints: [] };
    }
    const validated = parsed
      .slice(-MAX_STORED_CHECKPOINTS * 2)
      .flatMap<ActiveSessionCheckpointV1>((candidate) => {
        const result = ActiveSessionCheckpointV1Schema.safeParse(candidate);
        return result.success ? [result.data] : [];
      });
    const normalized = normalizeStoredCheckpoints(validated, now);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      void writeStoredCheckpoints(storage, normalized);
    }
    return { ok: true, checkpoints: normalized };
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, checkpoints: [] };
    } catch {
      return { ok: false, checkpoints: [] };
    }
  }
}

function normalizeStoredCheckpoints(
  checkpoints: readonly ActiveSessionCheckpointV1[],
  now: number,
) {
  const latestByAccountAndSession = new Map<string, ActiveSessionCheckpointV1>();
  for (const checkpoint of checkpoints) {
    if (!isCheckpointFresh(checkpoint, now)) continue;
    const key = `${checkpoint.accountId}\u0000${checkpoint.planSessionId}`;
    const current = latestByAccountAndSession.get(key);
    if (!current || preferCheckpointWithinSource(checkpoint, current)) {
      latestByAccountAndSession.set(key, checkpoint);
    }
  }

  const byAccount = new Map<string, ActiveSessionCheckpointV1[]>();
  for (const checkpoint of latestByAccountAndSession.values()) {
    const current = byAccount.get(checkpoint.accountId) ?? [];
    current.push(checkpoint);
    byAccount.set(checkpoint.accountId, current);
  }

  return [...byAccount.values()]
    .flatMap((accountCheckpoints) => accountCheckpoints
      .sort((left, right) => compareIsoTimestamps(left.savedAt, right.savedAt))
      .slice(-MAX_CHECKPOINTS_PER_ACCOUNT))
    .sort((left, right) => compareIsoTimestamps(left.savedAt, right.savedAt))
    .slice(-MAX_STORED_CHECKPOINTS);
}

function isCheckpointFresh(checkpoint: ActiveSessionCheckpointV1, now: number) {
  const savedAt = Date.parse(checkpoint.savedAt);
  return savedAt <= now + MAX_FUTURE_CLOCK_SKEW_MS
    && savedAt >= now - ACTIVE_SESSION_CHECKPOINT_TTL_MS;
}

function checkpointStatusRank(status: ActiveSessionCheckpointV1["status"]) {
  return status === "awaiting_finish" ? 1 : 0;
}

function methodWorkProgressRank(progress: MethodWorkProgress | undefined) {
  return progress ? progress.checkedTopics.length + (progress.sourceReviewed ? 1 : 0) : 0;
}

function checkpointsBySession(
  values: readonly ActiveSessionCheckpointV1[],
  now: number,
) {
  const checkpoints = new Map<string, ActiveSessionCheckpointV1>();
  for (const value of values) {
    const checkpoint = readActiveSessionCheckpoint(value, now);
    if (!checkpoint) continue;
    const current = checkpoints.get(checkpoint.planSessionId);
    if (!current || preferCheckpointWithinSource(checkpoint, current)) {
      checkpoints.set(checkpoint.planSessionId, checkpoint);
    }
  }
  return checkpoints;
}

function preferCheckpointWithinSource(
  candidate: ActiveSessionCheckpointV1,
  current: ActiveSessionCheckpointV1,
) {
  if (
    candidate.runId === current.runId
    && candidate.resourceFingerprint === current.resourceFingerprint
    && candidate.resourceGeneratedAt === current.resourceGeneratedAt
  ) {
    return compareActiveSessionCheckpointProgress(candidate, current) > 0;
  }
  return compareIsoTimestamps(candidate.savedAt, current.savedAt) > 0;
}

const FORBIDDEN_CHECKPOINT_KEYS = new Set([
  "answer",
  "answerdraft",
  "answertext",
  "currentanswer",
  "draftanswer",
  "evaluation",
  "evaluationprose",
  "freeresponse",
  "freeresponseanswer",
  "generatedrepair",
  "generatedrepairprose",
  "learneranswer",
  "rawanswer",
  "response",
  "responsetext",
  "selectedanswer",
  "streamedtext",
  "tutormessage",
  "tutorresponse",
  "tutortext",
  "useranswer",
  "userresponse",
]);

function hasForbiddenCheckpointContent(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const pending = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, entry] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_CHECKPOINT_KEYS.has(normalizedKey)) return true;
      if (entry && typeof entry === "object") pending.push(entry);
    }
  }
  return false;
}

function compareIsoTimestamps(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

function writeStoredCheckpoints(
  storage: Storage,
  checkpoints: readonly ActiveSessionCheckpointV1[],
) {
  try {
    if (checkpoints.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return true;
    }
    const entries = [...checkpoints];
    while (entries.length > 0) {
      const serialized = JSON.stringify(entries);
      if (serialized.length <= MAX_STORAGE_CHARACTERS) {
        storage.setItem(STORAGE_KEY, serialized);
        return true;
      }
      entries.shift();
    }
    return false;
  } catch {
    return false;
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprintCheckpointIdentity(value: unknown) {
  const serialized = stableSerialize(value);
  return `sr1:${hash32(serialized, 0x811c9dc5)}${hash32(serialized, 0x9e3779b9)}`;
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

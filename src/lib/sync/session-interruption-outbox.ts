"use client";

import { z } from "zod";
import type { SessionInterruption } from "@/lib/domain";
import { ConceptEvidenceSchema } from "@/lib/learning/concept-evidence";
import { ConfidenceEvidenceSchema } from "@/lib/learning/confidence-calibration";
import {
  SessionActivityProgressSchema,
  stripRetiredSessionActivityProgressMarker,
} from "@/lib/learning/session-activity-progress";
import {
  SessionAdjustmentSnapshotSchema,
  SessionPendingRepairSchema,
} from "@/lib/learning/session-resume";
import { recordAuthenticatedSessionInterruption } from "@/lib/supabase/learning-state-repository";
import { isNonRetryableSessionTerminalMutationError } from "@/lib/sync/session-terminal-mutation-error";
import {
  clearQuarantinedSessionTerminals,
  quarantineSessionTerminal,
  readQuarantinedSessionTerminalPayloads,
  removeQuarantinedSessionTerminalsForPlan,
  type NonRetryableSessionTarget,
} from "@/lib/sync/session-terminal-quarantine";

const STORAGE_KEY = "yova.session-interruption-outbox.v1";
const MAX_INTERRUPTION_FLUSH_ATTEMPTS = 25;

type SessionInterruptionFlushResult = Readonly<{
  synced: number;
  remaining: number;
}>;

const activeSessionInterruptionFlushes = new Map<
  string,
  Promise<SessionInterruptionFlushResult>
>();

const RoutedConceptEvidenceListSchema = z.array(ConceptEvidenceSchema.extend({
  routeRevisionId: z.string().uuid().optional(),
})).max(24);

const RoutedConfidenceEvidenceListSchema = z.array(ConfidenceEvidenceSchema.extend({
  routeRevisionId: z.string().uuid().optional(),
})).max(24);

// Keep this terminal snapshot compatible with legacy evidence while retaining
// the route revision on newly routed evidence across the local-storage hop.
const RoutedSessionEvidenceSnapshotSchema = z.object({
  correctAnswers: z.number().int().min(0).max(24),
  totalAnswers: z.number().int().min(0).max(24),
  conceptEvidence: RoutedConceptEvidenceListSchema,
  confidenceEvidence: RoutedConfidenceEvidenceListSchema,
  observedGap: z.string().trim().min(1).max(1_000),
  completedImmediateRepairs: z.number().int().min(0).max(4),
}).refine((snapshot) => snapshot.correctAnswers <= snapshot.totalAnswers);

const StoredSessionInterruptionSchema = z.preprocess(
  stripRetiredSessionActivityProgressMarker,
  z.object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    planSessionId: z.string().uuid(),
    routeRevisionId: z.string().uuid().optional(),
    startedAt: z.string().datetime({ offset: true }),
    interruptedAt: z.string().datetime({ offset: true }),
    plannedMinutes: z.number().int().min(5).max(180),
    actualMinutes: z.number().int().min(1).max(360),
    completedSteps: z.number().int().min(0).max(24),
    totalSteps: z.number().int().min(1).max(24),
    resumeStep: z.number().int().min(0).max(24).optional(),
    evidence: RoutedSessionEvidenceSnapshotSchema.optional(),
    pendingRepair: SessionPendingRepairSchema.optional(),
    sessionAdjustment: SessionAdjustmentSnapshotSchema.optional(),
    activityProgress: SessionActivityProgressSchema.optional(),
  }),
);

const StoredPendingSessionInterruptionSchema = z.object({
  userId: z.string().uuid(),
  interruption: StoredSessionInterruptionSchema,
  queuedAt: z.string().datetime({ offset: true }),
});

const PendingSessionInterruptionSchema = StoredPendingSessionInterruptionSchema.superRefine(
  (entry, context) => {
    const { completedSteps, resumeStep, totalSteps } = entry.interruption;
    if (completedSteps >= totalSteps) {
      context.addIssue({
        code: "custom",
        path: ["interruption", "completedSteps"],
        message: "An interruption must leave at least one unfinished step.",
      });
    }
    if ((resumeStep ?? completedSteps) >= totalSteps) {
      context.addIssue({
        code: "custom",
        path: ["interruption", "resumeStep"],
        message: "An interruption must resume before the end of the session.",
      });
    }
  },
);

export type PendingSessionInterruption = {
  userId: string;
  interruption: SessionInterruption;
  queuedAt: string;
};

export type AuthoritativeSessionInterruptionReceipt = Readonly<{
  id: string;
  planSessionId: string;
}>;

export type SessionInterruptionReconciliationResult = Readonly<{
  removed: number;
  remaining: number;
  storageSaved: boolean;
}>;

export function queueSessionInterruption(input: PendingSessionInterruption) {
  const parsed = PendingSessionInterruptionSchema.safeParse(input);
  if (!parsed.success) return false;
  const current = loadAllPendingInterruptions();
  const pending = parsed.data;
  const withoutDuplicate = current.filter((entry) => entry.interruption.id !== pending.interruption.id);
  return savePendingInterruptions([...withoutDuplicate, pending].slice(-25));
}

export function removeQueuedSessionInterruption(interruptionId: string) {
  return savePendingInterruptions(
    loadAllPendingInterruptions().filter((entry) => entry.interruption.id !== interruptionId),
  );
}

export function clearQueuedSessionInterruptions(userId: string) {
  const activeSaved = savePendingInterruptions(
    loadAllPendingInterruptions().filter((entry) => entry.userId !== userId),
  );
  const quarantineSaved = clearQuarantinedSessionTerminals(userId, "interruption");
  return activeSaved && quarantineSaved;
}

export function removeQueuedSessionInterruptionsForPlan(userId: string, planId: string) {
  const activeSaved = savePendingInterruptions(loadAllPendingInterruptions().filter((entry) => !(
    entry.userId === userId && entry.interruption.planId === planId
  )));
  const quarantineSaved = removeQuarantinedSessionTerminalsForPlan(
    userId,
    "interruption",
    planId,
  );
  return activeSaved && quarantineSaved;
}

/** Returns only validated entries for the requested account. */
export function loadQueuedSessionInterruptions(userId: string) {
  return loadAllPendingInterruptions().filter((entry) => entry.userId === userId);
}

/** Fail-closed reader used by the portable current-device export. */
export function readQueuedSessionInterruptionsForExport(userId: string):
  | { ok: true; value: PendingSessionInterruption[] }
  | { ok: false } {
  if (typeof window === "undefined") return { ok: false };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed) || parsed.length > 25) return { ok: false };
    const quarantined = readQuarantinedSessionTerminalPayloads(userId, "interruption");
    const validated = [...parsed, ...quarantined]
      .map((entry) => StoredPendingSessionInterruptionSchema.safeParse(entry));
    if (validated.some((entry) => !entry.success)) return { ok: false };
    const active = parsed.flatMap((entry) => {
      const validatedEntry = StoredPendingSessionInterruptionSchema.safeParse(entry);
      return validatedEntry.success ? [validatedEntry.data] : [];
    });
    if (JSON.stringify(active) !== JSON.stringify(parsed)) {
      savePendingInterruptions(active);
    }
    const byId = new Map<string, PendingSessionInterruption>();
    validated.forEach((entry) => {
      if (entry.success && entry.data.userId === userId) {
        byId.set(entry.data.interruption.id, entry.data);
      }
    });
    if (byId.size > 25) return { ok: false };
    return {
      ok: true,
      value: [...byId.values()].sort((left, right) => left.queuedAt.localeCompare(right.queuedAt)),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * A queued explicit Exit is a durable local terminal marker. It must win over
 * an older cloud checkpoint so reconnecting cannot reopen already-exited work.
 */
export function pendingSessionInterruptionRunIds(userId: string) {
  return loadAllPendingInterruptions()
    .filter((entry) => entry.userId === userId)
    .map((entry) => entry.interruption.id);
}

export function pendingSessionInterruptionPlanSessionIds(userId: string) {
  return loadAllPendingInterruptions()
    .filter((entry) => entry.userId === userId)
    .map((entry) => entry.interruption.planSessionId);
}

/**
 * Clears retries proven durable by cloud state. A later cloud completion also
 * supersedes an older queued Exit for the same plan session, while unrelated
 * accounts and retryable terminal events remain untouched.
 */
export function reconcileQueuedSessionInterruptions(
  userId: string,
  authoritativeInterruptions: readonly AuthoritativeSessionInterruptionReceipt[],
  completedPlanSessionIds: readonly string[],
  nonRetryableTargets: readonly NonRetryableSessionTarget[] = [],
): SessionInterruptionReconciliationResult {
  const authoritativeIds = new Set(
    authoritativeInterruptions.map((interruption) => interruption.id),
  );
  const completedIds = new Set(completedPlanSessionIds);
  const eventDispositions = new Map(
    nonRetryableTargets.flatMap((target) => (
      target.eventId ? [[target.eventId, target.reason] as const] : []
    )),
  );
  const sessionDispositions = new Map(
    nonRetryableTargets.flatMap((target) => (
      target.eventId ? [] : [[target.planSessionId, target.reason] as const]
    )),
  );
  const current = loadAllPendingInterruptions();
  const before = current.filter((entry) => entry.userId === userId).length;
  let quarantineFailed = false;
  const retained = current.filter((entry) => {
    if (entry.userId !== userId) return true;
    if (authoritativeIds.has(entry.interruption.id)) return false;

    const reason = eventDispositions.get(entry.interruption.id)
      ?? sessionDispositions.get(entry.interruption.planSessionId)
      ?? (completedIds.has(entry.interruption.planSessionId)
        ? "authoritative_completion"
        : null);
    if (!reason) return true;

    const quarantined = quarantineSessionTerminal({
      userId,
      kind: "interruption",
      eventId: entry.interruption.id,
      planId: entry.interruption.planId,
      planSessionId: entry.interruption.planSessionId,
      reason,
      payload: entry,
    });
    if (!quarantined) quarantineFailed = true;
    return !quarantined;
  });
  const activeSaved = retained.length === current.length
    ? true
    : savePendingInterruptions(retained);
  const remaining = loadAllPendingInterruptions().filter((entry) => entry.userId === userId).length;

  return {
    removed: Math.max(0, before - remaining),
    remaining,
    storageSaved: activeSaved && !quarantineFailed,
  };
}

export function flushQueuedSessionInterruptions(userId: string) {
  const active = activeSessionInterruptionFlushes.get(userId);
  if (active) return active;

  const flush = runQueuedSessionInterruptionFlush(userId).finally(() => {
    if (activeSessionInterruptionFlushes.get(userId) === flush) {
      activeSessionInterruptionFlushes.delete(userId);
    }
  });
  activeSessionInterruptionFlushes.set(userId, flush);
  return flush;
}

async function runQueuedSessionInterruptionFlush(
  userId: string,
): Promise<SessionInterruptionFlushResult> {
  const attemptedIds = new Set<string>();
  const blockedPlanSessionIds = new Set<string>();
  let synced = 0;

  while (attemptedIds.size < MAX_INTERRUPTION_FLUSH_ATTEMPTS) {
    const queued = loadAllPendingInterruptions().filter((entry) => (
      entry.userId === userId
      && !attemptedIds.has(entry.interruption.id)
    ));
    if (queued.length === 0) break;

    for (const entry of queued) {
      if (attemptedIds.size >= MAX_INTERRUPTION_FLUSH_ATTEMPTS) break;
      attemptedIds.add(entry.interruption.id);
      const planSessionId = entry.interruption.planSessionId;
      if (blockedPlanSessionIds.has(planSessionId)) continue;
      try {
        await recordAuthenticatedSessionInterruption(entry.userId, entry.interruption);
        if (removeQueuedSessionInterruption(entry.interruption.id)) {
          synced += 1;
        } else {
          // The event is durable remotely but still active locally. Avoid a
          // duplicate send for this session until a later reconciliation.
          blockedPlanSessionIds.add(planSessionId);
        }
      } catch (error) {
        if (
          isNonRetryableSessionTerminalMutationError(error)
          && quarantinePermanentlyRejectedInterruption(entry)
        ) {
          continue;
        }
        blockedPlanSessionIds.add(planSessionId);
      }
    }
  }

  return {
    synced,
    remaining: loadAllPendingInterruptions().filter((entry) => entry.userId === userId).length,
  };
}

function quarantinePermanentlyRejectedInterruption(
  entry: PendingSessionInterruption,
) {
  const quarantined = quarantineSessionTerminal({
    userId: entry.userId,
    kind: "interruption",
    eventId: entry.interruption.id,
    planId: entry.interruption.planId,
    planSessionId: entry.interruption.planSessionId,
    reason: "permanent_server_rejection",
    payload: entry,
  });
  return quarantined && removeQueuedSessionInterruption(entry.interruption.id);
}

function loadAllPendingInterruptions(): PendingSessionInterruption[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const storedEntries = parsed.slice(-25).flatMap((entry) => {
      const validated = StoredPendingSessionInterruptionSchema.safeParse(entry);
      if (!validated.success) return [];
      return [validated.data];
    });

    const active = storedEntries.filter((entry) => {
      if (!hasLegacyInvalidProgress(entry)) return true;
      return !quarantineSessionTerminal({
        userId: entry.userId,
        kind: "interruption",
        eventId: entry.interruption.id,
        planId: entry.interruption.planId,
        planSessionId: entry.interruption.planSessionId,
        reason: "legacy_invalid_progress",
        payload: entry,
      });
    });
    if (JSON.stringify(active) !== JSON.stringify(parsed.slice(-25))) {
      if (!savePendingInterruptions(active)) {
        // Storage still contains the original entries; retain and count every
        // validated retry rather than reporting an unsaved cleanup as done.
        return storedEntries;
      }
    }
    return active;
  } catch {
    return [];
  }
}

function hasLegacyInvalidProgress(entry: PendingSessionInterruption) {
  const { completedSteps, resumeStep, totalSteps } = entry.interruption;
  return completedSteps >= totalSteps || (resumeStep ?? completedSteps) >= totalSteps;
}

function savePendingInterruptions(entries: PendingSessionInterruption[]) {
  if (typeof window === "undefined") return false;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

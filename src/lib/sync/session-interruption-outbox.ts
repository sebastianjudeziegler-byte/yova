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

const SessionInterruptionSchema = z.preprocess(
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

const PendingSessionInterruptionSchema = z.object({
  userId: z.string().uuid(),
  interruption: SessionInterruptionSchema,
  queuedAt: z.string().datetime({ offset: true }),
});

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
  savePendingInterruptions(loadAllPendingInterruptions().filter((entry) => entry.interruption.id !== interruptionId));
}

export function clearQueuedSessionInterruptions(userId: string) {
  return savePendingInterruptions(loadAllPendingInterruptions().filter((entry) => entry.userId !== userId));
}

export function removeQueuedSessionInterruptionsForPlan(userId: string, planId: string) {
  return savePendingInterruptions(loadAllPendingInterruptions().filter((entry) => !(
    entry.userId === userId && entry.interruption.planId === planId
  )));
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
    if (!stored) return { ok: true, value: [] };
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length > 25) return { ok: false };
    const validated = parsed.map((entry) => PendingSessionInterruptionSchema.safeParse(entry));
    if (validated.some((entry) => !entry.success)) return { ok: false };
    const sanitized = validated.flatMap((entry) => (entry.success ? [entry.data] : []));
    if (JSON.stringify(sanitized) !== JSON.stringify(parsed)) {
      savePendingInterruptions(sanitized);
    }
    return {
      ok: true,
      value: sanitized.filter((entry) => entry.userId === userId),
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

/**
 * Clears retries proven durable by cloud state. A later cloud completion also
 * supersedes an older queued Exit for the same plan session, while unrelated
 * accounts and retryable terminal events remain untouched.
 */
export function reconcileQueuedSessionInterruptions(
  userId: string,
  authoritativeInterruptions: readonly AuthoritativeSessionInterruptionReceipt[],
  completedPlanSessionIds: readonly string[],
): SessionInterruptionReconciliationResult {
  const authoritativeIds = new Set(
    authoritativeInterruptions.map((interruption) => interruption.id),
  );
  const completedIds = new Set(completedPlanSessionIds);
  const current = loadAllPendingInterruptions();
  const before = current.filter((entry) => entry.userId === userId).length;
  const retained = current.filter((entry) => (
    entry.userId !== userId
    || (
      !authoritativeIds.has(entry.interruption.id)
      && !completedIds.has(entry.interruption.planSessionId)
    )
  ));
  const storageSaved = retained.length === current.length
    ? true
    : savePendingInterruptions(retained);
  const remaining = loadAllPendingInterruptions().filter((entry) => entry.userId === userId).length;

  return {
    removed: Math.max(0, before - remaining),
    remaining,
    storageSaved,
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
  let synced = 0;
  let failed = false;

  while (!failed && attemptedIds.size < MAX_INTERRUPTION_FLUSH_ATTEMPTS) {
    const queued = loadAllPendingInterruptions().filter((entry) => (
      entry.userId === userId
      && !attemptedIds.has(entry.interruption.id)
    ));
    if (queued.length === 0) break;

    for (const entry of queued) {
      if (attemptedIds.size >= MAX_INTERRUPTION_FLUSH_ATTEMPTS) break;
      attemptedIds.add(entry.interruption.id);
      try {
        await recordAuthenticatedSessionInterruption(entry.userId, entry.interruption);
        removeQueuedSessionInterruption(entry.interruption.id);
        synced += 1;
      } catch {
        failed = true;
        break;
      }
    }
  }

  return {
    synced,
    remaining: loadAllPendingInterruptions().filter((entry) => entry.userId === userId).length,
  };
}

function loadAllPendingInterruptions(): PendingSessionInterruption[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const supported = parsed.slice(-25).flatMap((entry) => {
      const validated = PendingSessionInterruptionSchema.safeParse(entry);
      if (!validated.success) return [];
      return [validated.data];
    });
    if (JSON.stringify(supported) !== JSON.stringify(parsed.slice(-25))) {
      savePendingInterruptions(supported);
    }
    return supported;
  } catch {
    return [];
  }
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

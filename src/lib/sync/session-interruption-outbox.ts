"use client";

import { z } from "zod";
import type { SessionInterruption } from "@/lib/domain";
import { ConceptEvidenceSchema } from "@/lib/learning/concept-evidence";
import { ConfidenceEvidenceSchema } from "@/lib/learning/confidence-calibration";
import {
  isBroadRecallActivityProgress,
  SessionActivityProgressSchema,
  sessionActivityProgressHasRequiredRouteIdentity,
} from "@/lib/learning/session-activity-progress";
import {
  SessionAdjustmentSnapshotSchema,
  SessionPendingRepairSchema,
} from "@/lib/learning/session-resume";
import { recordAuthenticatedSessionInterruption } from "@/lib/supabase/learning-state-repository";

const STORAGE_KEY = "yova.session-interruption-outbox.v1";

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

const SessionInterruptionSchema = z.object({
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
}).superRefine((interruption, context) => {
  if (!sessionActivityProgressHasRequiredRouteIdentity(
    interruption.activityProgress,
    interruption.routeRevisionId,
  )) {
    context.addIssue({
      code: "custom",
      path: ["routeRevisionId"],
      message: "Broad-recall interruption progress requires an exact route revision.",
    });
  }
});

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

export function queueSessionInterruption(input: PendingSessionInterruption) {
  const parsed = PendingSessionInterruptionSchema.safeParse(input);
  if (!parsed.success) return false;
  const current = loadAllPendingInterruptions();
  // The deployed interruption writer deliberately rejects broad-recall
  // progress until it can verify the exact generated resource. Do not add an
  // entry that can never sync and would block every later terminal behind it.
  if (isBroadRecallActivityProgress(parsed.data.interruption.activityProgress)) return false;
  const withoutDuplicate = current.filter((entry) => entry.interruption.id !== parsed.data.interruption.id);
  return savePendingInterruptions([...withoutDuplicate, parsed.data].slice(-25));
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
    const supported = validated.flatMap((entry) => (
      entry.success && !isBroadRecallActivityProgress(entry.data.interruption.activityProgress)
        ? [entry.data]
        : []
    ));
    if (supported.length !== validated.length) savePendingInterruptions(supported);
    return {
      ok: true,
      value: supported.filter((entry) => entry.userId === userId),
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

export async function flushQueuedSessionInterruptions(userId: string) {
  const queued = loadAllPendingInterruptions().filter((entry) => entry.userId === userId);
  let synced = 0;

  for (const entry of queued) {
    try {
      await recordAuthenticatedSessionInterruption(entry.interruption);
      removeQueuedSessionInterruption(entry.interruption.id);
      synced += 1;
    } catch {
      break;
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
    let removedUnsupportedBroadRecall = false;
    const supported = parsed.slice(-25).flatMap((entry) => {
      const validated = PendingSessionInterruptionSchema.safeParse(entry);
      if (!validated.success) return [];
      if (isBroadRecallActivityProgress(validated.data.interruption.activityProgress)) {
        removedUnsupportedBroadRecall = true;
        return [];
      }
      return [validated.data];
    });
    // Older clients could enqueue broad-recall interruptions even though the
    // mature SQL boundary has always rejected them. Migrate those poison-pill
    // entries away on read so one stale exit cannot permanently block newer
    // supported exits on this device.
    if (removedUnsupportedBroadRecall) savePendingInterruptions(supported);
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

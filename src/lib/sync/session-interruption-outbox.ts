"use client";

import { z } from "zod";
import type { SessionInterruption } from "@/lib/domain";
import { SessionActivityProgressSchema } from "@/lib/learning/session-activity-progress";
import {
  SessionAdjustmentSnapshotSchema,
  SessionEvidenceSnapshotSchema,
  SessionPendingRepairSchema,
} from "@/lib/learning/session-resume";
import { recordAuthenticatedSessionInterruption } from "@/lib/supabase/learning-state-repository";

const STORAGE_KEY = "yova.session-interruption-outbox.v1";

const SessionInterruptionSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  interruptedAt: z.string().datetime({ offset: true }),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(1).max(360),
  completedSteps: z.number().int().min(0).max(24),
  totalSteps: z.number().int().min(1).max(24),
  resumeStep: z.number().int().min(0).max(24).optional(),
  evidence: SessionEvidenceSnapshotSchema.optional(),
  pendingRepair: SessionPendingRepairSchema.optional(),
  sessionAdjustment: SessionAdjustmentSnapshotSchema.optional(),
  activityProgress: SessionActivityProgressSchema.optional(),
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
    return {
      ok: true,
      value: validated.flatMap((entry) => entry.success && entry.data.userId === userId ? [entry.data] : []),
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
    return parsed.slice(-25).flatMap((entry) => {
      const validated = PendingSessionInterruptionSchema.safeParse(entry);
      return validated.success ? [validated.data] : [];
    });
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

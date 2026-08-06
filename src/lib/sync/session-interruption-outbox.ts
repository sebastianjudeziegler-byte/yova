"use client";

import { z } from "zod";
import type { SessionInterruption } from "@/lib/domain";
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
  savePendingInterruptions(loadAllPendingInterruptions().filter((entry) => entry.userId !== userId));
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

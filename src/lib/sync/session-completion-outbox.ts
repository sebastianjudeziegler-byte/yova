"use client";

import { z } from "zod";
import type { NextSessionAdaptation, SessionCompletion } from "@/lib/domain";
import { ConceptEvidenceListSchema } from "@/lib/learning/concept-evidence";
import { completeAuthenticatedPlanSession } from "@/lib/supabase/learning-state-repository";

const STORAGE_KEY = "yova.cloud-sync-outbox.v1";

const SessionCompletionSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(1).max(360),
  correctAnswers: z.number().int().min(0),
  totalAnswers: z.number().int().min(0),
  feedback: z.enum(["too_easy", "about_right", "too_difficult"]),
  observedGap: z.string().min(1).max(2_000),
  conceptEvidence: ConceptEvidenceListSchema.default([]),
});

const NextSessionAdaptationSchema = z.object({
  planSessionId: z.string().uuid(),
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(900),
  method: z.string().min(1).max(180),
  methodReason: z.string().min(1).max(900),
  estimatedMinutes: z.number().int().min(5).max(180),
  amountLabel: z.string().min(1).max(180),
  explanation: z.string().min(1).max(900),
});

const PendingSessionCompletionSchema = z.object({
  userId: z.string().uuid(),
  completion: SessionCompletionSchema,
  adaptation: NextSessionAdaptationSchema.nullable(),
  queuedAt: z.string().datetime({ offset: true }),
});

export type PendingSessionCompletion = {
  userId: string;
  completion: SessionCompletion;
  adaptation: NextSessionAdaptation | null;
  queuedAt: string;
};

export function queueSessionCompletion(input: PendingSessionCompletion) {
  const parsed = PendingSessionCompletionSchema.safeParse(input);
  if (!parsed.success) return false;
  const current = loadAllPendingCompletions();
  const withoutDuplicate = current.filter((entry) => entry.completion.id !== parsed.data.completion.id);
  return savePendingCompletions([...withoutDuplicate, parsed.data].slice(-25));
}

export function removeQueuedSessionCompletion(completionId: string) {
  savePendingCompletions(loadAllPendingCompletions().filter((entry) => entry.completion.id !== completionId));
}

export function clearQueuedSessionCompletions(userId: string) {
  savePendingCompletions(loadAllPendingCompletions().filter((entry) => entry.userId !== userId));
}

export function pendingSessionCompletionCount(userId: string) {
  return loadAllPendingCompletions().filter((entry) => entry.userId === userId).length;
}

export async function flushQueuedSessionCompletions(userId: string) {
  const queued = loadAllPendingCompletions().filter((entry) => entry.userId === userId);
  let synced = 0;

  for (const entry of queued) {
    try {
      await completeAuthenticatedPlanSession(entry.completion, entry.adaptation);
      removeQueuedSessionCompletion(entry.completion.id);
      synced += 1;
    } catch {
      break;
    }
  }

  return {
    synced,
    remaining: pendingSessionCompletionCount(userId),
  };
}

function loadAllPendingCompletions(): PendingSessionCompletion[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-25).flatMap((entry) => {
      const validated = PendingSessionCompletionSchema.safeParse(entry);
      return validated.success ? [validated.data] : [];
    });
  } catch {
    return [];
  }
}

function savePendingCompletions(entries: PendingSessionCompletion[]) {
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

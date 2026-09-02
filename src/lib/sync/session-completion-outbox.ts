"use client";

import { z } from "zod";
import type { LearningPlanSession, NextSessionAdaptation, SessionCompletion } from "@/lib/domain";
import { ConceptEvidenceSchema } from "@/lib/learning/concept-evidence";
import { ConfidenceEvidenceSchema } from "@/lib/learning/confidence-calibration";
import { normalizeSessionCompletionProvenance } from "@/lib/learning/session-completion-provenance";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { completeAuthenticatedPlanSession } from "@/lib/supabase/learning-state-repository";
import { isNonRetryableSessionTerminalMutationError } from "@/lib/sync/session-terminal-mutation-error";
import {
  clearQuarantinedSessionTerminals,
  quarantineSessionTerminal,
  readQuarantinedSessionTerminalPayloads,
  removeQuarantinedSessionTerminalsForPlan,
  type NonRetryableSessionTarget,
} from "@/lib/sync/session-terminal-quarantine";

export type { NonRetryableSessionTarget } from "@/lib/sync/session-terminal-quarantine";

const STORAGE_KEY = "yova.cloud-sync-outbox.v1";

// The shared evidence readers still accept pre-route records. The terminal
// outbox adds the optional route identity explicitly so browser persistence
// cannot strip it before the outcome reaches the repository.
const RoutedConceptEvidenceListSchema = z.array(ConceptEvidenceSchema.extend({
  routeRevisionId: z.string().uuid().optional(),
})).max(24);

const RoutedConfidenceEvidenceListSchema = z.array(ConfidenceEvidenceSchema.extend({
  routeRevisionId: z.string().uuid().optional(),
})).max(24);

const SessionCompletionSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  routeRevisionId: z.string().uuid().optional(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(1).max(360),
  correctAnswers: z.number().int().min(0),
  totalAnswers: z.number().int().min(0),
  feedback: z.enum(["too_easy", "about_right", "too_difficult"]),
  observedGap: z.string().min(1).max(2_000),
  completionMode: z.enum(["guided", "unguided_practice"]).default("guided"),
  conceptEvidence: RoutedConceptEvidenceListSchema.default([]),
  confidenceEvidence: RoutedConfidenceEvidenceListSchema.default([]),
}).transform(normalizeSessionCompletionProvenance);

const NextSessionAdaptationSchema = z.object({
  planSessionId: z.string().uuid(),
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(900),
  method: z.string().min(1).max(180),
  methodReason: z.string().min(1).max(900),
  estimatedMinutes: z.number().int().min(5).max(180),
  amountLabel: z.string().min(1).max(180),
  learningMode: z.enum(["learn", "study"]).default("study"),
  explanation: z.string().min(1).max(900),
});

const FollowUpSessionSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  title: z.string().min(1).max(180),
  objective: z.string().min(1).max(900),
  method: z.string().min(1).max(180),
  methodReason: z.string().min(1).max(900),
  scheduledFor: z.string().datetime({ offset: true }),
  estimatedMinutes: z.number().int().min(5).max(180),
  amountLabel: z.string().min(1).max(180),
  learningMode: z.enum(["learn", "study"]),
  topicIds: z.array(z.string().uuid()).max(6).default([]),
  contentTargets: z.array(z.string().min(1).max(180)).max(6).default([]),
  completionEvidence: z.array(z.string().min(1).max(220)).max(4).default([]),
  reviewConcept: z.string().min(2).max(120).optional(),
  reviewType: z.enum(["repair_and_retrieve", "verify", "maintenance_transfer"]).optional(),
  status: z.enum(["ready", "upcoming"]),
  adaptationNote: z.object({
    explanation: z.string().min(1).max(900),
    adaptedAt: z.string().datetime({ offset: true }),
  }).optional(),
  studyRoute: StudyRouteSchema.optional(),
});

const PendingSessionCompletionSchema = z.object({
  userId: z.string().uuid(),
  completion: SessionCompletionSchema,
  adaptation: NextSessionAdaptationSchema.nullable(),
  followUpSession: FollowUpSessionSchema.nullable().default(null),
  continuationSession: FollowUpSessionSchema.nullable().default(null),
  nextSessionStudyRoute: StudyRouteSchema.nullable().default(null),
  queuedAt: z.string().datetime({ offset: true }),
}).superRefine((entry, context) => {
  const routed = entry.completion.routeRevisionId !== undefined;
  const routeChildren = [
    ["followUpSession", entry.followUpSession] as const,
    ["continuationSession", entry.continuationSession] as const,
  ];

  if (
    (routed && Boolean(entry.adaptation) !== Boolean(entry.nextSessionStudyRoute))
    || (!routed && entry.nextSessionStudyRoute !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["nextSessionStudyRoute"],
      message: "A queued adaptation and its successor StudyRoute must be preserved together.",
    });
  }
  if (entry.nextSessionStudyRoute) {
    const identity = entry.nextSessionStudyRoute.identity;
    if (
      !routed
      || identity.lifecycleStatus !== "committed"
      || identity.planId !== entry.completion.planId
      || identity.sessionId !== entry.adaptation?.planSessionId
      || identity.revisionNumber <= 1
      || !identity.supersedesRevisionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextSessionStudyRoute"],
        message: "A queued next-session route must be a committed successor for this routed plan.",
      });
    }
  }
  for (const [field, session] of routeChildren) {
    if (!session) continue;
    const route = session.studyRoute;
    if (routed !== Boolean(route)) {
      context.addIssue({
        code: "custom",
        path: [field, "studyRoute"],
        message: "A routed completion must preserve each new session route, while a legacy completion must stay route-free.",
      });
      continue;
    }
    if (route && (
      route.identity.lifecycleStatus !== "committed"
      || route.identity.planId !== entry.completion.planId
      || route.identity.sessionId !== session.id
      || route.identity.revisionNumber !== 1
      || route.identity.supersedesRevisionId
    )) {
      context.addIssue({
        code: "custom",
        path: [field, "studyRoute"],
        message: "A queued new session must start its own committed StudyRoute lineage.",
      });
    }
  }
});

export type PendingSessionCompletion = {
  userId: string;
  completion: SessionCompletion;
  adaptation: NextSessionAdaptation | null;
  followUpSession: LearningPlanSession | null;
  continuationSession?: LearningPlanSession | null;
  nextSessionStudyRoute?: StudyRoute | null;
  queuedAt: string;
};

export type AuthoritativeSessionCompletionReceipt = Readonly<{
  id: string;
  planSessionId: string;
}>;

export type SessionCompletionReconciliationResult = Readonly<{
  removed: number;
  remaining: number;
  storageSaved: boolean;
}>;

export function queueSessionCompletion(input: PendingSessionCompletion) {
  const parsed = PendingSessionCompletionSchema.safeParse(input);
  if (!parsed.success) return false;
  const current = loadAllPendingCompletions();
  const withoutDuplicate = current.filter((entry) => entry.completion.id !== parsed.data.completion.id);
  return savePendingCompletions([...withoutDuplicate, parsed.data].slice(-25));
}

export function removeQueuedSessionCompletion(completionId: string) {
  return savePendingCompletions(
    loadAllPendingCompletions().filter((entry) => entry.completion.id !== completionId),
  );
}

export function clearQueuedSessionCompletions(userId: string) {
  const activeSaved = savePendingCompletions(
    loadAllPendingCompletions().filter((entry) => entry.userId !== userId),
  );
  const quarantineSaved = clearQuarantinedSessionTerminals(userId, "completion");
  return activeSaved && quarantineSaved;
}

export function removeQueuedSessionCompletionsForPlan(userId: string, planId: string) {
  const activeSaved = savePendingCompletions(loadAllPendingCompletions().filter((entry) => !(
    entry.userId === userId && entry.completion.planId === planId
  )));
  const quarantineSaved = removeQuarantinedSessionTerminalsForPlan(
    userId,
    "completion",
    planId,
  );
  return activeSaved && quarantineSaved;
}

export function pendingSessionCompletionCount(userId: string) {
  return loadAllPendingCompletions().filter((entry) => entry.userId === userId).length;
}

/**
 * Clears retries whose authoritative cloud receipt proves the completion was
 * already committed. A completed plan session is terminal even when the
 * browser lost the response carrying the original completion id.
 */
export function reconcileQueuedSessionCompletions(
  userId: string,
  authoritativeCompletions: readonly AuthoritativeSessionCompletionReceipt[],
  nonRetryableTargets: readonly NonRetryableSessionTarget[] = [],
): SessionCompletionReconciliationResult {
  const authoritativeIds = new Set(authoritativeCompletions.map((completion) => completion.id));
  const completedPlanSessionIds = new Set(
    authoritativeCompletions.map((completion) => completion.planSessionId),
  );
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
  const current = loadAllPendingCompletions();
  const before = current.filter((entry) => entry.userId === userId).length;
  let quarantineFailed = false;
  const retained = current.filter((entry) => {
    if (entry.userId !== userId) return true;
    if (authoritativeIds.has(entry.completion.id)) return false;

    const reason = eventDispositions.get(entry.completion.id)
      ?? sessionDispositions.get(entry.completion.planSessionId)
      ?? (completedPlanSessionIds.has(entry.completion.planSessionId)
        ? "authoritative_completion"
        : null);
    if (!reason) return true;

    const quarantined = quarantineSessionTerminal({
      userId,
      kind: "completion",
      eventId: entry.completion.id,
      planId: entry.completion.planId,
      planSessionId: entry.completion.planSessionId,
      reason,
      payload: entry,
    });
    if (!quarantined) quarantineFailed = true;
    return !quarantined;
  });
  const activeSaved = retained.length === current.length
    ? true
    : savePendingCompletions(retained);
  const remaining = loadAllPendingCompletions().filter((entry) => entry.userId === userId).length;

  return {
    removed: Math.max(0, before - remaining),
    remaining,
    storageSaved: activeSaved && !quarantineFailed,
  };
}

/** Returns only validated entries for the requested account. */
export function loadQueuedSessionCompletions(userId: string) {
  return loadAllPendingCompletions().filter((entry) => entry.userId === userId);
}

/** Fail-closed reader used by the portable current-device export. */
export function readQueuedSessionCompletionsForExport(userId: string):
  | { ok: true; value: PendingSessionCompletion[] }
  | { ok: false } {
  if (typeof window === "undefined") return { ok: false };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed) || parsed.length > 25) return { ok: false };
    const quarantined = readQuarantinedSessionTerminalPayloads(userId, "completion");
    const validated = [...parsed, ...quarantined]
      .map((entry) => PendingSessionCompletionSchema.safeParse(entry));
    if (validated.some((entry) => !entry.success)) return { ok: false };
    const byId = new Map<string, PendingSessionCompletion>();
    validated.forEach((entry) => {
      if (entry.success && entry.data.userId === userId) {
        byId.set(entry.data.completion.id, entry.data);
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
 * A queued completion is a durable local terminal marker. Startup uses these
 * session ids to suppress an older cloud recovery point until the completion
 * reaches the server.
 */
export function pendingSessionCompletionPlanSessionIds(userId: string) {
  return loadAllPendingCompletions()
    .filter((entry) => entry.userId === userId)
    .map((entry) => entry.completion.planSessionId);
}

export async function flushQueuedSessionCompletions(
  userId: string,
  options: { blockedPlanSessionIds?: ReadonlySet<string> } = {},
) {
  const queued = loadAllPendingCompletions().filter((entry) => entry.userId === userId);
  const blockedPlanSessionIds = new Set(options.blockedPlanSessionIds ?? []);
  let synced = 0;

  for (const entry of queued) {
    const planSessionId = entry.completion.planSessionId;
    if (blockedPlanSessionIds.has(planSessionId)) continue;
    try {
      await completeAuthenticatedPlanSession(
        entry.completion,
        entry.adaptation,
        entry.followUpSession,
        entry.continuationSession ?? null,
        entry.nextSessionStudyRoute ?? null,
      );
      if (removeQueuedSessionCompletion(entry.completion.id)) {
        synced += 1;
      } else {
        // The server accepted the event, but the durable retry marker remains.
        // Do not send another completion for this session during this pass.
        blockedPlanSessionIds.add(planSessionId);
      }
    } catch (error) {
      if (
        isNonRetryableSessionTerminalMutationError(error)
        && quarantinePermanentlyRejectedCompletion(entry)
      ) {
        continue;
      }
      // Ordering is a per-session invariant. An incompatible completion may
      // block a duplicate for its own session, but never unrelated work.
      blockedPlanSessionIds.add(planSessionId);
    }
  }

  return {
    synced,
    remaining: pendingSessionCompletionCount(userId),
  };
}

export type SupersedingSessionCompletionFlushResult = Readonly<{
  committed: boolean;
  remaining: number;
}>;

/**
 * Attempts only the queued completion for one blocked Exit's exact session.
 *
 * The terminal coordinator uses this after that Exit has failed. A successful
 * completion is authoritative for the session, so every duplicate completion
 * marker for the same session can then be reconciled. A failed or absent
 * completion leaves the entire queue unchanged, and unrelated completions are
 * never allowed to jump the blocked terminal ordering boundary.
 */
export async function flushQueuedSessionCompletionSupersedingExit(
  userId: string,
  planSessionId: string,
): Promise<SupersedingSessionCompletionFlushResult> {
  const entry = loadAllPendingCompletions().find((candidate) => (
    candidate.userId === userId
    && candidate.completion.planSessionId === planSessionId
  ));
  if (!entry) {
    return {
      committed: false,
      remaining: pendingSessionCompletionCount(userId),
    };
  }

  try {
    await completeAuthenticatedPlanSession(
      entry.completion,
      entry.adaptation,
      entry.followUpSession,
      entry.continuationSession ?? null,
      entry.nextSessionStudyRoute ?? null,
    );
  } catch (error) {
    if (isNonRetryableSessionTerminalMutationError(error)) {
      quarantinePermanentlyRejectedCompletion(entry);
    }
    return {
      committed: false,
      remaining: pendingSessionCompletionCount(userId),
    };
  }

  const reconciliation = reconcileQueuedSessionCompletions(userId, [{
    id: entry.completion.id,
    planSessionId,
  }]);
  return {
    committed: true,
    remaining: reconciliation.remaining,
  };
}

function quarantinePermanentlyRejectedCompletion(
  entry: PendingSessionCompletion,
) {
  const quarantined = quarantineSessionTerminal({
    userId: entry.userId,
    kind: "completion",
    eventId: entry.completion.id,
    planId: entry.completion.planId,
    planSessionId: entry.completion.planSessionId,
    reason: "permanent_server_rejection",
    payload: entry,
  });
  return quarantined && removeQueuedSessionCompletion(entry.completion.id);
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

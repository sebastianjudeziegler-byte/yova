"use client";

import type { SessionStatus } from "@/lib/domain";
import {
  flushQueuedSessionCompletionSupersedingExit,
  flushQueuedSessionCompletions,
  loadQueuedSessionCompletions,
  reconcileQueuedSessionCompletions,
  sessionCompletionOutboxDisposition,
  type AuthoritativeSessionCompletionReceipt,
  type SessionCompletionFlushOutcome,
  type SessionCompletionReconciliationResult,
} from "@/lib/sync/session-completion-outbox";
import {
  flushQueuedSessionInterruptions,
  loadQueuedSessionInterruptions,
  pendingSessionInterruptionPlanSessionIds,
  reconcileQueuedSessionInterruptions,
  type AuthoritativeSessionInterruptionReceipt,
  type SessionInterruptionReconciliationResult,
} from "@/lib/sync/session-interruption-outbox";
import { isNonRetryableSessionTerminalMutationError } from "@/lib/sync/session-terminal-mutation-error";
import type { NonRetryableSessionTarget } from "@/lib/sync/session-terminal-quarantine";

const MAX_SUPERSEDED_EXIT_RECONCILIATIONS = 25;

export type SessionTerminalFlushResult = Readonly<{
  interruptions: Readonly<{ synced: number; remaining: number }>;
  completions: Readonly<{ synced: number; remaining: number }>;
  remaining: number;
  completionOutcomes: readonly SessionCompletionFlushOutcome[];
}>;
const activeSessionTerminalFlushes = new Map<string, Promise<SessionTerminalFlushResult>>();

/**
 * Explicit Exit keeps a plan session ready, while completion closes it. Flush
 * older exits first so an offline Exit -> resume -> completion sequence can be
 * replayed without leaving a permanent outbox entry.
 */
export function flushQueuedSessionTerminals(userId: string) {
  const active = activeSessionTerminalFlushes.get(userId);
  if (active) return active;

  const flush = runQueuedSessionTerminalFlush(userId).finally(() => {
    if (activeSessionTerminalFlushes.get(userId) === flush) {
      activeSessionTerminalFlushes.delete(userId);
    }
  });
  activeSessionTerminalFlushes.set(userId, flush);
  return flush;
}

async function runQueuedSessionTerminalFlush(
  userId: string,
): Promise<SessionTerminalFlushResult> {
  const completionOutcomes = new Map<string, SessionCompletionFlushOutcome>();
  const rememberCompletionOutcome = (outcome: SessionCompletionFlushOutcome) => {
    completionOutcomes.set(outcome.completionId, outcome);
  };
  let interruptionSynced = 0;
  let supersedingCompletionsSynced = 0;
  const interruptions = await flushQueuedSessionInterruptions(userId);
  interruptionSynced += interruptions.synced;
  const supersedingCompletionSessions = new Set<string>();

  // Ordering is scoped to one plan session. Once every Exit has had its turn,
  // a later completion may supersede only the Exit for its exact session. An
  // Exit that fails for session A must not prevent session B from syncing.
  const blockedSessionIds = [...new Set(
    loadQueuedSessionInterruptions(userId)
      .map((entry) => entry.interruption.planSessionId),
  )].slice(0, MAX_SUPERSEDED_EXIT_RECONCILIATIONS);
  for (const planSessionId of blockedSessionIds) {
    const completion = await flushQueuedSessionCompletionSupersedingExit(
      userId,
      planSessionId,
      { onOutcome: rememberCompletionOutcome },
    );
    if (!completion.committed) continue;
    supersedingCompletionsSynced += 1;
    supersedingCompletionSessions.add(planSessionId);

    const reconciliation = reconcileQueuedSessionInterruptions(
      userId,
      [],
      [planSessionId],
    );
    if (!reconciliation.storageSaved || reconciliation.removed === 0) {
      continue;
    }
  }

  const remainingInterruptions = loadQueuedSessionInterruptions(userId);
  const finalInterruptions = {
    synced: interruptionSynced,
    remaining: remainingInterruptions.length,
  };
  const completionBlocks = new Set([
    ...remainingInterruptions.map((entry) => entry.interruption.planSessionId),
    ...supersedingCompletionSessions,
  ]);
  const remainingCompletions = await flushQueuedSessionCompletions(userId, {
    blockedPlanSessionIds: completionBlocks,
    onOutcome: rememberCompletionOutcome,
  });
  const completions = {
    synced: supersedingCompletionsSynced + remainingCompletions.synced,
    remaining: remainingCompletions.remaining,
  };
  return {
    interruptions: finalInterruptions,
    completions,
    remaining: finalInterruptions.remaining + completions.remaining,
    completionOutcomes: [...completionOutcomes.values()],
  };
}

export type SessionCompletionSyncDisposition =
  | Readonly<{
      disposition: "committed";
      pendingEvents: number;
    }>
  | Readonly<{
      disposition: "queued";
      reason: "older_exit" | "retryable_failure";
      pendingEvents: number;
    }>
  | Readonly<{
      disposition: "rejected";
      pendingEvents: number;
    }>
  | Readonly<{
      disposition: "not_durable";
      reason: "older_exit" | "unconfirmed_absence";
      pendingEvents: number;
    }>;

export function sessionCompletionSyncIssue(
  result: Exclude<SessionCompletionSyncDisposition, { disposition: "committed" }>,
) {
  switch (result.disposition) {
    case "queued":
      return result.reason === "older_exit"
        ? "Your completed work is safely saved on this device. YOVA must finish syncing the earlier Exit before it can commit this completion. Choose Finish again to retry."
        : "Your completed work is safely saved on this device, but the cloud has not confirmed it yet. Choose Finish again to retry before clearing this browser's data.";
    case "rejected":
      return "The cloud could not safely accept this completion because the session or its saved study route no longer matches the cloud record. Your finish checkpoint remains on this device; reload YOVA before trying again.";
    case "not_durable":
      return result.reason === "older_exit"
        ? "YOVA could not safely save this completion while an earlier Exit is still waiting. Keep this page open and choose Finish again to retry."
        : "YOVA could not confirm that this completion reached the cloud. Your finish checkpoint remains on this device; keep this page open and choose Finish again to retry.";
  }
}

export type AuthoritativeSessionTerminalInventory = Readonly<{
  sessions: readonly Readonly<{
    id: string;
    status: SessionStatus;
    /** Undefined means an older caller did not provide route authority. */
    routeRevisionId?: string | null;
  }>[];
  completions: readonly AuthoritativeSessionCompletionReceipt[];
  interruptions: readonly AuthoritativeSessionInterruptionReceipt[];
}>;

export type SessionTerminalReconciliationResult = Readonly<{
  completions: SessionCompletionReconciliationResult;
  interruptions: SessionInterruptionReconciliationResult;
  remaining: number;
  storageSaved: boolean;
}>;

/**
 * Reconciles terminal retries only after a successful, complete cloud read.
 * Missing or terminal targets cannot accept another write, so their payloads
 * leave the active warning but remain in the account-scoped recovery export.
 */
export function reconcileQueuedSessionTerminalsAgainstAuthority(
  userId: string,
  authority: AuthoritativeSessionTerminalInventory,
): SessionTerminalReconciliationResult {
  const sessionsById = new Map(
    authority.sessions.map((session) => [session.id, session.status] as const),
  );
  const queuedPlanSessionIds = new Set([
    ...loadQueuedSessionCompletions(userId)
      .map((entry) => entry.completion.planSessionId),
    ...loadQueuedSessionInterruptions(userId)
      .map((entry) => entry.interruption.planSessionId),
  ]);
  const nonRetryableTargets: NonRetryableSessionTarget[] = [];
  queuedPlanSessionIds.forEach((planSessionId) => {
    const status = sessionsById.get(planSessionId);
    if (status === "ready" || status === "upcoming") return;
    nonRetryableTargets.push({
      planSessionId,
      reason: status === "complete"
        ? "target_complete"
        : status === "skipped"
          ? "target_skipped"
          : "target_absent",
    });
  });

  const routeMismatchTarget = (
    eventId: string,
    planSessionId: string,
    routeRevisionId: string | undefined,
  ): NonRetryableSessionTarget[] => {
    const session = authority.sessions.find((candidate) => candidate.id === planSessionId);
    if (
      !session
      || (session.routeRevisionId !== null && typeof session.routeRevisionId !== "string")
    ) {
      return [];
    }
    const queuedRouteRevisionId = routeRevisionId ?? null;
    return queuedRouteRevisionId === session.routeRevisionId
      ? []
      : [{
        eventId,
        planSessionId,
        reason: "authoritative_route_mismatch",
      }];
  };
  const completionTargets = [
    ...nonRetryableTargets,
    ...loadQueuedSessionCompletions(userId).flatMap((entry) => routeMismatchTarget(
      entry.completion.id,
      entry.completion.planSessionId,
      entry.completion.routeRevisionId,
    )),
  ];
  const interruptionTargets = [
    ...nonRetryableTargets,
    ...loadQueuedSessionInterruptions(userId).flatMap((entry) => routeMismatchTarget(
      entry.interruption.id,
      entry.interruption.planSessionId,
      entry.interruption.routeRevisionId,
    )),
  ];

  const completions = reconcileQueuedSessionCompletions(
    userId,
    authority.completions,
    completionTargets,
  );
  const interruptions = reconcileQueuedSessionInterruptions(
    userId,
    authority.interruptions,
    authority.completions.map((completion) => completion.planSessionId),
    interruptionTargets,
  );
  return {
    completions,
    interruptions,
    remaining: completions.remaining + interruptions.remaining,
    storageSaved: completions.storageSaved && interruptions.storageSaved,
  };
}

/**
 * A live completion must obey the same Exit-first ordering as startup retries.
 * If its outbox write succeeded, the normal flush owns the completion call. If
 * the outbox write failed, the direct fallback may run only after every older
 * interruption has reached the server.
 */
export async function syncSessionCompletionAfterTerminals({
  userId,
  planSessionId,
  completionId,
  completionQueued,
  completeImmediately,
}: {
  userId: string;
  planSessionId: string;
  completionId: string;
  completionQueued: boolean;
  completeImmediately: () => Promise<void>;
}): Promise<SessionCompletionSyncDisposition> {
  const terminalResult = await flushQueuedSessionTerminals(userId);
  const exactOutcome = terminalResult.completionOutcomes.find((outcome) => (
    outcome.completionId === completionId
  ));
  if (exactOutcome?.disposition === "committed") {
    return {
      disposition: "committed",
      pendingEvents: terminalResult.remaining,
    };
  }
  if (exactOutcome?.disposition === "rejected") {
    return {
      disposition: "rejected",
      pendingEvents: terminalResult.remaining,
    };
  }
  const olderExitPending = pendingSessionInterruptionPlanSessionIds(userId)
    .includes(planSessionId);

  if (completionQueued) {
    const outbox = sessionCompletionOutboxDisposition(userId, completionId);
    if (outbox.kind === "quarantined") {
      return {
        disposition: "rejected",
        pendingEvents: terminalResult.remaining,
      };
    }
    if (outbox.kind === "pending") {
      return {
        disposition: "queued",
        reason: olderExitPending ? "older_exit" : "retryable_failure",
        pendingEvents: terminalResult.remaining,
      };
    }
    return {
      disposition: "not_durable",
      reason: "unconfirmed_absence",
      pendingEvents: terminalResult.remaining,
    };
  }

  if (olderExitPending) {
    return {
      disposition: "not_durable",
      reason: "older_exit",
      pendingEvents: terminalResult.remaining,
    };
  }

  try {
    await completeImmediately();
  } catch (error) {
    if (isNonRetryableSessionTerminalMutationError(error)) {
      return {
        disposition: "rejected",
        pendingEvents: terminalResult.remaining,
      };
    }
    throw error;
  }
  return {
    disposition: "committed",
    pendingEvents: terminalResult.remaining,
  };
}

"use client";

import type { SessionStatus } from "@/lib/domain";
import {
  flushQueuedSessionCompletionSupersedingExit,
  flushQueuedSessionCompletions,
  loadQueuedSessionCompletions,
  pendingSessionCompletionPlanSessionIds,
  reconcileQueuedSessionCompletions,
  type AuthoritativeSessionCompletionReceipt,
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
import type { NonRetryableSessionTarget } from "@/lib/sync/session-terminal-quarantine";

const MAX_SUPERSEDED_EXIT_RECONCILIATIONS = 25;

/**
 * Explicit Exit keeps a plan session ready, while completion closes it. Flush
 * older exits first so an offline Exit -> resume -> completion sequence can be
 * replayed without leaving a permanent outbox entry.
 */
export async function flushQueuedSessionTerminals(userId: string) {
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
  });
  const completions = {
    synced: supersedingCompletionsSynced + remainingCompletions.synced,
    remaining: remainingCompletions.remaining,
  };
  return {
    interruptions: finalInterruptions,
    completions,
    remaining: finalInterruptions.remaining + completions.remaining,
  };
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
  completionQueued,
  completeImmediately,
}: {
  userId: string;
  planSessionId: string;
  completionQueued: boolean;
  completeImmediately: () => Promise<void>;
}) {
  const terminalResult = await flushQueuedSessionTerminals(userId);
  if (pendingSessionInterruptionPlanSessionIds(userId).includes(planSessionId)) {
    return { synced: false, terminalResult };
  }

  if (completionQueued) {
    return {
      synced: !pendingSessionCompletionPlanSessionIds(userId).includes(planSessionId),
      terminalResult,
    };
  }

  await completeImmediately();
  return { synced: true, terminalResult };
}

"use client";

import {
  flushQueuedSessionCompletionSupersedingExit,
  flushQueuedSessionCompletions,
  pendingSessionCompletionCount,
  pendingSessionCompletionPlanSessionIds,
} from "@/lib/sync/session-completion-outbox";
import {
  flushQueuedSessionInterruptions,
  loadQueuedSessionInterruptions,
  reconcileQueuedSessionInterruptions,
} from "@/lib/sync/session-interruption-outbox";

const MAX_SUPERSEDED_EXIT_RECONCILIATIONS = 25;

/**
 * Explicit Exit keeps a plan session ready, while completion closes it. Flush
 * older exits first so an offline Exit -> resume -> completion sequence can be
 * replayed without leaving a permanent outbox entry.
 */
export async function flushQueuedSessionTerminals(userId: string) {
  let interruptionSynced = 0;
  let supersedingCompletionsSynced = 0;
  let interruptions = await flushQueuedSessionInterruptions(userId);
  interruptionSynced += interruptions.synced;

  // A durable Exit can become a poison pill when the exact resumed session
  // was later completed on this device: Exit-first ordering blocks that newer
  // completion forever. Do not interpret an ambiguous server error as proof
  // of success. Instead, allow only the completion for the head Exit's exact
  // plan session to cross the boundary. Once accepted, that authoritative
  // terminal result safely supersedes every older Exit for the same session.
  for (
    let reconciliationCount = 0;
    interruptions.remaining > 0
      && reconciliationCount < MAX_SUPERSEDED_EXIT_RECONCILIATIONS;
    reconciliationCount += 1
  ) {
    const blockedExit = loadQueuedSessionInterruptions(userId)[0];
    if (!blockedExit) break;

    const completion = await flushQueuedSessionCompletionSupersedingExit(
      userId,
      blockedExit.interruption.planSessionId,
    );
    if (!completion.committed) break;
    supersedingCompletionsSynced += 1;

    const reconciliation = reconcileQueuedSessionInterruptions(
      userId,
      [],
      [blockedExit.interruption.planSessionId],
    );
    if (!reconciliation.storageSaved || reconciliation.removed === 0) {
      interruptions = {
        synced: interruptionSynced,
        remaining: reconciliation.remaining,
      };
      break;
    }

    interruptions = await flushQueuedSessionInterruptions(userId);
    interruptionSynced += interruptions.synced;
  }

  interruptions = {
    synced: interruptionSynced,
    remaining: loadQueuedSessionInterruptions(userId).length,
  };
  if (interruptions.remaining > 0) {
    const completions = {
      synced: supersedingCompletionsSynced,
      remaining: pendingSessionCompletionCount(userId),
    };
    return {
      interruptions,
      completions,
      remaining: interruptions.remaining + completions.remaining,
    };
  }
  const remainingCompletions = await flushQueuedSessionCompletions(userId);
  const completions = {
    synced: supersedingCompletionsSynced + remainingCompletions.synced,
    remaining: remainingCompletions.remaining,
  };
  return {
    interruptions,
    completions,
    remaining: interruptions.remaining + completions.remaining,
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
  if (terminalResult.interruptions.remaining > 0) {
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

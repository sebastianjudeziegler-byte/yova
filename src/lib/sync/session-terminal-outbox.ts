"use client";

import {
  flushQueuedSessionCompletions,
  pendingSessionCompletionCount,
  pendingSessionCompletionPlanSessionIds,
} from "@/lib/sync/session-completion-outbox";
import { flushQueuedSessionInterruptions } from "@/lib/sync/session-interruption-outbox";

/**
 * Explicit Exit keeps a plan session ready, while completion closes it. Flush
 * older exits first so an offline Exit -> resume -> completion sequence can be
 * replayed without leaving a permanent outbox entry.
 */
export async function flushQueuedSessionTerminals(userId: string) {
  const interruptions = await flushQueuedSessionInterruptions(userId);
  if (interruptions.remaining > 0) {
    const completions = {
      synced: 0,
      remaining: pendingSessionCompletionCount(userId),
    };
    return {
      interruptions,
      completions,
      remaining: interruptions.remaining + completions.remaining,
    };
  }
  const completions = await flushQueuedSessionCompletions(userId);
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

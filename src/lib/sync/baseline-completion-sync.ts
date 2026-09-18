"use client";

import type { SessionCompletion } from "@/lib/domain";
import { completeAuthenticatedPlanSession, readAuthenticatedSessionCompletionReceipt } from "@/lib/supabase/learning-state-repository";
import { finalizeCommittedSessionCompletion, loadQueuedSessionCompletions, queueSessionCompletion } from "@/lib/sync/session-completion-outbox";
import { sessionCompletionSyncIssue, syncSessionCompletionAfterTerminals } from "@/lib/sync/session-terminal-outbox";

type BaselineCompletionSyncResult = { completion: SessionCompletion; committed: boolean; issue: string | null };
const active = new Map<string, Promise<BaselineCompletionSyncResult>>();

/** A lost response is not a new attempt. Preserve the original payload until
 * an authenticated receipt resolves its outcome, including after a reload. */
export function syncBaselineCompletion(userId: string, draft: SessionCompletion): Promise<BaselineCompletionSyncResult> {
  const key = `${userId}:${draft.planSessionId}`;
  const inFlight = active.get(key);
  if (inFlight) return inFlight;
  const operation = sync(userId, draft).finally(() => {
    if (active.get(key) === operation) active.delete(key);
  });
  active.set(key, operation);
  return operation;
}

async function sync(userId: string, draft: SessionCompletion): Promise<BaselineCompletionSyncResult> {
  const pending = loadQueuedSessionCompletions(userId).find(entry => (
    entry.completion.planId === draft.planId && entry.completion.planSessionId === draft.planSessionId
  ));
  const completion = pending?.completion ?? draft;
  const queued = queueSessionCompletion(pending ?? {
    userId, completion, adaptation: null, followUpSession: null,
    continuationSession: null, nextSessionStudyRoute: null, queuedAt: completion.completedAt,
  });
  let issue: string;
  try {
    const result = await syncSessionCompletionAfterTerminals({
      userId, planSessionId: completion.planSessionId, completionId: completion.id,
      completionQueued: queued,
      completeImmediately: () => completeAuthenticatedPlanSession(completion, null, null, null, null, userId),
    });
    if (result.disposition === "committed") {
      finalizeCommittedSessionCompletion(userId, completion.id);
      return { completion, committed: true, issue: null };
    }
    issue = sessionCompletionSyncIssue(result);
  } catch {
    issue = queued
      ? "YOVA has kept your completion on this device but could not confirm the cloud save. Try Finish again, or reconnect to sync it."
      : "YOVA could not confirm the save. Keep this session open and try Finish again; browser storage is unavailable.";
  }
  // Read one exact receipt rather than treating queue disappearance or a
  // timeout as proof that the mutation failed. The repository checks account
  // identity and route provenance, under its normal bounded deadline.
  try {
    if (await readAuthenticatedSessionCompletionReceipt(userId, completion)) {
      finalizeCommittedSessionCompletion(userId, completion.id);
      return { completion, committed: true, issue: null };
    }
  } catch {
    // Still unknown: preserve the queued event and the end-screen checkpoint.
  }
  return { completion, committed: false, issue };
}

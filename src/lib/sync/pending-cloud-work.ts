import { saveAuthenticatedLearnerProfile } from "@/lib/supabase/learning-state-repository";
import {
  learnerProfileNeedsSync,
  type AuthoritativeLearnerProfileSyncSnapshot,
  type LearnerProfileSyncState,
} from "@/lib/sync/learner-profile-sync-snapshot";
import { flushQueuedSessionTerminals } from "@/lib/sync/session-terminal-outbox";

export type CurrentLearnerProfileSyncState = Readonly<{
  onboardingCompleted: boolean;
  profileState: LearnerProfileSyncState;
  authoritativeSnapshot: AuthoritativeLearnerProfileSyncSnapshot | null;
}>;

export type PendingCloudWorkResult = Readonly<{
  issue: string | null;
  syncedProfileState: LearnerProfileSyncState | null;
}>;

/**
 * Flushes terminal events before considering a profile retry. The profile is
 * intentionally read only after that await so an edit made while terminal
 * work is in flight cannot be overwritten by an older render snapshot.
 */
export async function syncPendingCloudWork(
  accountId: string,
  readCurrentProfile: () => CurrentLearnerProfileSyncState | null,
): Promise<PendingCloudWorkResult> {
  const terminalResult = await flushQueuedSessionTerminals(accountId);
  const pendingEvents = terminalResult.remaining;
  if (pendingEvents > 0) {
    return {
      issue: `${pendingEvents} session ${pendingEvents === 1 ? "event is" : "events are"} still waiting to sync.`,
      syncedProfileState: null,
    };
  }

  const current = readCurrentProfile();
  if (
    !current
    || current.profileState.accountId !== accountId
    || !current.onboardingCompleted
    || !learnerProfileNeedsSync(current.profileState, current.authoritativeSnapshot)
  ) {
    return { issue: null, syncedProfileState: null };
  }

  try {
    const receipt = await saveAuthenticatedLearnerProfile({
      accountId: current.profileState.accountId,
      displayName: current.profileState.displayName,
      onboardingAnswers: [...current.profileState.onboardingAnswers],
    });
    return {
      issue: null,
      syncedProfileState: {
        accountId: receipt.accountId,
        displayName: receipt.displayName,
        onboardingAnswers: receipt.onboardingAnswers,
      },
    };
  } catch (error) {
    return {
      issue: error instanceof Error ? error.message : "YOVA could not sync your learning profile.",
      syncedProfileState: null,
    };
  }
}

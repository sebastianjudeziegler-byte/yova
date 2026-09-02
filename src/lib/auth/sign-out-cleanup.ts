import { clearActiveSessionCheckpoints } from "@/lib/learning/active-session-checkpoint";
import { clearPreviewSnapshot } from "@/lib/persistence/preview-store";
import { clearQueuedSessionCompletions } from "@/lib/sync/session-completion-outbox";
import { clearQueuedSessionInterruptions } from "@/lib/sync/session-interruption-outbox";
import { clearCalendarPrototypeState } from "@/lib/calendar/persistence";

export const SIGN_OUT_STORAGE_WARNING =
  "You are signed out, but YOVA could not remove all recovery data saved in this browser. Clear this site’s browser data before sharing this device.";

export function resolveSignOutCleanupAccountId(
  currentAccountId: string | null,
  retainedAccountId: string | null,
) {
  return currentAccountId ?? retainedAccountId;
}

/**
 * Authentication is already gone when this runs, so storage failures must not
 * strand a signed-in React screen. Each account-scoped cleanup is attempted
 * independently and the caller receives only a bounded result, never browser
 * or provider error details.
 */
export function clearConfirmedSignOutStorage(
  accountId: string | null,
  options: { clearDeletedAccountCalendar?: boolean } = {},
) {
  let fullyCleared = true;

  const attempt = (cleanup: () => unknown) => {
    try {
      if (cleanup() === false) fullyCleared = false;
    } catch {
      fullyCleared = false;
    }
  };

  if (accountId) {
    attempt(() => clearActiveSessionCheckpoints(accountId));
    attempt(() => clearQueuedSessionCompletions(accountId));
    attempt(() => clearQueuedSessionInterruptions(accountId));
    if (options.clearDeletedAccountCalendar) {
      attempt(() => clearCalendarPrototypeState(window.localStorage, accountId));
    }
  } else if (options.clearDeletedAccountCalendar) {
    fullyCleared = false;
  }
  attempt(clearPreviewSnapshot);

  return { fullyCleared };
}

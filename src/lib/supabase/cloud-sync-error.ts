export type CloudSyncFailureCode = "account_identity_mismatch" | "temporarily_unavailable";

export const SESSION_RECOVERY_CLOUD_SYNC_WARNING =
  "Session recovery is saved on this device. Cloud sync is temporarily unavailable; use Retry now to sync it.";

export const ACTIVE_SESSION_RECOVERY_CLOUD_SYNC_WARNING =
  "Recovery is saved on this device. Cloud sync is temporarily unavailable; try syncing again shortly.";

export const LEARNER_PROFILE_IDENTITY_SYNC_WARNING =
  "YOVA could not verify your account while syncing your learning profile. Your changes are still visible here; use Retry now before closing or reloading.";

export const LEARNER_PROFILE_SAVE_SYNC_WARNING =
  "YOVA could not save your learning profile to the cloud. Your changes are still visible here; use Retry now before closing or reloading.";

export function isTemporaryLearnerProfileSyncWarning(value: string | null) {
  return value === LEARNER_PROFILE_IDENTITY_SYNC_WARNING
    || value === LEARNER_PROFILE_SAVE_SYNC_WARNING;
}

/**
 * A cloud write was stopped because YOVA positively identified a different
 * account, or because a confirmed sign-out cancelled work for the old one.
 * This must not be used for provider, network, or indeterminate auth errors.
 */
export class CloudAccountIdentityMismatchError extends Error {
  readonly code = "account_identity_mismatch" as const satisfies CloudSyncFailureCode;
  readonly retryable = false as const;

  constructor() {
    super("YOVA stopped saving this learning profile because the signed-in account changed.");
    this.name = "CloudAccountIdentityMismatchError";
  }
}

/**
 * The account-scoped write is still safe to retry, but its cloud result could
 * not be obtained. Local state remains authoritative until a later sync.
 */
export class CloudSyncTemporarilyUnavailableError extends Error {
  readonly code = "temporarily_unavailable" as const satisfies CloudSyncFailureCode;
  readonly retryable = true as const;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CloudSyncTemporarilyUnavailableError";
  }
}

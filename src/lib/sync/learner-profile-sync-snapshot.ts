import { stableFingerprint } from "@/lib/stable-fingerprint";

export type LearnerProfileSyncState = {
  accountId: string;
  displayName: string;
  onboardingAnswers: readonly string[];
};

export type AuthoritativeLearnerProfileSyncSnapshot = Readonly<{
  accountId: string;
  fingerprint: string;
}>;

/**
 * Identifies the complete learner-profile payload sent to the account store.
 * Answer order, empty slots, and serialized canonical state are intentional
 * parts of the identity so a canonicalization pass is never mistaken for the
 * cloud-hydrated value that preceded it.
 */
export function learnerProfileSyncFingerprint(state: LearnerProfileSyncState) {
  return stableFingerprint({
    accountId: state.accountId,
    displayName: state.displayName,
    onboardingAnswers: state.onboardingAnswers,
  }, "lps1");
}

/**
 * Captures state that is known to be authoritative because it was just loaded
 * from the account or its exact payload was just saved successfully.
 */
export function captureAuthoritativeLearnerProfileSyncSnapshot(
  state: LearnerProfileSyncState,
): AuthoritativeLearnerProfileSyncSnapshot {
  return {
    accountId: state.accountId,
    fingerprint: learnerProfileSyncFingerprint(state),
  };
}

/**
 * A missing or different snapshot means the current state needs a cloud save.
 * Matching requires both the account boundary and the complete payload.
 */
export function learnerProfileNeedsSync(
  state: LearnerProfileSyncState,
  authoritativeSnapshot: AuthoritativeLearnerProfileSyncSnapshot | null,
) {
  return authoritativeSnapshot === null
    || authoritativeSnapshot.accountId !== state.accountId
    || authoritativeSnapshot.fingerprint !== learnerProfileSyncFingerprint(state);
}

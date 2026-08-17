export type CloudRecoveryStatus = "idle" | "protecting-snapshot";

export type CloudRecoveryEvent =
  | "cloud-read-failed"
  | "auth-check-failed"
  | "auth-account-missing"
  | "cloud-restored"
  | "trusted-local-restored"
  | "explicit-sign-out";

export function transitionCloudRecovery(
  current: CloudRecoveryStatus,
  event: CloudRecoveryEvent,
): CloudRecoveryStatus {
  if (event === "cloud-read-failed") return "protecting-snapshot";
  if (
    event === "cloud-restored"
    || event === "trusted-local-restored"
    || event === "explicit-sign-out"
  ) return "idle";

  return current;
}

export function protectsPreviewSnapshot(status: CloudRecoveryStatus) {
  return status === "protecting-snapshot";
}

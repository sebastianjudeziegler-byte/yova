import { describe, expect, it } from "vitest";
import {
  ACTIVE_SESSION_RECOVERY_CLOUD_SYNC_WARNING,
  CloudAccountIdentityMismatchError,
  isTemporaryLearnerProfileSyncWarning,
  LEARNER_PROFILE_IDENTITY_SYNC_WARNING,
  LEARNER_PROFILE_SAVE_SYNC_WARNING,
  SESSION_RECOVERY_CLOUD_SYNC_WARNING,
} from "@/lib/supabase/cloud-sync-error";

describe("cloud sync warning copy", () => {
  it.each([
    SESSION_RECOVERY_CLOUD_SYNC_WARNING,
    ACTIVE_SESSION_RECOVERY_CLOUD_SYNC_WARNING,
  ])("describes retryable checkpoint failures without inventing an account disconnect", (message) => {
    expect(message).toContain("saved on this device");
    expect(message).toContain("Cloud sync is temporarily unavailable");
    expect(message).not.toMatch(/account (?:changed|reconnect)/i);
  });

  it("recognizes only temporary learner-profile warnings for success cleanup", () => {
    expect(isTemporaryLearnerProfileSyncWarning(LEARNER_PROFILE_IDENTITY_SYNC_WARNING)).toBe(true);
    expect(isTemporaryLearnerProfileSyncWarning(LEARNER_PROFILE_SAVE_SYNC_WARNING)).toBe(true);
    expect(isTemporaryLearnerProfileSyncWarning(new CloudAccountIdentityMismatchError().message)).toBe(false);
    expect(isTemporaryLearnerProfileSyncWarning("A separate deadline sync failed.")).toBe(false);
    expect(isTemporaryLearnerProfileSyncWarning(null)).toBe(false);
  });
});

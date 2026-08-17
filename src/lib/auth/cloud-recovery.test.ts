import { describe, expect, it } from "vitest";
import {
  protectsPreviewSnapshot,
  transitionCloudRecovery,
  type CloudRecoveryStatus,
} from "@/lib/auth/cloud-recovery";

describe("cloud recovery snapshot protection", () => {
  it.each(["auth-check-failed", "auth-account-missing"] as const)(
    "keeps a partial same-account snapshot protected when retry ends in %s",
    (retryOutcome) => {
      const partialSnapshot = {
        onboardingCompleted: false,
        onboardingAnswers: ["partial answer"],
      };
      const unsafeReplacement = retryOutcome === "auth-check-failed"
        ? { onboardingCompleted: false, onboardingAnswers: [] }
        : null;
      let storedSnapshot: typeof partialSnapshot | null = partialSnapshot;
      let status: CloudRecoveryStatus = "idle";

      status = transitionCloudRecovery(status, "cloud-read-failed");
      status = transitionCloudRecovery(status, retryOutcome);
      if (!protectsPreviewSnapshot(status)) storedSnapshot = unsafeReplacement;

      expect(protectsPreviewSnapshot(status)).toBe(true);
      expect(storedSnapshot).toEqual({
        onboardingCompleted: false,
        onboardingAnswers: ["partial answer"],
      });
    },
  );

  it.each(["cloud-restored", "trusted-local-restored", "explicit-sign-out"] as const)(
    "releases snapshot protection only after %s",
    (resolution) => {
      const status = transitionCloudRecovery("protecting-snapshot", resolution);

      expect(protectsPreviewSnapshot(status)).toBe(false);
    },
  );
});

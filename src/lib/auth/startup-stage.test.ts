import { describe, expect, it } from "vitest";
import { restoredAccountStage } from "@/lib/auth/startup-stage";

describe("restored account startup", () => {
  it("opens an onboarded account even when the legacy alpha marker is false", () => {
    expect(restoredAccountStage({
      onboardingCompleted: true,
      hasActivePlan: false,
      legacyAlphaEntered: false,
    })).toBe("app");
  });

  it("keeps a real new account in onboarding", () => {
    expect(restoredAccountStage({
      onboardingCompleted: false,
      hasActivePlan: false,
      legacyAlphaEntered: true,
    })).toBe("onboarding-intro");
  });

  it("preserves access for a legacy account that already has an active plan", () => {
    expect(restoredAccountStage({
      onboardingCompleted: false,
      hasActivePlan: true,
    })).toBe("app");
  });
});

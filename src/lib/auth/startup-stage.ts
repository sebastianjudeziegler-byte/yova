export type RestoredAccountStage = "onboarding-intro" | "app";

export function restoredAccountStage({
  onboardingCompleted,
  hasActivePlan,
}: {
  onboardingCompleted: boolean;
  hasActivePlan: boolean;
  /** Accepted from legacy browser snapshots but intentionally not used as a gate. */
  legacyAlphaEntered?: boolean;
}): RestoredAccountStage {
  return onboardingCompleted || hasActivePlan ? "app" : "onboarding-intro";
}

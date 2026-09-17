import type { OnboardingAnswers } from "@/lib/onboarding/answers";
import { OnboardingAnswersRequestSchema } from "@/lib/onboarding/request-schema";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import {
  CanonicalLearnerProfileSchema,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import { CanonicalPreferredMethodIdsSchema } from "@/lib/personalization/preferred-method-schema";

export type DevelopmentPreviewPreferenceRequestInput = {
  previewPreferredMethodIds?: CoreMethodId[];
  previewCanonicalProfile?: CanonicalLearnerProfile;
  previewOnboardingAnswers?: OnboardingAnswers;
};

export function developmentPreviewPreferenceRequestInput(
  browserPreviewMode: boolean,
  preferredMethodIds: readonly CoreMethodId[],
  canonicalProfile?: Readonly<CanonicalLearnerProfile> | null,
  onboardingAnswers?: OnboardingAnswers,
): DevelopmentPreviewPreferenceRequestInput {
  if (!browserPreviewMode) return {};
  const canonicalMethodIds = CanonicalPreferredMethodIdsSchema.parse([
    ...preferredMethodIds,
  ]);
  return {
    ...(onboardingAnswers ? { previewOnboardingAnswers: OnboardingAnswersRequestSchema.parse(onboardingAnswers) } : {}),
    ...(canonicalMethodIds.length > 0
      ? { previewPreferredMethodIds: canonicalMethodIds }
      : {}),
    ...(canonicalProfile
      ? { previewCanonicalProfile: CanonicalLearnerProfileSchema.parse(canonicalProfile) }
      : {}),
  };
}

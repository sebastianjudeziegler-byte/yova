import type { CoreMethodId } from "@/lib/learning/method-catalog";
import {
  CanonicalLearnerProfileSchema,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import { CanonicalPreferredMethodIdsSchema } from "@/lib/personalization/preferred-method-schema";

export type DevelopmentPreviewPreferenceRequestInput = {
  previewPreferredMethodIds?: CoreMethodId[];
  previewCanonicalProfile?: CanonicalLearnerProfile;
};

export function developmentPreviewPreferenceRequestInput(
  browserPreviewMode: boolean,
  preferredMethodIds: readonly CoreMethodId[],
  canonicalProfile?: Readonly<CanonicalLearnerProfile> | null,
): DevelopmentPreviewPreferenceRequestInput {
  if (!browserPreviewMode) return {};
  const canonicalMethodIds = CanonicalPreferredMethodIdsSchema.parse([
    ...preferredMethodIds,
  ]);
  return {
    ...(canonicalMethodIds.length > 0
      ? { previewPreferredMethodIds: canonicalMethodIds }
      : {}),
    ...(canonicalProfile
      ? { previewCanonicalProfile: CanonicalLearnerProfileSchema.parse(canonicalProfile) }
      : {}),
  };
}

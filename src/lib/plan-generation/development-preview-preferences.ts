import type { CoreMethodId } from "@/lib/learning/method-catalog";
import { CanonicalPreferredMethodIdsSchema } from "@/lib/personalization/preferred-method-schema";

export type DevelopmentPreviewPreferenceRequestInput = {
  previewPreferredMethodIds?: CoreMethodId[];
};

export function developmentPreviewPreferenceRequestInput(
  browserPreviewMode: boolean,
  preferredMethodIds: readonly CoreMethodId[],
): DevelopmentPreviewPreferenceRequestInput {
  if (!browserPreviewMode || preferredMethodIds.length === 0) return {};
  return {
    previewPreferredMethodIds: CanonicalPreferredMethodIdsSchema.parse([
      ...preferredMethodIds,
    ]),
  };
}

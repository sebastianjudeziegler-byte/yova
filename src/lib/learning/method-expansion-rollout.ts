import type { CoreMethodId } from "@/lib/learning/method-catalog";

export const METHOD_EXPANSION_ROLLOUT_VERSION = "method_expansion_v1" as const;

export type ExpandedMethodId = Extract<
  CoreMethodId,
  "pretesting" | "concept_mapping" | "practice_problems"
>;

/**
 * Code-owned rollback switches for the three genuinely new launch recipes.
 *
 * These are deliberately independent: a method can be withdrawn without
 * changing the stable IDs or invalidating a route already committed under an
 * earlier policy version. Existing Feynman and SQ3R routes are presentation
 * and fidelity upgrades over stable legacy IDs, so they do not need a second
 * identity flag.
 */
export const METHOD_EXPANSION_ROLLOUT: Readonly<Record<ExpandedMethodId, boolean>> = {
  pretesting: true,
  concept_mapping: true,
  practice_problems: true,
};

export function expandedMethodIsEnabled(methodId: CoreMethodId) {
  if (!(methodId in METHOD_EXPANSION_ROLLOUT)) return true;
  return METHOD_EXPANSION_ROLLOUT[methodId as ExpandedMethodId];
}

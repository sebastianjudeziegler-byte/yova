import {
  CORE_METHOD_IDS,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import type {
  CanonicalLearnerProfile,
  CanonicalProfileSignal,
  CanonicalProfileSignalId,
} from "@/lib/personalization/canonical-profile-schema";

export const CANONICAL_PROFILE_METHOD_PREFERENCE_POLICY_VERSION =
  "canonical_profile_method_preference_v1" as const;

export type CanonicalProfileMethodPreference = {
  policyVersion: typeof CANONICAL_PROFILE_METHOD_PREFERENCE_POLICY_VERSION;
  methodId: CoreMethodId;
  signalId: CanonicalProfileSignalId;
  signalValue: string;
  source: CanonicalProfileSignal["source"];
  sourceQuestionId: string;
  authority: "eligible_method_tiebreaker_only";
  reason: string;
};

const METHOD_PREFERENCES: Readonly<
  Partial<Record<CanonicalProfileSignalId, Readonly<Record<string, readonly CoreMethodId[]>>>>
> = {
  unfamiliar_entry: {
    simple_explanation: ["self_explanation", "read_recall_review"],
    concrete_example: ["worked_example_fading"],
    big_picture: ["concept_mapping"],
    small_steps: ["worked_example_fading"],
    try_first: ["pretesting", "practice_problems"],
    compare_similar: ["concept_mapping", "interleaved_practice"],
  },
  successful_approach: {
    closed_note_retrieval: ["retrieval_practice", "spaced_retrieval"],
    practice_problems: ["practice_problems"],
    worked_examples_then_practice: ["worked_example_fading"],
    explain_from_memory: ["self_explanation"],
  },
  post_study_breakdown: {
    recognition_without_recall: ["retrieval_practice"],
    delayed_forgetting: ["spaced_retrieval"],
    similar_idea_confusion: ["interleaved_practice", "concept_mapping"],
    application_gap: ["practice_problems"],
    support_dependence: ["practice_problems"],
  },
};

/**
 * Projects self-report into a bounded preference list only after the caller
 * supplies the server-computed eligibility set. It cannot add a method to that
 * set, and an empty projection means the canonical router keeps its baseline.
 */
export function canonicalEligibleMethodTieBreakPreferences(
  profile: CanonicalLearnerProfile,
  eligibleMethodIds: readonly CoreMethodId[],
): CanonicalProfileMethodPreference[] {
  const eligible = new Set(eligibleMethodIds);
  const seen = new Set<CoreMethodId>();
  const preferences: CanonicalProfileMethodPreference[] = [];
  for (const signal of profile.signals) {
    const methodIds = METHOD_PREFERENCES[signal.signalId]?.[signal.value] ?? [];
    for (const methodId of methodIds) {
      if (!eligible.has(methodId) || seen.has(methodId)) continue;
      seen.add(methodId);
      preferences.push({
        policyVersion: CANONICAL_PROFILE_METHOD_PREFERENCE_POLICY_VERSION,
        methodId,
        signalId: signal.signalId,
        signalValue: signal.value,
        source: signal.source,
        sourceQuestionId: signal.sourceQuestionId,
        authority: "eligible_method_tiebreaker_only",
        reason: `${signal.signalId}=${signal.value} may rank ${methodId} only because it is already eligible.`,
      });
    }
  }
  return preferences;
}

export function canonicalMethodPreferenceMapUsesKnownMethods() {
  const knownMethods = new Set<string>(CORE_METHOD_IDS);
  return Object.values(METHOD_PREFERENCES).every((preferences) => (
    Object.values(preferences).every((methodIds) => (
      methodIds.every((methodId) => knownMethods.has(methodId))
    ))
  ));
}

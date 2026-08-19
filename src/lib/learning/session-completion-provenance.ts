import type { SessionCompletion, SessionCompletionMode } from "@/lib/domain";

export const DEFAULT_SESSION_COMPLETION_MODE: SessionCompletionMode = "guided";
export const UNGUIDED_PRACTICE_OBSERVED_GAP = "Unguided practice completed; no topic evidence was recorded.";

export function normalizeSessionCompletionMode(value: unknown): SessionCompletionMode {
  return value === "unguided_practice" ? value : DEFAULT_SESSION_COMPLETION_MODE;
}

/**
 * Unguided work advances plan progress, but self-report must never become
 * topic evidence. Missing legacy provenance remains guided for compatibility.
 */
export function completionCreatesTopicEvidence(
  completion: Pick<SessionCompletion, "completionMode">,
) {
  return normalizeSessionCompletionMode(completion.completionMode) === "guided";
}

export function asUnguidedPracticeCompletion(
  completion: SessionCompletion,
): SessionCompletion {
  return {
    ...completion,
    correctAnswers: 0,
    totalAnswers: 0,
    observedGap: UNGUIDED_PRACTICE_OBSERVED_GAP,
    completionMode: "unguided_practice",
    conceptEvidence: [],
    confidenceEvidence: [],
  };
}

export function normalizeSessionCompletionProvenance(
  completion: SessionCompletion,
): SessionCompletion {
  const completionMode = normalizeSessionCompletionMode(completion.completionMode);
  return completionMode === "unguided_practice"
    ? asUnguidedPracticeCompletion(completion)
    : { ...completion, completionMode };
}

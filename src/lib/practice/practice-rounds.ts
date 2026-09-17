import type { CoreMethodId } from "@/lib/learning/method-catalog";

/**
 * Practice round kinds (Brief 1.5 item 3). Four practice methods, chosen by
 * code, each a different round rather than a relabel:
 * - Active Recall: the default round.
 * - Error Repair: any round after a missed one, built only from missed points,
 *   aimed at the reasoning error the learner made.
 * - Practice Test: deadline within three days; a longer exam-style set.
 * - Interleaved Review: two or more related topics have each passed once; the
 *   round sweeps their key points together.
 */
export const PRACTICE_ROUND_KINDS = ["active_recall", "error_repair", "practice_test", "interleaved_review"] as const;
export type PracticeRoundKind = (typeof PRACTICE_ROUND_KINDS)[number];
/** Kinds a practice block can open with; Error Repair only ever follows a miss. */
export type FirstPracticeRoundKind = Exclude<PracticeRoundKind, "error_repair">;

export const PRACTICE_ROUND_LABEL: Record<PracticeRoundKind, string> = {
  active_recall: "Active Recall",
  error_repair: "Error Repair",
  practice_test: "Practice Test",
  interleaved_review: "Interleaved Review",
};

export const PRACTICE_ROUND_METHOD: Record<PracticeRoundKind, CoreMethodId> = {
  active_recall: "retrieval_practice",
  error_repair: "practice_test_error_repair",
  practice_test: "practice_test_error_repair",
  interleaved_review: "interleaved_practice",
};

export const PRACTICE_ROUND_RULE_ID: Record<PracticeRoundKind, string> = {
  active_recall: "L4.practice.active_recall.default",
  error_repair: "L4.practice.error_repair.after_missed_round",
  practice_test: "L4.practice.practice_test.deadline_within_3_days",
  interleaved_review: "L4.practice.interleaved_review.related_topics_passed",
};

export const PRACTICE_TEST_DEADLINE_DAYS = 3;
export const PRACTICE_TEST_QUESTION_COUNT = 8;
export const INTERLEAVED_MINIMUM_PASSED_TOPICS = 2;

/** Round 1 opens with the route's choice; a later round exists only after a miss, so it is Error Repair. */
export function practiceRoundKind(first: FirstPracticeRoundKind, roundNumber: number): PracticeRoundKind {
  return roundNumber > 1 ? "error_repair" : first;
}

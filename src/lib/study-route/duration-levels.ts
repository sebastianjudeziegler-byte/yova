/** Canonical learner-facing durations for ordinary Learn or Practice sessions. */
export const NORMAL_STUDY_DURATION_LEVELS = [10, 15, 25, 45, 60] as const;

export type NormalStudyDurationMinutes =
  (typeof NORMAL_STUDY_DURATION_LEVELS)[number];

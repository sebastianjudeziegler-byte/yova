import type { ConceptSignal } from "@/lib/learning/concept-evidence";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

export type ConceptReviewDirective = {
  concept: string;
  evidenceStatus: ConceptSignal["status"];
  reviewType: "repair_and_retrieve" | "verify" | "maintenance_transfer";
  intervalDays: number;
  dueAt: string;
  timing: "due" | "upcoming";
  timingLabel: string;
  priority: "high" | "medium" | "low";
  reason: string;
  instruction: string;
};

type ReviewCheckActivity = {
  type: string;
  concept: string | null;
  requiredForCompletion: boolean;
  title?: string;
  body?: string;
  correctAnswer?: string | null;
  choices?: string[];
};

export function buildConceptReviewSchedule(
  signals: ConceptSignal[],
  now: Date = new Date(),
): ConceptReviewDirective[] {
  return signals
    .map((signal) => toReviewDirective(signal, now))
    .filter((directive): directive is ConceptReviewDirective => directive !== null)
    .sort((left, right) => {
      const timingPriority = { due: 0, upcoming: 1 };
      const evidencePriority = { high: 0, medium: 1, low: 2 };
      return timingPriority[left.timing] - timingPriority[right.timing]
        || evidencePriority[left.priority] - evidencePriority[right.priority]
        || left.dueAt.localeCompare(right.dueAt);
    });
}

export function validateConceptReviewSchedule({
  schedule,
  activities,
}: {
  schedule: ConceptReviewDirective[];
  activities: Array<{ type: string; concept: string | null }>;
}) {
  const dueReview = schedule.find((directive) => directive.timing === "due");
  if (!dueReview) return null;

  const checkedConcepts = activities
    .filter((activity) => activity.type === "multiple_choice" || activity.type === "free_response")
    .map((activity) => activity.concept?.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (!checkedConcepts.includes(dueReview.concept.trim().toLocaleLowerCase())) {
    return `The due concept ${dueReview.concept} must appear in a knowledge check before lower-priority review.`;
  }

  return null;
}

/**
 * Keep review evidence attached to the stable concept name from prior sessions.
 * Models sometimes rename a check at generation time, such as using
 * "Quotient formula" for a due "Quotient rule" review. We only correct that
 * drift when one required question contains every meaningful word in the due
 * concept, which prevents an unrelated check from being relabeled.
 */
export function alignDueReviewConcept<T extends ReviewCheckActivity>(
  activities: T[],
  schedule: ConceptReviewDirective[],
): T[] {
  const dueReview = schedule.find((directive) => directive.timing === "due");
  if (!dueReview) return activities;

  const dueConcept = dueReview.concept.trim();
  const normalizedDueConcept = normalizeConcept(dueConcept);
  const questionActivities = activities.filter((activity) => (
    activity.requiredForCompletion
    && (activity.type === "multiple_choice" || activity.type === "free_response")
  ));
  if (questionActivities.some((activity) => normalizeConcept(activity.concept ?? "") === normalizedDueConcept)) {
    return activities;
  }

  const dueTokens = meaningfulConceptTokens(dueConcept);
  if (dueTokens.length === 0) return activities;
  const candidates = questionActivities.filter((activity) => {
    const activityTokens = new Set(meaningfulConceptTokens([
      activity.concept,
      activity.title,
      activity.body,
      activity.correctAnswer,
      ...(activity.choices ?? []),
    ].filter(Boolean).join(" ")));
    return dueTokens.every((token) => activityTokens.has(token));
  });
  if (candidates.length !== 1) return activities;

  const matchedActivity = candidates[0];
  return activities.map((activity) => (
    activity === matchedActivity ? { ...activity, concept: dueConcept } : activity
  ));
}

function toReviewDirective(
  signal: ConceptSignal,
  now: Date,
): ConceptReviewDirective | null {
  const lastObserved = new Date(signal.lastObservedAt);
  if (Number.isNaN(lastObserved.getTime())) return null;

  const intervalDays = signal.status === "needs_review"
    ? 1
    : signal.status === "showing_strength"
      ? signal.secureAttempts >= 4 ? 7 : 4
      : 2;
  const dueAt = new Date(lastObserved.getTime() + intervalDays * DAY_IN_MILLISECONDS);
  const timing = dueAt.getTime() <= now.getTime() ? "due" : "upcoming";
  const daysUntil = Math.max(1, Math.ceil((dueAt.getTime() - now.getTime()) / DAY_IN_MILLISECONDS));

  if (signal.status === "needs_review") {
    return {
      concept: signal.concept,
      evidenceStatus: signal.status,
      reviewType: "repair_and_retrieve",
      intervalDays,
      dueAt: dueAt.toISOString(),
      timing,
      timingLabel: timing === "due" ? "Due for retrieval" : daysUntil === 1 ? "Return tomorrow" : `Return in ${daysUntil} days`,
      priority: "high",
      reason: "The latest completed check still showed a gap, so YOVA schedules a fresh attempt after time has passed instead of counting the immediate correction as durable knowledge.",
      instruction: "Retrieve the concept without the previous answer, repair any miss, then use one different application.",
    };
  }

  if (signal.status === "showing_strength") {
    return {
      concept: signal.concept,
      evidenceStatus: signal.status,
      reviewType: "maintenance_transfer",
      intervalDays,
      dueAt: dueAt.toISOString(),
      timing,
      timingLabel: timing === "due" ? "Light transfer check due" : `Light check in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`,
      priority: "low",
      reason: "Repeated secure checks justify less frequent review, but they do not prove permanent mastery.",
      instruction: "Use one brief, different application without reteaching the concept first.",
    };
  }

  return {
    concept: signal.concept,
    evidenceStatus: signal.status,
    reviewType: "verify",
    intervalDays,
    dueAt: dueAt.toISOString(),
    timing,
    timingLabel: timing === "due" ? "Verification due" : `Verify in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`,
    priority: "medium",
    reason: "One or mixed secure checks are encouraging but not enough to treat the concept as stable.",
    instruction: "Use one independent retrieval or application check before showing support.",
  };
}

function meaningfulConceptTokens(value: string) {
  const ignored = new Set(["a", "an", "and", "for", "from", "in", "of", "on", "the", "to", "with"]);
  return [...new Set(normalizeConcept(value)
    .split(" ")
    .filter((token) => token.length > 2 && !ignored.has(token)))];
}

function normalizeConcept(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

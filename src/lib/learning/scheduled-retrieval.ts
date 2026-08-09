import type { LearningPlanSession } from "@/lib/domain";
import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

export type ScheduledRetrievalType = NonNullable<LearningPlanSession["reviewType"]>;

type ReviewIdentity = {
  reviewType?: ScheduledRetrievalType | null;
};

type ReviewSessionDescriptor = Pick<
  LearningPlanSession,
  "learningMode" | "estimatedMinutes"
> & {
  reviewConcept?: string | null;
  reviewType?: ScheduledRetrievalType | null;
};

export function isScheduledRetrievalSession(
  session: ReviewIdentity | null | undefined,
) {
  return Boolean(session?.reviewType);
}

export function scheduledRetrievalContract(session: ReviewSessionDescriptor) {
  const reviewType = session.reviewType ?? null;
  if (!reviewType) return null;

  return {
    format: "low_stress_multiple_choice" as const,
    reviewType,
    concept: session.reviewConcept?.trim() || null,
    maximumQuestions: 3,
    learnerPromise: "One short multiple-choice check at a time. Every question includes the context you need. No typed response and no confidence rating.",
    evidenceBoundary: "This is a lightweight return signal, not proof of permanent mastery.",
    instructions: [
      "Use exactly three multiple-choice activities and no other activity types.",
      "Begin with an unsupported retrieval question. Do not reteach before the first answer.",
      "Make every question self-contained. Restate all facts, values, functions, scenarios, and definitions needed to answer it.",
      "Never refer to a previous answer, prior example, earlier screen, or hidden problem statement.",
      "Use three or four plausible choices and concise explanatory feedback for every question.",
      "Keep every question required, one to three minutes long, and focused on the scheduled concept.",
      "Use a different wording, contrast, or application after the first question instead of repeating it.",
    ],
  };
}

export function adaptDeliveryPolicyForScheduledRetrieval(
  policy: SessionDeliveryPolicy,
  reviewConcept: string | null | undefined,
): SessionDeliveryPolicy {
  const concept = reviewConcept?.trim();
  const reviewReason = concept
    ? `This is a scheduled return to ${concept}, so YOVA is using a short multiple-choice check without a typed response.`
    : "This is a scheduled return, so YOVA is using a short multiple-choice check without a typed response.";

  return {
    ...policy,
    retention: {
      mode: "retrieval",
      label: "Quick retrieval",
      instruction: "Ask for an answer before feedback, then use a fresh multiple-choice check to confirm or repair the idea.",
    },
    workspace: {
      mode: "one_step",
      label: "One question at a time",
      instruction: "Show one short question at a time and keep the review calm, direct, and easy to resume.",
    },
    pacing: {
      firstActionMinutes: 1,
      maximumActivities: 3,
      reason: "Scheduled retrieval should be a small return to prior content, not another full study session.",
    },
    learnerFacingReasons: unique([reviewReason, ...policy.learnerFacingReasons]).slice(0, 4),
  };
}

export function validateScheduledRetrievalSession(
  draft: GeneratedSessionDraft,
  session: ReviewSessionDescriptor,
): string | null {
  if (!session.reviewType) return null;
  if (draft.methodBriefing.learningMode !== "study") {
    return "A scheduled retrieval must stay practice-first instead of becoming another teaching session.";
  }
  if (draft.methodBriefing.methodId !== "retrieval_practice") {
    return "A scheduled retrieval must use the bounded retrieval-practice method contract.";
  }
  if (draft.activities.length !== 3) {
    return "A scheduled retrieval must contain exactly three short multiple-choice questions.";
  }

  const nonMultipleChoice = draft.activities.find((activity) => activity.type !== "multiple_choice");
  if (nonMultipleChoice) {
    return "A scheduled retrieval must use multiple-choice questions only. It cannot require typing, reading, or reflection.";
  }
  if (draft.activities.some((activity) => activity.teaching)) {
    return "A scheduled retrieval cannot place a teaching model before the first attempt.";
  }
  if (draft.activities.some((activity) => !activity.requiredForCompletion)) {
    return "All three scheduled retrieval questions must be required so completion remains clear.";
  }
  if (draft.activities.some((activity) => activity.estimatedMinutes > 3)) {
    return "Each scheduled retrieval question must take no more than three minutes.";
  }
  if (draft.activities[0]?.methodPhase !== "retrieve") {
    return "A scheduled retrieval must begin with unsupported retrieval before feedback.";
  }

  const allowedPhases = new Set(["retrieve", "discriminate", "repair", "transfer"]);
  const invalidPhase = draft.activities.find((activity) => !allowedPhases.has(activity.methodPhase));
  if (invalidPhase) {
    return `The ${invalidPhase.methodPhase} phase does not belong in a low-stress scheduled retrieval.`;
  }

  const reviewConcept = session.reviewConcept?.trim() || null;
  const targetConcept = reviewConcept?.toLocaleLowerCase();
  if (targetConcept && !draft.activities.some((activity) => activity.concept?.trim().toLocaleLowerCase() === targetConcept)) {
    return `The scheduled concept ${reviewConcept} must appear exactly in at least one review question.`;
  }

  return null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

import type {
  LearningPlanSession,
  NextSessionAdaptation,
  SessionCompletion,
} from "@/lib/domain";
import { buildDelayedVerificationSession } from "@/lib/learning/delayed-verification";
import { buildNextSessionAdaptation } from "@/lib/personalization/session-adaptation";

export type PostSessionDecision = {
  kind: "adapt_next_session" | "add_delayed_verification" | "keep_current_plan";
  title: string;
  nextTitle: string;
  explanation: string;
  changes: string[];
  adaptation: NextSessionAdaptation | null;
  followUpSession: LearningPlanSession | null;
  reviewPlan: {
    title: string;
    scheduledFor: string;
    estimatedMinutes: number;
    explanation: string;
  } | null;
};

export function approvedPostSessionChanges(
  decision: PostSessionDecision,
  approved: boolean,
) {
  return approved
    ? { adaptation: decision.adaptation, followUpSession: decision.followUpSession }
    : { adaptation: null, followUpSession: null };
}

export function buildPostSessionDecision(
  completedSession: LearningPlanSession,
  nextSession: LearningPlanSession | null,
  completion: SessionCompletion,
): PostSessionDecision {
  const adaptation = buildNextSessionAdaptation(nextSession, completion);
  const delayedReview = buildDelayedVerificationSession(completedSession, completion);
  if (adaptation) {
    return {
      kind: "adapt_next_session",
      title: "Adjust how the next session begins",
      nextTitle: adaptation.title,
      explanation: `${adaptation.explanation} YOVA will not replace the next target or silently remove later content.`,
      changes: [
        `Keep the next target: ${adaptation.objective}`,
        `Use ${adaptation.method.toLocaleLowerCase()} while preserving the planned ${adaptation.estimatedMinutes}-minute content window.`,
        delayedReview
          ? `Keep ${reviewConcept(delayedReview)} in the retrieval queue for a separate delayed check.`
          : "Keep every later session target in its original place.",
      ],
      adaptation,
      followUpSession: null,
      reviewPlan: delayedReview ? toReviewPlan(delayedReview) : null,
    };
  }

  const followUpSession = nextSession ? null : delayedReview;
  if (followUpSession) {
    return {
      kind: "add_delayed_verification",
      title: "Add a short delayed check",
      nextTitle: followUpSession.title,
      explanation: followUpSession.adaptationNote?.explanation ?? followUpSession.methodReason,
      changes: [
        `Add one ${followUpSession.estimatedMinutes}-minute follow-up session.`,
        "Wait before checking the idea again so the result reflects retrieval, not immediate repetition.",
        "Keep the original miss as review evidence until the delayed attempt holds up.",
      ],
      adaptation: null,
      followUpSession,
      reviewPlan: toReviewPlan(followUpSession),
    };
  }

  return {
    kind: "keep_current_plan",
    title: nextSession ? "Keep the current plan" : "Complete this learning item",
    nextTitle: nextSession?.title ?? "This learning item is complete",
    explanation: nextSession
      ? "This result does not justify changing the planned method. YOVA recommends continuing without inventing an adjustment."
      : "There is no remaining session to adjust, and today’s evidence does not require another scheduled check.",
    changes: [],
    adaptation: null,
    followUpSession: null,
    reviewPlan: null,
  };
}

function toReviewPlan(session: LearningPlanSession) {
  return {
    title: session.title,
    scheduledFor: session.scheduledFor,
    estimatedMinutes: session.estimatedMinutes,
    explanation: session.adaptationNote?.explanation ?? session.methodReason,
  };
}

function reviewConcept(session: LearningPlanSession) {
  return session.reviewConcept?.trim() || "the missed concept";
}

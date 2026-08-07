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
  if (adaptation) {
    return {
      kind: "adapt_next_session",
      title: "Adjust the next session",
      nextTitle: adaptation.title,
      explanation: adaptation.explanation,
      changes: [
        `Use ${adaptation.method.toLocaleLowerCase()}.`,
        `Keep the learning target, but change how support begins and fades.`,
        `Build the session around about ${adaptation.estimatedMinutes} minutes of focused work.`,
      ],
      adaptation,
      followUpSession: null,
    };
  }

  const followUpSession = nextSession
    ? null
    : buildDelayedVerificationSession(completedSession, completion);
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
  };
}

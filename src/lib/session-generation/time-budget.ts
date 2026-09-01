import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

/**
 * Time limits how much content can be presented. Completion still depends on
 * attempting the required evidence-producing activities, never on a timer.
 */
export function validateSessionTimeBudget(
  draft: GeneratedSessionDraft,
  estimatedMinutes: number,
) {
  const contentBudget = contentBudgetForMinutes(estimatedMinutes);
  const totalMinutes = draft.activities.reduce((total, activity) => total + activity.estimatedMinutes, 0);
  const requiredMinutes = draft.activities
    .filter((activity) => activity.requiredForCompletion)
    .reduce((total, activity) => total + activity.estimatedMinutes, 0);

  if (requiredMinutes > estimatedMinutes) {
    return `Required content needs ${requiredMinutes} minutes, but the session allows ${estimatedMinutes}. Reduce the current content slice and defer the remainder.`;
  }
  if (totalMinutes > estimatedMinutes + 2) {
    return `The activity sequence needs ${totalMinutes} minutes, which does not fit the ${estimatedMinutes}-minute session.`;
  }

  const durationMaximumActivities = estimatedMinutes <= 15 ? 4 : estimatedMinutes <= 30 ? 5 : 8;
  const immutableLearnMinimum = draft.methodBriefing.learningMode === "learn"
    ? learnFocusedActivityMinimum(draft)
    : 0;
  const maximumActivities = Math.min(8, Math.max(
    durationMaximumActivities,
    immutableLearnMinimum,
  ));
  // schedule_return is a lightweight future-review marker, not a focused
  // activity the learner must complete during this session.
  const focusedActivityCount = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return").length;
  if (focusedActivityCount > maximumActivities) {
    return `A ${estimatedMinutes}-minute session may contain at most ${maximumActivities} focused activities.`;
  }
  const learnerFacingWords = sessionLearnerFacingWordCount(draft);
  if (learnerFacingWords > contentBudget.maximumLearnerFacingWords) {
    return `The session contains ${learnerFacingWords} learner-facing words, which is too much for a ${estimatedMinutes}-minute guided session. Keep this slice under ${contentBudget.maximumLearnerFacingWords} words and defer the rest.`;
  }
  return null;
}

function learnFocusedActivityMinimum(draft: GeneratedSessionDraft) {
  const methodId = draft.methodBriefing.methodId;
  // A few compatibility validators intentionally pass a partial historical
  // draft without a method id or coverage map. They keep the duration cap;
  // only a complete routed Learn session earns recipe-capacity expansion.
  if (!methodId || !draft.coverage?.evidenceMap) return 0;
  const activeIdeaCount = Math.max(1, draft.coverage.evidenceMap.length);
  if (methodId === "self_explanation") {
    const boundedTeachingBlocks = Math.max(1, Math.min(
      activeIdeaCount,
      draft.activities.filter((activity) => (
        activity.methodPhase === "model"
        && (Boolean(activity.teaching) || ("lessonBrief" in activity && Boolean(activity.lessonBrief)))
      )).length,
    ));
    // One ordinary model can teach several bounded ideas. Mixed provenance
    // must instead keep each target/topic in its own teaching block, so its
    // immutable sequence is teaching blocks + typed explains + repair +
    // re-explain + recognition. The global validator still caps this at 8.
    return boundedTeachingBlocks + activeIdeaCount + 3;
  }
  if (methodId === "retrieval_practice") return (activeIdeaCount * 2) + 2;
  if (methodId === "worked_example_fading") {
    return activeIdeaCount === 1 ? 4 : (activeIdeaCount * 2) + 1;
  }
  return methodFidelityContractForPrompt(
    methodId,
    "learn",
  ).requiredPhases.filter((phase) => phase !== "schedule_return").length + 1;
}

export function sessionLearnerFacingWordCount(draft: GeneratedSessionDraft) {
  return draft.activities
    // The return marker is a short scheduling promise shown after the lesson,
    // not part of the content the learner must process in today's window.
    .filter((activity) => activity.methodPhase !== "schedule_return")
    .reduce((total, activity) => (
    total + countWords([
      activity.title,
      activity.body,
      activity.teaching?.keyIdea,
      activity.teaching?.explanation,
      activity.teaching?.example?.setup,
      ...(activity.teaching?.example?.steps ?? []),
      activity.teaching?.example?.takeaway,
      activity.teaching?.commonMistake?.mistake,
      activity.teaching?.commonMistake?.correction,
      ...activity.choices,
      activity.correctAnswer,
      activity.feedback,
    ].filter(Boolean).join(" "))
    ), 0);
}

function countWords(value: string) {
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

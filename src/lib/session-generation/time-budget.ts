import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
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

  const maximumActivities = estimatedMinutes <= 15 ? 4 : estimatedMinutes <= 30 ? 5 : 8;
  if (draft.activities.length > maximumActivities) {
    return `A ${estimatedMinutes}-minute session may contain at most ${maximumActivities} focused activities.`;
  }
  const learnerFacingWords = draft.activities.reduce((total, activity) => (
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
  if (learnerFacingWords > contentBudget.maximumLearnerFacingWords) {
    return `The session contains ${learnerFacingWords} learner-facing words, which is too much for a ${estimatedMinutes}-minute guided session. Keep this slice under ${contentBudget.maximumLearnerFacingWords} words and defer the rest.`;
  }
  return null;
}

function countWords(value: string) {
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

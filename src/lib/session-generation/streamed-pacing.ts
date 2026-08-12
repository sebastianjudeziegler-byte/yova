import type {
  StreamedGeneratedSessionActivity,
  StreamedGeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import { validateMethodFidelity } from "@/lib/learning/method-fidelity";

type PacingActivity = StreamedGeneratedSessionActivity;

export type StreamedTeachingPacingContract = {
  availableMinutes: number;
  activeIdeaCount: number;
  minimumActiveIdeas: number;
  minimumTeachingBlocks: number;
  maximumFocusedActivities: number;
  guidance: string;
};

/**
 * Defines the visible teach -> answer rhythm before the provider is called.
 * One active idea needs one teaching/check cycle. Longer, multi-idea sessions
 * deliberately use more cycles instead of one wall of exposition.
 */
export function streamedTeachingPacingContract({
  availableMinutes,
  activeIdeaCount,
  maximumFocusedActivities: suppliedMaximumFocusedActivities,
  maximumActiveIdeas: suppliedMaximumActiveIdeas,
}: {
  availableMinutes: number;
  activeIdeaCount: number;
  maximumFocusedActivities?: number;
  maximumActiveIdeas?: number;
}): StreamedTeachingPacingContract {
  const durationMaximum = availableMinutes <= 15 ? 4 : availableMinutes <= 30 ? 5 : 8;
  const maximumFocusedActivities = Math.min(
    durationMaximum,
    suppliedMaximumFocusedActivities ?? durationMaximum,
  );
  const desiredTeachingBlocks = availableMinutes <= 15
    ? 1
    : availableMinutes <= 30
      ? 2
      : availableMinutes <= 45
        ? 3
        : 4;
  const maximumActiveIdeas = Math.max(1, Math.min(
    4,
    maximumFocusedActivities - 1,
    suppliedMaximumActiveIdeas ?? 4,
  ));
  const minimumActiveIdeas = Math.min(
    maximumActiveIdeas,
    Math.max(1, activeIdeaCount, desiredTeachingBlocks),
  );
  const minimumTeachingBlocks = Math.min(
    desiredTeachingBlocks,
    minimumActiveIdeas,
    Math.max(1, maximumFocusedActivities - minimumActiveIdeas),
  );
  return {
    availableMinutes,
    activeIdeaCount,
    minimumActiveIdeas,
    minimumTeachingBlocks,
    maximumFocusedActivities,
    guidance: `Write exactly ${minimumActiveIdeas} distinct explanatory ${minimumActiveIdeas === 1 ? "claim" : "claims"} across today's active targets, with every active target represented. Use ${minimumTeachingBlocks} teaching ${minimumTeachingBlocks === 1 ? "block" : "blocks"}. Immediately follow each teaching block with its mapped required question or questions before presenting another teaching block. Do not repeat one claim or lesson brief to fill time. Across today's focused activities, estimatedMinutes must total exactly ${availableMinutes}; a schedule_return marker is for a later day and is excluded from that total.`,
  };
}

/**
 * The provider chooses the semantic work; YOVA owns the final clock. This
 * turns the chosen activity sequence into an integer allocation that exactly
 * matches the learner's selected window whenever that sequence has enough
 * honest capacity. A later validator rejects an under-capacity sequence so it
 * can be repaired with more teaching/check cycles instead of being padded.
 */
export function allocateStreamedTeachingMinutes({
  activities,
  availableMinutes,
}: {
  activities: PacingActivity[];
  availableMinutes: number;
}): PacingActivity[] {
  const focusedIndexes = activities.flatMap((activity, index) => (
    activity.methodPhase === "schedule_return" ? [] : [index]
  ));
  if (focusedIndexes.length === 0) return activities;

  const minimums = focusedIndexes.map((index) => minimumMinutes(activities[index]!));
  const caps = focusedIndexes.map((index, focusedIndex) => Math.max(
    minimums[focusedIndex]!,
    maximumMinutes({
      activity: activities[index]!,
      isFirstFocusedActivity: focusedIndex === 0,
    }),
  ));
  const target = availableMinutes;
  const allocated: number[] = [...minimums];

  let remaining = target - allocated.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < allocated.length; index += 1) {
      if (allocated[index]! >= caps[index]!) continue;
      const score = activityWeight(activities[focusedIndexes[index]!]!) / (allocated[index]! + 1);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    allocated[bestIndex] = allocated[bestIndex]! + 1;
    remaining -= 1;
  }

  const minuteByActivityIndex = new Map(
    focusedIndexes.map((activityIndex, index) => [activityIndex, allocated[index]!] as const),
  );
  return activities.map((activity, index) => (
    minuteByActivityIndex.has(index)
      ? { ...activity, estimatedMinutes: minuteByActivityIndex.get(index)! }
      : activity
  ));
}

/**
 * Converts a semantically complete skeleton into the visible conversation
 * rhythm. Providers sometimes return all lesson briefs first and all checks
 * second. Because the evidence map already identifies each idea's required
 * question, YOVA can pair them deterministically without inventing content.
 */
export function interleaveStreamedTeachingCycles({
  draft,
  availableMinutes,
  maximumFocusedActivities,
}: {
  draft: StreamedGeneratedSessionDraft;
  availableMinutes: number;
  maximumFocusedActivities?: number;
}): StreamedGeneratedSessionDraft {
  if (draft.coverage.evidenceMap.length < 2) return draft;

  const focused = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
  const returns = draft.activities.filter((activity) => activity.methodPhase === "schedule_return");
  const primaryTeaching = focused.find((activity) => activity.type === "instruction" && activity.lessonBrief);
  if (!primaryTeaching || primaryTeaching.type !== "instruction" || !primaryTeaching.lessonBrief) return draft;

  const usedQuestions = new Set<PacingActivity>();
  const cycles: PacingActivity[] = [];
  const contract = streamedTeachingPacingContract({
    availableMinutes,
    activeIdeaCount: draft.coverage.evidenceMap.length,
    maximumFocusedActivities,
  });
  const groups = evidenceGroups(draft.coverage.evidenceMap, contract.minimumTeachingBlocks);
  for (const [position, mappings] of groups.entries()) {
    const questions = mappings.map((mapping) => focused.find((activity) => (
      !usedQuestions.has(activity)
      && isRequiredQuestion(activity)
      && normalize(activity.concept ?? "") === normalize(mapping.activityConcept)
    )));
    if (questions.some((question) => !question)) return draft;
    const resolvedQuestions = questions as PacingActivity[];
    const matchingTeaching = focused.find((activity) => (
      activity.type === "instruction"
      && Boolean(activity.lessonBrief?.essentialIdeas.some((idea) => (
        mappings.some((mapping) => normalize(idea) === normalize(mapping.essentialIdea))
      )))
    ));
    const sourceTeaching = matchingTeaching?.type === "instruction" && matchingTeaching.lessonBrief
      ? matchingTeaching
      : primaryTeaching;
    const sourceLessonBrief = sourceTeaching.lessonBrief;
    if (!sourceLessonBrief) return draft;
    resolvedQuestions.forEach((question) => usedQuestions.add(question));
    const essentialIdeas = mappings.map((mapping) => mapping.essentialIdea);
    const topicIds = [...new Set(resolvedQuestions.flatMap((question) => (
      question.topicId ? [question.topicId] : []
    )))];
    cycles.push({
      ...sourceTeaching,
      // The first block preserves the method's required opening phase. Later
      // content blocks are models presented before their mapped checks.
      methodPhase: position === 0 ? sourceTeaching.methodPhase : "model",
      topicId: topicIds[0] ?? sourceTeaching.topicId,
      label: "Learn",
      title: boundedTitle(`Learn ${essentialIdeas.join(" and ")}`),
      body: "Read this focused explanation, then answer the question that follows before continuing.",
      lessonBrief: {
        ...sourceLessonBrief,
        topicIds: topicIds.length > 0 ? topicIds : sourceLessonBrief.topicIds,
        essentialIdeas,
      },
    }, ...resolvedQuestions);
  }

  const extras = focused.filter((activity) => (
    !usedQuestions.has(activity)
    && !(activity.type === "instruction" && activity.lessonBrief)
  ));
  if (cycles.length + extras.length > contract.maximumFocusedActivities) return draft;

  const candidate = {
    ...draft,
    activities: [...cycles, ...extras, ...returns],
  };
  if (!StreamedGeneratedSessionDraftSchema.safeParse(candidate).success) return draft;
  if (validateMethodFidelity({
    methodId: candidate.methodBriefing.methodId,
    learningMode: "learn",
    activities: candidate.activities,
  })) return draft;
  return candidate;
}

function evidenceGroups<T>(values: T[], groupCount: number) {
  if (groupCount <= 1) return [values];
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  groups[0]!.push(values[0]!);
  values.slice(1).forEach((value, index) => {
    const remainingGroupIndex = Math.min(
      groupCount - 1,
      1 + Math.floor((index * (groupCount - 1)) / Math.max(1, values.length - 1)),
    );
    groups[remainingGroupIndex]!.push(value);
  });
  return groups.filter((group) => group.length > 0);
}

export function validateStreamedTeachingPacing({
  draft,
  availableMinutes,
  maximumFocusedActivities,
}: {
  draft: StreamedGeneratedSessionDraft;
  availableMinutes: number;
  maximumFocusedActivities?: number;
}): string | null {
  const focused = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
  const contract = streamedTeachingPacingContract({
    availableMinutes,
    activeIdeaCount: draft.coverage.essentialIdeas.length,
    maximumFocusedActivities,
  });
  if (focused.length > contract.maximumFocusedActivities) {
    return `This ${availableMinutes}-minute lesson may contain at most ${contract.maximumFocusedActivities} focused teaching and question activities.`;
  }
  if (draft.coverage.essentialIdeas.length < contract.minimumActiveIdeas) {
    return `This ${availableMinutes}-minute lesson needs ${contract.minimumActiveIdeas} distinct explanatory claims so the selected time is filled with real teaching and questions instead of stretching one idea.`;
  }
  const normalizedIdeas = draft.coverage.essentialIdeas.map(normalize);
  if (new Set(normalizedIdeas).size !== normalizedIdeas.length) {
    return "Every active explanatory claim must be distinct; do not duplicate one idea to fill the selected time.";
  }
  const invalidMinimum = focused.find((activity) => activity.estimatedMinutes < minimumMinutes(activity));
  if (invalidMinimum) {
    return `The activity “${invalidMinimum.title}” needs at least ${minimumMinutes(invalidMinimum)} minutes for its assigned teaching or answer work.`;
  }
  const allocatedMinutes = focused.reduce((sum, activity) => sum + activity.estimatedMinutes, 0);
  if (allocatedMinutes !== availableMinutes) {
    return `Today's teaching and questions account for ${allocatedMinutes} minutes, but the learner selected ${availableMinutes}. Add a real teaching/check cycle or reduce the activity sequence so the focused work matches the selected time.`;
  }

  const teachingIndexes = focused.flatMap((activity, index) => (
    activity.type === "instruction" && activity.lessonBrief ? [index] : []
  ));
  if (teachingIndexes.length < contract.minimumTeachingBlocks) {
    return `This ${availableMinutes}-minute lesson needs at least ${contract.minimumTeachingBlocks} interleaved teaching ${contract.minimumTeachingBlocks === 1 ? "block" : "blocks"} for ${draft.coverage.essentialIdeas.length} active ${draft.coverage.essentialIdeas.length === 1 ? "idea" : "ideas"}.`;
  }

  for (const [position, teachingIndex] of teachingIndexes.entries()) {
    const nextTeachingIndex = teachingIndexes[position + 1] ?? focused.length;
    const hasCheckBeforeNextLesson = focused.slice(teachingIndex + 1, nextTeachingIndex).some(isRequiredQuestion);
    if (!hasCheckBeforeNextLesson) {
      return `Teaching block ${position + 1} must be followed by a required question before the next teaching block or the end of the session.`;
    }
  }

  for (const mapping of draft.coverage.evidenceMap) {
    const teachingIndex = focused.findIndex((activity) => (
      activity.type === "instruction"
      && activity.lessonBrief?.essentialIdeas.some((idea) => normalize(idea) === normalize(mapping.essentialIdea))
    ));
    const questionIndex = focused.findIndex((activity) => (
      isRequiredQuestion(activity)
      && normalize(activity.concept ?? "") === normalize(mapping.activityConcept)
    ));
    if (teachingIndex < 0 || questionIndex < 0 || teachingIndex >= questionIndex) {
      return `The active idea “${mapping.essentialIdea}” must be taught in a streamed block before its required question.`;
    }
  }

  return null;
}

function isRequiredQuestion(activity: PacingActivity) {
  return activity.requiredForCompletion
    && (activity.type === "multiple_choice" || activity.type === "free_response");
}

function minimumMinutes(activity: PacingActivity) {
  if (activity.type === "instruction") {
    const ideaCount = activity.lessonBrief?.essentialIdeas.length ?? 1;
    if (ideaCount >= 3) return 11;
    if (ideaCount === 2) return 6;
    return 3;
  }
  if (activity.type === "free_response") return 2;
  if (activity.type === "multiple_choice") return 2;
  return 1;
}

function maximumMinutes({
  activity,
  isFirstFocusedActivity,
}: {
  activity: PacingActivity;
  isFirstFocusedActivity: boolean;
}) {
  if (activity.type === "instruction" && isFirstFocusedActivity) {
    return Math.max(3, activity.estimatedMinutes);
  }
  if (activity.type === "instruction") return 20;
  if (activity.type === "free_response") return 12;
  if (activity.type === "multiple_choice") return 6;
  return 3;
}

function activityWeight(activity: PacingActivity) {
  if (activity.type === "instruction") return 6;
  if (activity.type === "free_response") return 5;
  if (activity.type === "multiple_choice") return 3;
  return 2;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function boundedTitle(value: string) {
  if (value.length <= 140) return value;
  const shortened = value.slice(0, 140);
  const lastSpace = shortened.lastIndexOf(" ");
  return shortened.slice(0, lastSpace > 90 ? lastSpace : 140).trimEnd();
}

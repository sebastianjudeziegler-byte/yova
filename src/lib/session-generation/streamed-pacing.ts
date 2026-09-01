import type {
  StreamedGeneratedSessionActivity,
  StreamedGeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import { StreamedGeneratedSessionDraftSchema } from "@/lib/session-generation/schema";
import {
  methodFidelityContractForPrompt,
  validateMethodFidelity,
} from "@/lib/learning/method-fidelity";
import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { lessonIdeaCapacityForMinutes } from "@/lib/session-generation/lesson-brief";
import { sessionLearnerFacingWordCount } from "@/lib/session-generation/time-budget";
import type { CoreMethodId } from "@/lib/learning/method-catalog";

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
  methodId,
  reservePostMethodRecognition = false,
}: {
  availableMinutes: number;
  activeIdeaCount: number;
  maximumFocusedActivities?: number;
  maximumActiveIdeas?: number;
  methodId?: CoreMethodId;
  reservePostMethodRecognition?: boolean;
}): StreamedTeachingPacingContract {
  const durationMaximum = availableMinutes <= 15 ? 4 : availableMinutes <= 30 ? 5 : 8;
  const requiredMethodActivities = methodId
    ? methodFidelityContractForPrompt(methodId, "learn").requiredPhases
      .filter((phase) => phase !== "schedule_return").length
    : 0;
  const immutableLearnMinimum = reservePostMethodRecognition
    ? Math.min(8, requiredMethodActivities + 1)
    : 0;
  const maximumFocusedActivities = reservePostMethodRecognition
    ? Math.min(8, Math.max(
      suppliedMaximumFocusedActivities ?? durationMaximum,
      immutableLearnMinimum,
    ))
    : Math.min(durationMaximum, suppliedMaximumFocusedActivities ?? durationMaximum);
  const desiredTeachingBlocks = availableMinutes <= 15
    ? 1
    : availableMinutes <= 30
      ? 2
      : availableMinutes <= 45
        ? 3
        : 4;
  const recognitionActivityCount = reservePostMethodRecognition && methodId ? 1 : 0;
  const methodExtraActivities = methodId === "self_explanation"
    ? 2 + recognitionActivityCount
    : methodId === "retrieval_practice"
      ? 1 + recognitionActivityCount
      : recognitionActivityCount;
  const methodCycleCapacity = methodId === undefined
    ? 4
    : methodId === "self_explanation"
      ? Math.max(1, maximumFocusedActivities - 3 - recognitionActivityCount)
      : methodId === "retrieval_practice"
        ? Math.max(1, Math.floor((maximumFocusedActivities - 1 - recognitionActivityCount) / 2))
      : Math.max(1, Math.floor((maximumFocusedActivities - recognitionActivityCount) / 2));
  const maximumActiveIdeas = Math.max(1, Math.min(
    4,
    maximumFocusedActivities - 1,
    methodCycleCapacity,
    suppliedMaximumActiveIdeas ?? 4,
  ));
  const minimumActiveIdeas = Math.min(
    maximumActiveIdeas,
    Math.max(1, activeIdeaCount, desiredTeachingBlocks),
  );
  const minimumTeachingBlocks = Math.min(
    desiredTeachingBlocks,
    minimumActiveIdeas,
    Math.max(1, maximumFocusedActivities - minimumActiveIdeas - methodExtraActivities),
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
  maximumFirstActionMinutes,
}: {
  activities: PacingActivity[];
  availableMinutes: number;
  maximumFirstActionMinutes?: number;
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
      maximumFirstActionMinutes,
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
  maximumFirstActionMinutes,
}: {
  draft: StreamedGeneratedSessionDraft;
  availableMinutes: number;
  maximumFocusedActivities?: number;
  maximumFirstActionMinutes?: number;
}): StreamedGeneratedSessionDraft {
  if (draft.coverage.evidenceMap.length < 2) return draft;

  const focused = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
  const returns = draft.activities.filter((activity) => activity.methodPhase === "schedule_return");
  const primaryTeaching = focused.find((activity) => activity.type === "instruction" && activity.lessonBrief);
  if (!primaryTeaching || primaryTeaching.type !== "instruction" || !primaryTeaching.lessonBrief) return draft;

  const usedQuestions = new Set<PacingActivity>();
  const cycles: PacingActivity[] = [];
  const hasPostMethodRecognition = focused.some((activity) => (
    activity.methodPhase === "transfer"
    && activity.type === "multiple_choice"
    && activity.requiredForCompletion
  ));
  const contract = streamedTeachingPacingContract({
    availableMinutes,
    activeIdeaCount: draft.coverage.evidenceMap.length,
    maximumFocusedActivities,
    methodId: draft.methodBriefing.methodId,
    reservePostMethodRecognition: hasPostMethodRecognition,
  });
  // A delivery-policy cap applies to whichever teaching block becomes first
  // after interleaving, not merely to the provider's original first activity.
  // When that opening block cannot honestly hold every active idea, split the
  // lesson into another teach -> answer cycle before allocating minutes.
  const openingIdeaCapacity = maximumFirstActionMinutes === undefined
    ? draft.coverage.evidenceMap.length
    : lessonIdeaCapacityForMinutes(maximumFirstActionMinutes);
  const requiredTeachingBlocks = draft.coverage.evidenceMap.length > openingIdeaCapacity
    ? Math.max(2, contract.minimumTeachingBlocks)
    : contract.minimumTeachingBlocks;
  const availableTeachingSlots = contract.maximumFocusedActivities - draft.coverage.evidenceMap.length;
  if (requiredTeachingBlocks > availableTeachingSlots) return draft;
  const groups = evidenceGroups(draft.coverage.evidenceMap, requiredTeachingBlocks);
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
      title: boundedGeneratedActivityTitle(`Learn ${essentialIdeas.join(" and ")}`),
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
  const availableExtraSlots = contract.maximumFocusedActivities - cycles.length;
  if (availableExtraSlots < 0) return draft;
  const requiredPhases = methodFidelityContractForPrompt(
    draft.methodBriefing.methodId,
    "learn",
  ).requiredPhases;
  const selectedExtras = new Set<PacingActivity>();
  for (const phase of requiredPhases) {
    if (cycles.some((activity) => activity.methodPhase === phase)) continue;
    const requiredExtra = extras.find((activity) => (
      activity.methodPhase === phase && !selectedExtras.has(activity)
    ));
    if (requiredExtra) selectedExtras.add(requiredExtra);
  }
  if (selectedExtras.size > availableExtraSlots) return draft;
  for (const extra of extras) {
    if (selectedExtras.size >= availableExtraSlots) break;
    if (extra.requiredForCompletion) selectedExtras.add(extra);
  }
  for (const extra of extras) {
    if (selectedExtras.size >= availableExtraSlots) break;
    selectedExtras.add(extra);
  }
  const boundedExtras = extras.filter((activity) => selectedExtras.has(activity));

  const candidate = {
    ...draft,
    activities: [...cycles, ...boundedExtras, ...returns],
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
  const hasPostMethodRecognition = focused.some((activity) => (
    activity.methodPhase === "transfer"
    && activity.type === "multiple_choice"
    && activity.requiredForCompletion
  ));
  const contract = streamedTeachingPacingContract({
    availableMinutes,
    activeIdeaCount: draft.coverage.essentialIdeas.length,
    maximumFocusedActivities,
    methodId: draft.methodBriefing.methodId,
    reservePostMethodRecognition: hasPostMethodRecognition,
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

/**
 * Streamed teaching delivers its real explanation later from lessonBrief, so
 * an overlong skeleton is almost always verbose scaffolding, question copy,
 * or feedback. Bound those learner-facing fields deterministically after the
 * semantic sequence is assembled. The authoritative teaching claims and
 * evidence mapping remain byte-for-byte unchanged.
 */
export function compactStreamedLearnerTextToBudget({
  draft,
  availableMinutes,
}: {
  draft: StreamedGeneratedSessionDraft;
  availableMinutes: number;
}): StreamedGeneratedSessionDraft {
  const maximumWords = contentBudgetForMinutes(availableMinutes).maximumLearnerFacingWords;
  if (sessionLearnerFacingWordCount(draft) <= maximumWords) return draft;

  const activities = draft.activities.map((activity) => {
    if (activity.methodPhase === "schedule_return") return activity;
    const shared = {
      ...activity,
      title: boundedWords(activity.title, 14),
      body: boundedWords(
        activity.body,
        activity.type === "multiple_choice" || activity.type === "free_response" ? 36 : 22,
      ),
    };
    if (activity.type === "multiple_choice") {
      const correctIndex = activity.choices.indexOf(activity.correctAnswer ?? "");
      const choices = activity.choices.map((choice) => boundedWords(choice, 16));
      if (new Set(choices.map(normalize)).size !== choices.length) return shared;
      return {
        ...shared,
        choices,
        correctAnswer: correctIndex >= 0 ? choices[correctIndex]! : activity.correctAnswer,
        feedback: activity.feedback ? boundedWords(activity.feedback, 34) : null,
      };
    }
    if (activity.type === "free_response") {
      return {
        ...shared,
        correctAnswer: activity.correctAnswer ? boundedWords(activity.correctAnswer, 65) : null,
        feedback: activity.feedback ? boundedWords(activity.feedback, 34) : null,
      };
    }
    return shared;
  });
  const compacted = StreamedGeneratedSessionDraftSchema.safeParse({ ...draft, activities });
  return compacted.success && sessionLearnerFacingWordCount(compacted.data) <= maximumWords
    ? compacted.data
    : draft;
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
  maximumFirstActionMinutes,
}: {
  activity: PacingActivity;
  isFirstFocusedActivity: boolean;
  maximumFirstActionMinutes?: number;
}) {
  if (activity.type === "instruction" && isFirstFocusedActivity) {
    const providerCap = Math.max(3, activity.estimatedMinutes);
    return maximumFirstActionMinutes === undefined
      ? providerCap
      : Math.min(providerCap, maximumFirstActionMinutes);
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

function boundedWords(value: string, maximumWords: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const matches = [...normalized.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)];
  if (matches.length <= maximumWords) return normalized;
  const finalMatch = matches[maximumWords - 1]!;
  const phrasePrefix = normalized.slice(0, finalMatch.index + finalMatch[0].length);
  const sentenceBoundary = Math.max(
    phrasePrefix.lastIndexOf(". "),
    phrasePrefix.lastIndexOf("? "),
    phrasePrefix.lastIndexOf("! "),
    phrasePrefix.lastIndexOf("; "),
  );
  const minimumUsefulBoundary = Math.floor(phrasePrefix.length * 0.6);
  const bounded = sentenceBoundary >= minimumUsefulBoundary
    ? phrasePrefix.slice(0, sentenceBoundary + 1)
    : phrasePrefix;
  return `${bounded.trimEnd().replace(/[\s,:;.!?—–-]+$/g, "")}…`;
}

const GENERATED_ACTIVITY_TITLE_MAX_LENGTH = 140;
const MINIMUM_USEFUL_TITLE_BOUNDARY = 48;
const TRAILING_CONNECTOR = /(?:^|\s)(?:a|an|the|and|or|but|for|nor|so|yet|to|of|in|on|at|by|with|from|into|through|during|without|under|over|between|among|around|as|than|that|which|who|whose|when|where|while|because)$/i;

/**
 * The activity schema deliberately keeps a 140-character title ceiling. When
 * YOVA synthesizes a heading from complete explanatory claims, shorten only
 * the heading at a readable phrase boundary; the claims in lessonBrief remain
 * complete and continue through the existing semantic validators unchanged.
 */
export function boundedGeneratedActivityTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= GENERATED_ACTIVITY_TITLE_MAX_LENGTH) return normalized;

  // Reserve one character for an ellipsis so a shortened heading is visibly
  // abbreviated rather than looking like a malformed complete sentence.
  const prefix = normalized.slice(0, GENERATED_ACTIVITY_TITLE_MAX_LENGTH);
  const phraseLimit = GENERATED_ACTIVITY_TITLE_MAX_LENGTH - 1;
  const phrasePrefix = prefix.slice(0, phraseLimit);
  const sentenceBoundary = lastBoundaryIndex(phrasePrefix, /[.!?;](?=\s|$)/g, true);
  const clauseBoundary = lastBoundaryIndex(phrasePrefix, /[:,]|[—–](?=\s|$)/g, false);
  const connectorBoundary = lastBoundaryIndex(
    phrasePrefix,
    /\s(?:and|but|while|whereas|because|so that|which|who|when)\s/gi,
    false,
  );
  const boundary = [sentenceBoundary, clauseBoundary, connectorBoundary]
    .find((candidate) => candidate >= MINIMUM_USEFUL_TITLE_BOUNDARY) ?? -1;
  const lastWordBoundary = phrasePrefix.lastIndexOf(" ");

  let shortened = boundary >= MINIMUM_USEFUL_TITLE_BOUNDARY
    ? phrasePrefix.slice(0, boundary)
    : lastWordBoundary >= MINIMUM_USEFUL_TITLE_BOUNDARY
      ? phrasePrefix.slice(0, lastWordBoundary)
      : phrasePrefix;
  shortened = shortened.trimEnd().replace(/[\s,:;.!?—–-]+$/g, "");

  // With prose that contains no punctuation or clause marker, the word
  // boundary fallback must still avoid visibly dangling function words.
  while (shortened.length > MINIMUM_USEFUL_TITLE_BOUNDARY && TRAILING_CONNECTOR.test(shortened)) {
    shortened = shortened.slice(0, shortened.lastIndexOf(" ")).trimEnd();
  }

  return `${shortened}…`;
}

function lastBoundaryIndex(value: string, pattern: RegExp, includeMatch: boolean) {
  let boundary = -1;
  for (const match of value.matchAll(pattern)) {
    boundary = match.index + (includeMatch ? match[0].length : 0);
  }
  return boundary;
}

import { CalendarReasonSchema, CalendarPrototypeStateSchema } from "@/lib/calendar/types";
import type { SessionCompletion, SessionInterruption } from "@/lib/domain";
import {
  canonicalLearnerProfileFromAnswers,
} from "@/lib/personalization/canonical-profile-storage";
import { readPersonalizationStateFromAnswers } from "@/lib/personalization/personalization-state";
import {
  canonicalProfileSignal,
  type CanonicalProfileSignalId,
} from "@/lib/personalization/canonical-profile-schema";
import { resolveLearnerPersonalization } from "@/lib/personalization/personalization-evidence";
import type {
  CalendarBlock,
  CalendarModel,
  CalendarModelInput,
  CalendarReason,
  MilestoneCalendarBlock,
  PlanSessionCalendarBlock,
  PreviewCourseSeed,
  SuggestedCalendarBlock,
} from "@/lib/calendar/types";
import {
  deriveCalendarDayLoads,
  deriveCalendarIssues,
  deriveCalendarOutcomes,
  effectiveCalendarPlanDeadline,
} from "@/lib/calendar/insights";
import {
  resolveExecutedStudyRouteSessionContract,
  resolveStudyRouteSessionContract,
} from "@/lib/study-route/selectors";

export function deriveCalendarModel(input: CalendarModelInput): CalendarModel {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Calendar derivation requires a valid current time.");
  const timeZone = validTimeZone(input.timeZone ?? "UTC");
  const localState = CalendarPrototypeStateSchema.parse(input.localState);
  const executedSessionIds = new Set(input.executedSessionIds ?? []);
  const planBlocks = input.plans
    .filter((plan) => plan.status !== "draft" && plan.status !== "archived")
    .flatMap((plan) => plan.sessions
      .filter((session) => session.status !== "skipped")
      .map((session): PlanSessionCalendarBlock => {
        const contract = executedSessionIds.has(session.id)
          ? resolveExecutedStudyRouteSessionContract(plan, session)
          : resolveStudyRouteSessionContract(plan, session);
        const authoritativePlan = contract.plan;
        const authoritativeSession = contract.session;
        const startsAt = authoritativeSession.scheduledFor;
        return {
          id: `plan-session:${authoritativeSession.id}`,
          source: "plan_session",
          blockType: "yova",
          title: authoritativeSession.title,
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + authoritativeSession.estimatedMinutes * 60_000).toISOString(),
          done: authoritativeSession.status === "complete",
          fixed: false,
          courseId: authoritativePlan.learningItemId,
          courseLabel: authoritativePlan.title,
          outcomeId: `outcome:plan:${authoritativePlan.id}`,
          plan: authoritativePlan,
          session: authoritativeSession,
          learningMode: authoritativeSession.learningMode,
          methodName: authoritativeSession.method,
          methodReason: authoritativeSession.methodReason,
          placementReason: planSessionPlacementReason(
            authoritativePlan,
            authoritativeSession,
            effectiveCalendarPlanDeadline(authoritativePlan, input.milestones),
            localState.changeLog,
            timeZone,
          ),
          flexibility: "movable",
        };
      }));

  const planByLearningItem = new Map(input.plans.map((plan) => [plan.learningItemId, plan]));
  const milestoneBlocks = input.milestones.map((milestone): MilestoneCalendarBlock => {
    const linkedPlan = milestone.linkedLearningItemId
      ? planByLearningItem.get(milestone.linkedLearningItemId) ?? null
      : null;
    return {
      id: `milestone:${milestone.id}`,
      source: "milestone",
      blockType: /\b(exam|test|quiz|midterm|final)\b/i.test(milestone.title) ? "exam" : "deadline",
      title: milestone.title,
      startsAt: milestone.dueAt,
      endsAt: new Date(Date.parse(milestone.dueAt) + 60_000).toISOString(),
      done: milestone.status === "completed",
      fixed: true,
      courseId: milestone.linkedLearningItemId,
      courseLabel: linkedPlan?.title ?? null,
      outcomeId: linkedPlan ? `outcome:plan:${linkedPlan.id}` : `outcome:milestone:${milestone.id}`,
      milestone,
    };
  });

  const manualBlocks = localState.manualEvents.map((event) => ({
    id: `manual:${event.id}`,
    source: "manual" as const,
    blockType: event.eventType,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    done: event.done,
    fixed: event.fixed,
    courseId: event.courseId,
    courseLabel: event.courseLabel,
    outcomeId: event.outcomeId,
    event,
  }));

  const suggestionBlocks = localState.suggestions.flatMap<SuggestedCalendarBlock>((suggestion) => {
    if (suggestion.status === "dismissed" || !suggestion.startsAt) return [];
    return [{
      id: `suggestion:${suggestion.id}`,
      source: "suggestion",
      blockType: "suggested",
      title: suggestion.title,
      startsAt: suggestion.startsAt,
      endsAt: new Date(Date.parse(suggestion.startsAt) + suggestion.durationMinutes * 60_000).toISOString(),
      done: false,
      fixed: suggestion.flexibility === "pinned",
      courseId: suggestion.courseId,
      courseLabel: courseLabelForSuggestion(suggestion.planId, suggestion.courseId, input.plans),
      outcomeId: suggestion.outcomeId,
      suggestion,
      placementReason: suggestion.reason,
      flexibility: suggestion.flexibility,
    }];
  });

  const blocks: CalendarBlock[] = [
    ...planBlocks,
    ...milestoneBlocks,
    ...manualBlocks,
    ...suggestionBlocks,
  ].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.id.localeCompare(right.id));
  const dayLoads = deriveCalendarDayLoads(blocks, localState.availabilityOverrides, timeZone);
  const issues = deriveCalendarIssues({
    plans: input.plans,
    milestones: input.milestones,
    blocks,
    dayLoads,
    materials: input.materials ?? [],
    importedItems: input.importedItems ?? [],
    suggestions: localState.suggestions,
    availabilityOverrides: localState.availabilityOverrides,
    now,
    timeZone,
  });
  const completedSessionIds = new Set([
    ...(input.completions ?? []).map((completion) => completion.planSessionId),
    ...input.plans.flatMap((plan) => plan.sessions
      .filter((session) => session.status === "complete")
      .map((session) => session.id)),
  ]);
  const outcomes = deriveCalendarOutcomes({
    plans: input.plans,
    milestones: input.milestones,
    manualEvents: localState.manualEvents,
    completedSessionIds,
    issues,
    now,
  });

  return {
    blocks,
    outcomes,
    issues,
    dayLoads,
    whyThisWeek: whyThisWeek({
      reasons: input.personalizationReasons ?? [],
      outcomes,
      availabilityOverrides: localState.availabilityOverrides,
      timeZone,
      now,
    }),
  };
}

function planSessionPlacementReason(
  plan: CalendarModelInput["plans"][number],
  session: CalendarModelInput["plans"][number]["sessions"][number],
  effectiveDeadline: string | null,
  changes: CalendarModelInput["localState"]["changeLog"],
  timeZone: string,
): CalendarReason {
  const latestChange = [...changes].reverse().find((entry) => (
    entry.undoneAt === null
    && entry.undo.kind === "session_schedule"
    && entry.undo.planId === plan.id
    && entry.undo.planSessionId === session.id
    && sameMinute(entry.undo.to, session.scheduledFor)
  ));
  if (latestChange) {
    return CalendarReasonSchema.parse({
      text: latestChange.reason,
      source: latestChange.origin === "automatic" ? "automatic_change" : "learner_choice",
      evidenceRefs: [latestChange.id, plan.id, session.id],
    });
  }

  const sessionPosition = `session ${session.sequence} of ${plan.sessions.length}`;
  if (effectiveDeadline) {
    const sessionEndsBeforeDeadline = Date.parse(session.scheduledFor)
      + session.estimatedMinutes * 60_000
      <= Date.parse(effectiveDeadline);
    return CalendarReasonSchema.parse({
      text: sessionEndsBeforeDeadline
        ? `This is ${sessionPosition}; its saved time preserves the plan order and ends before the ${formatDate(effectiveDeadline, timeZone)} deadline.`
        : `This is ${sessionPosition}; its saved time preserves the plan order, but it currently ends after the ${formatDate(effectiveDeadline, timeZone)} deadline and needs review.`,
      source: "plan_sequence",
      evidenceRefs: [plan.id, session.id, effectiveDeadline],
    });
  }
  return CalendarReasonSchema.parse({
    text: `This is ${sessionPosition}, so its saved time preserves the learning sequence before the next unfinished session.`,
    source: "plan_sequence",
    evidenceRefs: [plan.id, session.id],
  });
}

function whyThisWeek(input: {
  reasons: readonly CalendarReason[];
  outcomes: CalendarModel["outcomes"];
  availabilityOverrides: CalendarModelInput["localState"]["availabilityOverrides"];
  timeZone: string;
  now: Date;
}) {
  const reasons = input.reasons.flatMap<CalendarReason>((candidate) => {
    const parsed = CalendarReasonSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  for (const override of input.availabilityOverrides
    .filter((item) => Date.parse(`${item.dateKey}T23:59:59Z`) >= input.now.getTime() - 24 * 60 * 60_000)
    .slice(0, 2)) {
    reasons.push(CalendarReasonSchema.parse({
      text: override.reason,
      source: "availability",
      evidenceRefs: [`availability:${override.dateKey}`],
    }));
  }
  const nearest = input.outcomes.find((outcome) => outcome.status !== "complete");
  if (nearest) {
    reasons.push(CalendarReasonSchema.parse({
      text: `${nearest.title} is the nearest open outcome, due ${formatDate(nearest.dueAt, input.timeZone)}, so its remaining preparation stays visible this week.`,
      source: "deadline",
      evidenceRefs: [nearest.id, nearest.dueAt],
    }));
  }
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = reason.text.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function courseLabelForSuggestion(
  planId: string | null,
  courseId: string | null,
  plans: CalendarModelInput["plans"],
) {
  return plans.find((plan) => plan.id === planId || plan.learningItemId === courseId)?.title ?? null;
}

const EMPTY_PREVIEW_COURSES: readonly PreviewCourseSeed[] = Object.freeze([
  Object.freeze({ id: "preview-world-history", label: "World History", provenance: "empty_preview_seed" as const }),
  Object.freeze({ id: "preview-communications", label: "Communications", provenance: "empty_preview_seed" as const }),
  Object.freeze({ id: "preview-public-speaking", label: "Public Speaking", provenance: "empty_preview_seed" as const }),
  Object.freeze({ id: "preview-international-relations", label: "International Relations", provenance: "empty_preview_seed" as const }),
]);

/**
 * These labels exist only to make an otherwise empty browser preview useful.
 * The caller must prove that no authoritative or manually entered calendar
 * data exists; signed-in learners never receive fabricated course records.
 */
export function previewCourseSeedsForEmptyState(input: {
  previewMode: boolean;
  authoritativePlanCount: number;
  manualEventCount: number;
  outcomeCount?: number;
}): readonly PreviewCourseSeed[] {
  return input.previewMode
    && input.authoritativePlanCount === 0
    && input.manualEventCount === 0
    && (input.outcomeCount ?? 0) === 0
    ? EMPTY_PREVIEW_COURSES
    : [];
}

/**
 * Produces only evidence-backed calendar explanations. Direct answers retain
 * their canonical signal provenance, while behavioral statements cite the
 * exact completion or interruption records used. The copy recommends; it
 * never claims that YOVA moved a learner's calendar without approval.
 */
export function calendarPersonalizationReasons(input: {
  answers: readonly string[];
  completions: readonly SessionCompletion[];
  interruptions: readonly SessionInterruption[];
  now?: Date;
  timeZone?: string;
}): CalendarReason[] {
  const timeZone = validTimeZone(input.timeZone ?? "UTC");
  const personalizationState = readPersonalizationStateFromAnswers([...input.answers]);
  const profile = canonicalLearnerProfileFromAnswers(input.answers);
  const reasons: CalendarReason[] = [];
  const excludedEvidenceRefs = new Set(personalizationState.excludedEvidenceRefs);
  const behaviorCompletions = personalizationState.controls.behavior
    ? input.completions.filter((completion) => !excludedEvidenceRefs.has(completion.id))
    : [];
  const behaviorInterruptions = personalizationState.controls.behavior
    ? input.interruptions.filter((interruption) => !excludedEvidenceRefs.has(interruption.id))
    : [];
  if (personalizationState.controls.selfReport && personalizationState.controls.timing) pushCanonicalReason(reasons, profile, personalizationState, "preferred_working_period", (value) => {
    const labels: Record<string, string> = {
      morning: "mornings",
      afternoon: "afternoons",
      evening: "evenings",
      late_night: "late nights",
      varies: "different times depending on the day",
      not_sure: "an unsettled working period",
    };
    const label = labels[value] ?? "the time you selected";
    return value === "not_sure"
      ? null
      : `You told YOVA that ${label} usually offer the most usable energy, so that period may be recommended for flexible work but nothing moves without your approval.`;
  });
  if (personalizationState.controls.selfReport) pushCanonicalReason(reasons, profile, personalizationState, "realistic_session_length", (value) => {
    const labels: Record<string, string> = {
      minutes_10_15: "10–15 minutes",
      minutes_20_30: "20–30 minutes",
      minutes_30_45: "30–45 minutes",
      minutes_45_60: "45–60 minutes",
      depends: "a task-dependent length",
      not_sure: "an unsettled session length",
    };
    const label = labels[value] ?? "the duration you selected";
    return value === "not_sure"
      ? null
      : `You described ${label} as a realistic session length, so YOVA should keep optional work near that range unless the task or deadline requires a different size.`;
  });
  if (personalizationState.controls.selfReport) pushCanonicalReason(reasons, profile, personalizationState, "focus_pacing", (value) => {
    const copies: Record<string, string | null> = {
      steady_block: "You prefer a steady block, so YOVA should avoid unnecessary activity changes in flexible work.",
      clear_checkpoints: "You asked for clear checkpoints, so longer flexible blocks should keep visible stopping points.",
      shorter_blocks: "You asked for shorter blocks, so YOVA should suggest a smaller first block before extending the work.",
      activity_changes: "You said planned activity changes help focus, so flexible blocks may include bounded transitions without changing the objective.",
      short_blocks_with_changes: "You asked for short blocks with planned activity changes, so YOVA should use both only when the task still fits.",
      depends: "You said useful pacing depends on the task, so YOVA should explain each suggestion instead of applying one fixed pattern.",
      not_sure: null,
    };
    return copies[value] ?? null;
  });
  if (personalizationState.controls.selfReport) pushCanonicalReason(reasons, profile, personalizationState, "starting_friction", (value) => {
    const copies: Record<string, string | null> = {
      starts_as_planned: "You reported usually starting as planned, so YOVA does not need to add an earlier artificial start.",
      sometimes_delays: "You reported sometimes delaying a start, so a flexible block may begin with one small action rather than a larger invented buffer.",
      often_delays: "You reported often delaying a start, so YOVA may recommend a smaller opening while preserving the full deadline target.",
      unclear_first_step: "You said an unclear first step can block starting, so scheduled work should name the first concrete action.",
      often_waits_for_pressure: "You said deadline pressure often triggers the start, so YOVA should keep the nearest outcome and its remaining blocks visible.",
      depends: "You said starting friction depends on the task, so YOVA should explain each calendar suggestion rather than infer a fixed habit.",
      not_sure: null,
    };
    return copies[value] ?? null;
  });

  const recentCompletions = personalizationState.controls.timing ? [...behaviorCompletions]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, 6) : [];
  if (recentCompletions.length >= 2) {
    const actual = Math.round(recentCompletions.reduce((sum, item) => sum + item.actualMinutes, 0) / recentCompletions.length);
    const planned = Math.round(recentCompletions.reduce((sum, item) => sum + item.plannedMinutes, 0) / recentCompletions.length);
    reasons.push(CalendarReasonSchema.parse({
      text: `Your last ${recentCompletions.length} completed sessions averaged ${actual} minutes against ${planned} planned, so flexible block suggestions should stay close to the duration you actually sustained.`,
      source: "completion_history",
      evidenceRefs: recentCompletions.map((completion) => completion.id),
    }));
  }

  const resolution = resolveLearnerPersonalization({
    answers: input.answers,
    completions: behaviorCompletions,
    interruptions: behaviorInterruptions,
    plans: [],
    now: input.now ?? new Date(),
    timeZone,
  });
  const observedTiming = resolution.signals.find((signal) => (
    personalizationState.controls.behavior
    && personalizationState.controls.timing
    && signal.key === "energy_window"
    && !signal.paused
    && (signal.source === "observation" || signal.source === "blended")
    && signal.evidenceRefs.length > 0
  ));
  if (observedTiming) {
    reasons.push(CalendarReasonSchema.parse({
      text: `${observedTiming.value}. ${observedTiming.explanation}`,
      source: "completion_history",
      evidenceRefs: [observedTiming.id, ...observedTiming.evidenceRefs].slice(0, 12),
    }));
  }

  const recentEarlyInterruptions = personalizationState.controls.timing ? [...behaviorInterruptions]
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt))
    .slice(0, 6)
    .filter((interruption) => interruption.totalSteps > 0
      ? interruption.completedSteps / interruption.totalSteps < 0.75
      : interruption.plannedMinutes > 0 && interruption.actualMinutes < interruption.plannedMinutes * 0.75) : [];
  if (recentEarlyInterruptions.length >= 2) {
    reasons.push(CalendarReasonSchema.parse({
      text: `${recentEarlyInterruptions.length} recent sessions ended before three quarters of the work was complete, so YOVA may suggest a smaller opening or clearer resume point without treating that as evidence about ability.`,
      source: "completion_history",
      evidenceRefs: recentEarlyInterruptions.map((interruption) => interruption.id),
    }));
  }

  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = reason.text.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function pushCanonicalReason<SignalId extends CanonicalProfileSignalId>(
  reasons: CalendarReason[],
  profile: ReturnType<typeof canonicalLearnerProfileFromAnswers>,
  personalizationState: ReturnType<typeof readPersonalizationStateFromAnswers>,
  signalId: SignalId,
  copy: (value: string) => string | null,
) {
  const personalizationSignalId = `signal:${signalId}`;
  if (personalizationState.pausedSignalIds.includes(personalizationSignalId)) return;
  const correction = personalizationState.corrections.find((item) => item.signalId === personalizationSignalId);
  // A concrete correction may not yet have been consolidated into an older
  // stored canonical profile. Omit the stale claim until the corrected
  // canonical signal is saved instead of displaying the superseded answer.
  if (correction?.doNotInfer || correction?.correctedValue?.trim()) return;
  const signal = canonicalProfileSignal(profile, signalId);
  if (!signal) return;
  const text = copy(signal.value);
  if (!text) return;
  reasons.push(CalendarReasonSchema.parse({
    text,
    source: "learner_profile",
    evidenceRefs: [`signal:${signal.signalId}:${signal.sourceQuestionId}`],
  }));
}

function sameMinute(left: string, right: string) {
  return Math.floor(Date.parse(left) / 60_000) === Math.floor(Date.parse(right) / 60_000);
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

import type { DeadlineMilestone, LearningPlan } from "@/lib/domain";
import { isOperationalPlan } from "@/lib/learning/plan-visibility";
import { isSessionOverdue } from "@/lib/scheduling/recovery";
import type {
  CalendarAvailabilityOverride,
  CalendarBlock,
  CalendarChangeLogEntry,
  CalendarDayLoad,
  CalendarImportedItem,
  CalendarIssue,
  CalendarMaterialState,
  CalendarOutcome,
  CalendarPrototypeState,
  CalendarSuggestion,
  ManualCalendarEvent,
} from "@/lib/calendar/types";

export function deriveCalendarDayLoads(
  blocks: readonly CalendarBlock[],
  overrides: readonly CalendarAvailabilityOverride[],
  timeZone: string,
): CalendarDayLoad[] {
  const overrideByDate = new Map(overrides.map((override) => [override.dateKey, override]));
  const byDate = new Map<string, CalendarBlock[]>();
  for (const block of blocks) {
    if (block.source === "milestone") continue;
    const dateKey = calendarDateKey(block.startsAt, timeZone);
    const current = byDate.get(dateKey) ?? [];
    current.push(block);
    byDate.set(dateKey, current);
  }
  for (const dateKey of overrideByDate.keys()) {
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
  }

  return [...byDate.entries()].map(([dateKey, dayBlocks]) => {
    const workBlocks = dayBlocks.filter(countsTowardFlexibleLoad);
    const plannedMinutes = workBlocks.reduce((sum, block) => sum + blockMinutes(block), 0);
    const fixedMinutes = dayBlocks
      .filter((block) => block.fixed)
      .reduce((sum, block) => sum + blockMinutes(block), 0);
    const availableMinutes = overrideByDate.get(dateKey)?.availableMinutes ?? null;
    const overloaded = availableMinutes === null
      ? plannedMinutes > 75 || workBlocks.length >= 3
      : plannedMinutes > availableMinutes;
    const level = loadLevel(plannedMinutes, workBlocks.length, availableMinutes, overloaded);
    return {
      dateKey,
      plannedMinutes,
      fixedMinutes,
      availableMinutes,
      blockCount: dayBlocks.length,
      level,
      overloaded,
    };
  }).sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

export function deriveCalendarIssues(input: {
  plans: readonly LearningPlan[];
  milestones: CalendarModelMilestones;
  blocks: readonly CalendarBlock[];
  dayLoads: readonly CalendarDayLoad[];
  materials: readonly CalendarMaterialState[];
  importedItems: readonly CalendarImportedItem[];
  suggestions: readonly CalendarSuggestion[];
  availabilityOverrides: readonly CalendarAvailabilityOverride[];
  now: Date;
  timeZone: string;
}): CalendarIssue[] {
  const issues: CalendarIssue[] = [];
  const operationalPlans = input.plans.filter(isOperationalPlan);
  const planByLearningItem = new Map(operationalPlans.map((plan) => [plan.learningItemId, plan]));

  for (const milestone of input.milestones) {
    if (milestone.status !== "open") continue;
    const plan = milestone.linkedLearningItemId
      ? planByLearningItem.get(milestone.linkedLearningItemId) ?? null
      : null;
    if (plan) continue;
    issues.push({
      id: `assignment-without-plan:${milestone.id}`,
      kind: "assignment_without_plan",
      severity: Date.parse(milestone.dueAt) < input.now.getTime() ? "critical" : "warning",
      title: `${milestone.title} has no preparation plan`,
      reason: `The deadline is tracked for ${formatDate(milestone.dueAt, input.timeZone)}, but no active learning plan is linked to it.`,
      action: { kind: "build_plan", label: "Build plan", targetId: milestone.id },
    });
  }

  const manualPreparationOutcomeIds = new Set(input.blocks.flatMap((block) => (
    block.source === "manual"
    && block.blockType !== "deadline"
    && block.blockType !== "exam"
    && block.outcomeId
      ? [block.outcomeId]
      : []
  )));
  for (const block of input.blocks) {
    if (
      block.source !== "manual"
      || block.done
      || (block.blockType !== "deadline" && block.blockType !== "exam")
    ) continue;
    const outcomeId = block.outcomeId ?? `outcome:manual:${block.event.id}`;
    if (manualPreparationOutcomeIds.has(outcomeId)) continue;
    issues.push({
      id: `manual-assignment-without-plan:${block.event.id}`,
      kind: "assignment_without_plan",
      severity: Date.parse(block.event.dueAt ?? block.startsAt) < input.now.getTime() ? "critical" : "warning",
      title: `${block.title} has no preparation plan`,
      reason: `The ${block.blockType === "exam" ? "exam" : "deadline"} is on the calendar for ${formatDate(block.event.dueAt ?? block.startsAt, input.timeZone)}, but no preparation blocks or active plan are linked to it.`,
      action: { kind: "build_plan", label: "Build plan", targetId: outcomeId },
    });
  }

  for (const plan of operationalPlans) {
    const reason = deadlineCapacityReason(
      plan,
      effectiveCalendarPlanDeadline(plan, input.milestones),
      input.availabilityOverrides,
      input.now,
      input.timeZone,
    );
    if (reason) {
      issues.push({
        id: `deadline-capacity:${plan.id}`,
        kind: "deadline_capacity_gap",
        severity: "critical",
        title: `${plan.title} does not fit before its deadline`,
        reason,
        action: { kind: "fit_into_week", label: "Review plan timing", targetId: plan.id },
      });
    }
  }

  for (const load of input.dayLoads.filter((day) => day.overloaded)) {
    issues.push({
      id: `overloaded-day:${load.dateKey}`,
      kind: "overloaded_day",
      severity: load.availableMinutes !== null && load.plannedMinutes > load.availableMinutes + 30
        ? "critical"
        : "warning",
      title: `${formatDateKey(load.dateKey)} is overloaded`,
      reason: load.availableMinutes === null
        ? `${load.plannedMinutes} minutes across several flexible work blocks makes this a crowded study day.`
        : `${load.plannedMinutes} minutes are planned, but you said ${load.availableMinutes} minutes are available.`,
      action: { kind: "adjust_day", label: "Adjust this day", targetId: load.dateKey },
    });
  }

  for (const plan of operationalPlans) {
    for (const session of plan.sessions) {
      if (session.status !== "ready" || !isSessionOverdue(session.scheduledFor, input.now)) continue;
      issues.push({
        id: `missed-session:${session.id}`,
        kind: "missed_unrescheduled_session",
        severity: "warning",
        title: `${session.title} is still waiting`,
        reason: `This session was scheduled for ${formatDateTime(session.scheduledFor, input.timeZone)} and has not been completed, skipped, or moved.`,
        action: { kind: "reschedule", label: "Choose a new time", targetId: session.id },
      });
    }
  }

  for (const material of input.materials.filter((item) => item.processingStatus === "failed")) {
    issues.push({
      id: `material-failed:${material.id}`,
      kind: "material_failed",
      severity: "warning",
      title: `${material.name} did not process`,
      reason: "YOVA cannot use this material to ground a plan or session until processing succeeds.",
      action: { kind: "retry_material", label: "Review material", targetId: material.id },
    });
  }

  for (const suggestion of input.suggestions.filter((item) => item.status === "pending")) {
    issues.push({
      id: `pending-suggestion:${suggestion.id}`,
      kind: "flexible_block_pending",
      severity: "info",
      title: `${suggestion.title} is still a suggestion`,
      reason: `${suggestion.reason.text} It will remain optional until you keep, move, or dismiss it.`,
      action: { kind: "review_suggested_move", label: "Review suggested move", targetId: suggestion.id },
    });
  }

  for (const item of input.importedItems.filter((candidate) => candidate.status === "pending")) {
    issues.push({
      id: `pending-import:${item.id}`,
      kind: "imported_item_pending",
      severity: "info",
      title: `${item.title} needs confirmation`,
      reason: `${item.sourceLabel} supplied this item, but YOVA will not place it on the confirmed calendar until you approve it.`,
      action: { kind: "confirm_import", label: "Confirm item", targetId: item.id },
    });
  }

  for (const [left, right] of calendarConflicts(input.blocks)) {
    const fixedWithYova = left.source === "manual" && right.source === "plan_session"
      ? { fixed: left, yova: right }
      : right.source === "manual" && left.source === "plan_session"
        ? { fixed: right, yova: left }
        : null;
    issues.push({
      id: `fixed-conflict:${left.id}:${right.id}`,
      kind: "fixed_event_conflict",
      severity: "critical",
      title: `${left.title} conflicts with ${right.title}`,
      reason: fixedWithYova
        ? `${fixedWithYova.fixed.title} is fixed and overlaps YOVA work from ${formatTime(maxIso(left.startsAt, right.startsAt), input.timeZone)} to ${formatTime(minIso(left.endsAt, right.endsAt), input.timeZone)}.`
        : `Both are fixed and overlap from ${formatTime(maxIso(left.startsAt, right.startsAt), input.timeZone)} to ${formatTime(minIso(left.endsAt, right.endsAt), input.timeZone)}.`,
      action: {
        kind: "resolve_conflict",
        label: "Resolve conflict",
        targetId: fixedWithYova ? fixedWithYova.yova.id : left.id,
      },
    });
  }

  for (const plan of operationalPlans) {
    const deferred = plan.knowledgeMap?.topics.filter((topic) => topic.deferred) ?? [];
    if (!deferred.length) continue;
    issues.push({
      id: `deferred-content:${plan.id}`,
      kind: "deferred_content_unscheduled",
      severity: "warning",
      title: `${deferred.length} ${deferred.length === 1 ? "topic is" : "topics are"} outside ${plan.title}'s schedule`,
      reason: deferred.slice(0, 2).map((topic) => `${topic.title}: ${topic.deferred!.reason}`).join(" "),
      action: { kind: "review_deferred_content", label: "Review deferred content", targetId: plan.id },
    });
  }

  return issues.sort(issueOrder);
}

type CalendarModelMilestones = readonly DeadlineMilestone[];

/**
 * A linked Calendar milestone is the learner-facing deadline authority. Plans
 * retain their stored deadline for compatibility, but Calendar fit and
 * placement checks must not silently keep using it after the real due item is
 * corrected.
 */
export function effectiveCalendarPlanDeadline(
  plan: LearningPlan,
  milestones: CalendarModelMilestones,
) {
  return linkedCalendarMilestone(plan, milestones)?.dueAt ?? plan.deadline;
}

export function deriveCalendarOutcomes(input: {
  plans: readonly LearningPlan[];
  milestones: CalendarModelMilestones;
  manualEvents: readonly ManualCalendarEvent[];
  completedSessionIds: ReadonlySet<string>;
  issues: readonly CalendarIssue[];
  now: Date;
}): CalendarOutcome[] {
  const outcomes: CalendarOutcome[] = [];
  const operationalOrComplete = input.plans.filter((plan) => plan.status !== "archived" && plan.status !== "draft");
  const atRiskTargets = new Set(input.issues
    .filter((issue) => issue.kind === "deadline_capacity_gap")
    .map((issue) => issue.action.targetId));

  for (const plan of operationalOrComplete) {
    const milestone = linkedCalendarMilestone(plan, input.milestones);
    const dueAt = effectiveCalendarPlanDeadline(plan, input.milestones);
    if (!dueAt) continue;
    const counted = plan.sessions.filter((session) => session.status !== "skipped");
    const doneBlocks = counted.filter((session) => (
      session.status === "complete" || input.completedSessionIds.has(session.id)
    )).length;
    const totalBlocks = counted.length;
    const status = outcomeStatus({
      dueAt,
      milestoneComplete: milestone?.status === "completed",
      planStatus: plan.status,
      totalBlocks,
      doneBlocks,
      atRisk: atRiskTargets.has(plan.id),
      now: input.now,
    });
    outcomes.push({
      id: `outcome:plan:${plan.id}`,
      title: milestone?.title ?? plan.title,
      courseId: plan.learningItemId,
      dueAt,
      status,
      totalBlocks,
      doneBlocks,
      remainingSummary: remainingSummary(totalBlocks, doneBlocks, status),
      source: "plan",
      planId: plan.id,
      milestoneId: milestone?.id ?? null,
      manualEventId: null,
    });
  }

  const representedMilestoneIds = new Set(outcomes.flatMap((outcome) => outcome.milestoneId ? [outcome.milestoneId] : []));
  for (const milestone of input.milestones) {
    if (representedMilestoneIds.has(milestone.id)) continue;
    outcomes.push({
      id: `outcome:milestone:${milestone.id}`,
      title: milestone.title,
      courseId: milestone.linkedLearningItemId,
      dueAt: milestone.dueAt,
      status: milestone.status === "completed" ? "complete" : "needs_planning",
      totalBlocks: null,
      doneBlocks: null,
      remainingSummary: milestone.status === "completed"
        ? "Marked complete"
        : "No preparation blocks are linked yet",
      source: "milestone",
      planId: null,
      milestoneId: milestone.id,
      manualEventId: null,
    });
  }

  const representedOutcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  for (const event of input.manualEvents.filter((item) => item.eventType === "exam" || item.eventType === "deadline")) {
    const id = event.outcomeId ?? `outcome:manual:${event.id}`;
    if (representedOutcomeIds.has(id)) continue;
    const related = input.manualEvents.filter((item) => item.outcomeId === id && item.id !== event.id);
    outcomes.push({
      id,
      title: event.title,
      courseId: event.courseId,
      dueAt: event.dueAt ?? event.startsAt,
      status: event.done ? "complete" : related.length ? "on_track" : "needs_planning",
      totalBlocks: related.length || null,
      doneBlocks: related.length ? related.filter((item) => item.done).length : null,
      remainingSummary: related.length
        ? remainingSummary(related.length, related.filter((item) => item.done).length, "on_track")
        : "No preparation blocks are linked yet",
      source: "manual",
      planId: null,
      milestoneId: null,
      manualEventId: event.id,
    });
  }

  return outcomes
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
}

function outcomeStatus(input: {
  dueAt: string;
  milestoneComplete: boolean;
  planStatus: LearningPlan["status"];
  totalBlocks: number;
  doneBlocks: number;
  atRisk: boolean;
  now: Date;
}): CalendarOutcome["status"] {
  if (input.milestoneComplete) return "complete";
  if (input.totalBlocks === 0) return "needs_planning";
  if (input.doneBlocks >= input.totalBlocks || input.planStatus === "completed") {
    return Date.parse(input.dueAt) > input.now.getTime() ? "ready" : "complete";
  }
  if (input.atRisk || Date.parse(input.dueAt) < input.now.getTime()) return "at_risk";
  return "on_track";
}

function remainingSummary(total: number, done: number, status: CalendarOutcome["status"]) {
  if (status === "complete") return "Outcome complete";
  if (status === "ready") return "All preparation blocks are complete";
  const remaining = Math.max(0, total - done);
  return `${remaining} of ${total} preparation ${total === 1 ? "block" : "blocks"} remaining`;
}

function deadlineCapacityReason(
  plan: LearningPlan,
  effectiveDeadline: string | null,
  overrides: readonly CalendarAvailabilityOverride[],
  now: Date,
  timeZone: string,
) {
  if (!effectiveDeadline) return null;
  const deadline = Date.parse(effectiveDeadline);
  if (!Number.isFinite(deadline)) return null;
  const unfinished = plan.sessions.filter((session) => session.status === "ready" || session.status === "upcoming");
  const afterDeadline = unfinished.find((session) => (
    Date.parse(session.scheduledFor) + session.estimatedMinutes * 60_000 > deadline
  ));
  if (afterDeadline) {
    return `${afterDeadline.title} ends after the ${formatDate(effectiveDeadline, timeZone)} deadline.`;
  }

  const dateKeys = dateKeysThrough(now, new Date(deadline), timeZone);
  const overrideByDate = new Map(overrides.map((override) => [override.dateKey, override.availableMinutes]));
  if (dateKeys.length > 0 && dateKeys.every((key) => overrideByDate.has(key))) {
    const available = dateKeys.reduce((sum, key) => sum + (overrideByDate.get(key) ?? 0), 0);
    const required = unfinished.reduce((sum, session) => sum + session.estimatedMinutes, 0);
    if (required > available) {
      return `${required} minutes of unfinished work remain before ${formatDate(effectiveDeadline, timeZone)}, but the confirmed daily availability totals ${available} minutes.`;
    }
  }
  return null;
}

function calendarConflicts(blocks: readonly CalendarBlock[]) {
  const fixed = blocks
    .filter((block) => block.fixed && !block.done && block.source !== "milestone")
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const pairs: Array<[CalendarBlock, CalendarBlock]> = [];
  for (let leftIndex = 0; leftIndex < fixed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < fixed.length; rightIndex += 1) {
      const left = fixed[leftIndex]!;
      const right = fixed[rightIndex]!;
      if (Date.parse(right.startsAt) >= Date.parse(left.endsAt)) break;
      if (Date.parse(left.startsAt) < Date.parse(right.endsAt)) pairs.push([left, right]);
    }
  }
  const fixedManual = fixed.filter((block) => block.source === "manual");
  const actionableYova = blocks.filter((block) => (
    block.source === "plan_session"
    && !block.done
    && (block.session.status === "ready" || block.session.status === "upcoming")
  ));
  for (const commitment of fixedManual) {
    for (const yova of actionableYova) {
      if (
        Date.parse(commitment.startsAt) < Date.parse(yova.endsAt)
        && Date.parse(yova.startsAt) < Date.parse(commitment.endsAt)
      ) {
        pairs.push([commitment, yova]);
      }
    }
  }
  return pairs;
}

function countsTowardFlexibleLoad(block: CalendarBlock) {
  return block.source === "plan_session"
    || block.source === "suggestion"
    || (block.source === "manual"
      && block.blockType !== "class"
      && block.blockType !== "exam"
      && block.blockType !== "free_block");
}

function linkedCalendarMilestone(
  plan: LearningPlan,
  milestones: CalendarModelMilestones,
) {
  return milestones
    .filter((milestone) => milestone.linkedLearningItemId === plan.learningItemId)
    .sort((left, right) => (
      Number(left.status !== "open") - Number(right.status !== "open")
      || Date.parse(left.dueAt) - Date.parse(right.dueAt)
      || left.id.localeCompare(right.id)
    ))[0] ?? null;
}

function loadLevel(
  minutes: number,
  blocks: number,
  available: number | null,
  overloaded: boolean,
): CalendarDayLoad["level"] {
  if (overloaded) return "heavy";
  if (available !== null && available > 0) {
    const ratio = minutes / available;
    if (ratio >= 0.8 || blocks >= 3) return "heavy";
    if (ratio >= 0.4 || blocks >= 2) return "focused";
    return "light";
  }
  if (minutes >= 60 || blocks >= 2) return "focused";
  return "light";
}

function blockMinutes(block: CalendarBlock) {
  return Math.max(0, Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000));
}

function issueOrder(left: CalendarIssue, right: CalendarIssue) {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return rank[left.severity] - rank[right.severity] || left.id.localeCompare(right.id);
}

export type CalendarUndoContext = {
  state: CalendarPrototypeState;
  plans: readonly LearningPlan[];
  now?: Date;
};

export type CalendarUndoEligibility = {
  canUndo: boolean;
  reason: string;
};

export type CalendarUndoCommand =
  | { kind: "reschedule_session"; planId: string; planSessionId: string; scheduledFor: string }
  | { kind: "restore_manual_event"; eventId: string; value: ManualCalendarEvent | null }
  | { kind: "restore_suggestion_status"; suggestionId: string; status: CalendarSuggestion["status"] }
  | { kind: "restore_availability"; dateKey: string; availableMinutes: number | null };

export function calendarChangeUndoEligibility(
  entry: CalendarChangeLogEntry,
  context: CalendarUndoContext,
): CalendarUndoEligibility {
  if (!entry.undoable) return { canUndo: false, reason: "This change was recorded for history but is not reversible." };
  if (entry.undoneAt) return { canUndo: false, reason: "This change has already been undone." };
  const now = context.now ?? new Date();
  const undo = entry.undo;
  if (undo.kind === "session_schedule") {
    const plan = context.plans.find((candidate) => candidate.id === undo.planId);
    const session = plan?.sessions.find((candidate) => candidate.id === undo.planSessionId);
    if (!plan || !session || !isOperationalPlan(plan) || (session.status !== "ready" && session.status !== "upcoming")) {
      return { canUndo: false, reason: "The learning session is no longer movable." };
    }
    if (!sameMinute(session.scheduledFor, undo.to)) {
      return { canUndo: false, reason: "The session has changed again since this log entry." };
    }
    if (Date.parse(undo.from) <= now.getTime()) {
      return { canUndo: false, reason: "The previous time has already passed." };
    }
    return { canUndo: true, reason: "The previous future time can be rechecked by the authoritative schedule writer." };
  }
  if (undo.kind === "manual_event") {
    const current = context.state.manualEvents.find((event) => event.id === undo.eventId) ?? null;
    return equivalentEvent(current, undo.after)
      ? { canUndo: true, reason: "The manual event has not changed again." }
      : { canUndo: false, reason: "The manual event has changed again since this log entry." };
  }
  if (undo.kind === "suggestion_status") {
    const current = context.state.suggestions.find((suggestion) => suggestion.id === undo.suggestionId);
    return current?.status === undo.after
      ? { canUndo: true, reason: "The suggestion decision has not changed again." }
      : { canUndo: false, reason: "The suggestion has changed again since this log entry." };
  }
  const current = context.state.availabilityOverrides.find((override) => override.dateKey === undo.dateKey);
  return (current?.availableMinutes ?? null) === undo.afterMinutes
    ? { canUndo: true, reason: "The availability value has not changed again." }
    : { canUndo: false, reason: "Availability has changed again since this log entry." };
}

export function calendarUndoCommand(
  entry: CalendarChangeLogEntry,
  context: CalendarUndoContext,
): CalendarUndoCommand | null {
  if (!calendarChangeUndoEligibility(entry, context).canUndo) return null;
  const undo = entry.undo;
  if (undo.kind === "session_schedule") {
    return {
      kind: "reschedule_session",
      planId: undo.planId,
      planSessionId: undo.planSessionId,
      scheduledFor: undo.from,
    };
  }
  if (undo.kind === "manual_event") {
    return { kind: "restore_manual_event", eventId: undo.eventId, value: undo.before };
  }
  if (undo.kind === "suggestion_status") {
    return { kind: "restore_suggestion_status", suggestionId: undo.suggestionId, status: undo.before };
  }
  return { kind: "restore_availability", dateKey: undo.dateKey, availableMinutes: undo.beforeMinutes };
}

export function markCalendarChangeUndone(
  state: CalendarPrototypeState,
  entryId: string,
  now = new Date(),
): CalendarPrototypeState {
  const at = now.toISOString();
  return {
    ...state,
    changeLog: state.changeLog.map((entry) => (
      entry.id === entryId && entry.undoable && entry.undoneAt === null
        ? { ...entry, undoneAt: at }
        : entry
    )),
    updatedAt: at,
  };
}

function equivalentEvent(left: ManualCalendarEvent | null, right: ManualCalendarEvent | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameMinute(left: string, right: string) {
  return Math.floor(Date.parse(left) / 60_000) === Math.floor(Date.parse(right) / 60_000);
}

export function calendarDateKey(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateKeysThrough(start: Date, end: Date, timeZone: string) {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(12, 0, 0, 0);
  for (let count = 0; count < 367 && cursor.getTime() <= end.getTime() + 24 * 60 * 60_000; count += 1) {
    const key = calendarDateKey(cursor, timeZone);
    if (!keys.includes(key)) keys.push(key);
    if (key === calendarDateKey(end, timeZone)) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year!, month! - 1, day));
}

function maxIso(left: string, right: string) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function minIso(left: string, right: string) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

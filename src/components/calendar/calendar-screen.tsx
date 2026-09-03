"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  GripVertical,
  History,
  LockKeyhole,
  Move,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  GuidedSessionAllowanceNotice,
  guidedSessionAllowanceBlocksNewStart,
  guidedSessionStartLabel,
  type GuidedSessionAllowanceDisplayState,
} from "@/components/guided-session-allowance-notice";
import { PageHeader } from "@/components/page-header";
import { SubjectIcon } from "@/components/subject-icon";
import {
  makeUuid,
  type DeadlineMilestone,
  type LearningPlan,
  type SessionCompletion,
  type SessionInterruption,
} from "@/lib/domain";
import type { AddIntakeSeed } from "@/lib/intake/schema";
import type { ConceptReviewAgendaItem } from "@/lib/learning/concept-review-agenda";
import { buildConceptReviewAgenda } from "@/lib/learning/concept-review-agenda";
import type { ActiveSessionCheckpoint } from "@/lib/learning/active-session-checkpoint";
import { sessionStartRecoveryDecision } from "@/lib/learning/session-start-recovery";
import { buildNextUpQueue } from "@/lib/calendar/next-up-queue";
import {
  deriveCalendarModel,
  previewCourseSeedsForEmptyState,
} from "@/lib/calendar/model";
import {
  calendarChangeUndoEligibility,
  calendarUndoCommand,
  markCalendarChangeUndone,
} from "@/lib/calendar/insights";
import {
  emptyCalendarPrototypeState,
  loadCalendarPrototypeState,
  saveCalendarPrototypeState,
} from "@/lib/calendar/persistence";
import { parseCalendarQuickAdd } from "@/lib/calendar/quick-add";
import { CalendarPrototypeStateSchema } from "@/lib/calendar/types";
import type {
  CalendarBlock,
  CalendarChangeLogEntry,
  CalendarDayLoad,
  CalendarIssue,
  CalendarMaterialState,
  CalendarOutcome,
  CalendarPrototypeState,
  CalendarReason,
  CalendarSuggestion,
  CalendarView,
  ManualCalendarEvent,
} from "@/lib/calendar/types";
import { persistPlanSchedule } from "@/lib/scheduling/client";
import { customScheduleIssue } from "@/lib/scheduling/custom-time";
import { buildDailyCapacityPlan } from "@/lib/scheduling/agenda-insights";
import {
  isSessionOverdue,
  recoverySessionMinutes,
  tomorrowAtSessionTime,
} from "@/lib/scheduling/recovery";
import { canOfferAgendaSessionSplit } from "@/lib/scheduling/split-safety";
import type { ScheduleSessionUpdate } from "@/lib/scheduling/schema";

const HOUR_START = 8;
const HOUR_END = 22;
const DEFAULT_EVENT_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;
const VIEW_LABELS: ReadonlyArray<{ id: CalendarView; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "semester", label: "Semester" },
  { id: "list", label: "List" },
];

type CalendarQuickAddDraft = NonNullable<ReturnType<typeof parseCalendarQuickAdd>>;

type DragState = {
  blockId: string;
  mode: "move" | "resize";
};

type MovePanelState = {
  blockId: string;
  value: string;
};

export type CalendarPlanBuildContext = {
  manualEventId: string | null;
  reviewSourceFirst?: boolean;
};

export type CalendarSessionStartTarget = {
  planId: string;
  planSessionId: string;
};

export type CalendarScreenProps = {
  accountId: string;
  plans: LearningPlan[];
  milestones: DeadlineMilestone[];
  sessionCompletions: SessionCompletion[];
  sessionInterruptions: SessionInterruption[];
  activeSessionCheckpoints: ActiveSessionCheckpoint[];
  adjustmentProtectedSessionIds?: readonly string[];
  calendarMaterials?: readonly CalendarMaterialState[];
  personalizationReasons?: readonly CalendarReason[];
  personalizationSummary?: readonly string[];
  allowance: GuidedSessionAllowanceDisplayState;
  allowanceChecking: boolean;
  previewMode: boolean;
  onOpenAdd: (seed?: AddIntakeSeed, context?: CalendarPlanBuildContext) => void;
  onOpenPlan: (planId: string) => void;
  onStart: (target: CalendarSessionStartTarget) => boolean;
  onActivateReview: (item: ConceptReviewAgendaItem) => Promise<void>;
  onReschedule: (planId: string, updates: readonly ScheduleSessionUpdate[]) => void;
  onAdjustDuration: (planSessionId: string, estimatedMinutes: number) => Promise<void>;
  onClassifyRecoveryInterruption: (planSessionId: string, excludeFromHabitEvidence: boolean) => void;
  onUpdateMilestone: (
    id: string,
    changes: Partial<Pick<DeadlineMilestone, "title" | "description" | "dueAt" | "status" | "linkedLearningItemId">>,
  ) => Promise<void>;
  onDeleteMilestone: (id: string) => Promise<void>;
  onConvertMilestone: (milestone: DeadlineMilestone, outcome: "session" | "plan") => void;
  onSkipSession?: (planId: string, planSessionId: string) => Promise<void> | void;
  onAskAdjust?: () => void;
};

export function CalendarScreen(props: CalendarScreenProps) {
  const {
    accountId,
    plans,
    milestones,
    sessionCompletions,
    sessionInterruptions,
    activeSessionCheckpoints,
    adjustmentProtectedSessionIds = activeSessionCheckpoints.map((checkpoint) => checkpoint.planSessionId),
    calendarMaterials = [],
    personalizationReasons = [],
    personalizationSummary = [],
    allowance,
    allowanceChecking,
    previewMode,
    onOpenAdd,
    onOpenPlan,
    onStart,
    onReschedule,
    onAdjustDuration,
    onClassifyRecoveryInterruption,
    onUpdateMilestone,
    onDeleteMilestone,
    onConvertMilestone,
    onSkipSession,
  } = props;
  const [calendarState, setCalendarState] = useState<CalendarPrototypeState>(() => (
    emptyCalendarPrototypeState(accountId)
  ));
  const calendarStateRef = useRef(calendarState);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [quickAdd, setQuickAdd] = useState("");
  const [quickAddDraft, setQuickAddDraft] = useState<CalendarQuickAddDraft | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [movePanel, setMovePanel] = useState<MovePanelState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completedRecoverySplit, setCompletedRecoverySplit] = useState<{
    sessionId: string;
    minutes: number;
  } | null>(null);
  const [recoveryReason, setRecoveryReason] = useState<string | null>(null);
  const [dismissedRecoverySessionId, setDismissedRecoverySessionId] = useState<string | null>(null);
  const [availableMinutes, setAvailableMinutes] = useState<string>("");
  const [availabilityReason, setAvailabilityReason] = useState("");
  const [capacityDateKey, setCapacityDateKey] = useState<string | null>(null);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [capacityPreviewOpen, setCapacityPreviewOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<DeadlineMilestone | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDueAt, setMilestoneDueAt] = useState("");
  const [now, setNow] = useState(() => new Date());
  const quickAddRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const timeZone = useMemo(() => resolvedTimeZone(), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextState = loadCalendarPrototypeState(window.localStorage, accountId);
      calendarStateRef.current = nextState;
      setCalendarState(nextState);
      setSelectedBlockId(nextState.ui.selectedBlockId);
      setStateLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId]);

  useEffect(() => {
    if (!stateLoaded || calendarState.accountId !== accountId || typeof window === "undefined") return;
    saveCalendarPrototypeState(window.localStorage, accountId, calendarState);
  }, [accountId, calendarState, stateLoaded]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const commitCalendarState = useCallback((
    update: (current: CalendarPrototypeState) => CalendarPrototypeState,
  ) => {
    const candidate = {
      ...update(calendarStateRef.current),
      updatedAt: new Date().toISOString(),
    };
    const parsed = CalendarPrototypeStateSchema.safeParse(candidate);
    if (!parsed.success) {
      setActionError("That calendar change was not saved because one of its values is invalid.");
      return false;
    }
    const next = parsed.data;
    calendarStateRef.current = next;
    const saved = typeof window !== "undefined"
      && next.accountId === accountId
      && saveCalendarPrototypeState(window.localStorage, accountId, next);
    setCalendarState(next);
    if (!saved) setActionError("This calendar change is visible now but could not be saved on this device.");
    return saved;
  }, [accountId]);

  const updateUi = useCallback((changes: Partial<CalendarPrototypeState["ui"]>) => {
    commitCalendarState((current) => ({
      ...current,
      ui: { ...current.ui, ...changes },
    }));
  }, [commitCalendarState]);

  const anchorDate = useMemo(() => (
    calendarState.ui.anchorDateKey
      ? dateFromKey(calendarState.ui.anchorDateKey)
      : now
  ), [calendarState.ui.anchorDateKey, now]);
  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => (
    addDays(weekStart, index)
  )), [weekStart]);
  const weekEnd = weekDays[6] ?? weekStart;

  const model = useMemo(() => deriveCalendarModel({
    plans,
    milestones,
    completions: sessionCompletions,
    interruptions: sessionInterruptions,
    materials: calendarMaterials,
    localState: calendarState,
    now,
    timeZone,
    personalizationReasons,
    executedSessionIds: plans.flatMap((plan) => plan.sessions.flatMap((session) => {
      if (!session.resource) return [];
      const decision = sessionStartRecoveryDecision({
        plan,
        session,
        interruptions: sessionInterruptions,
        restorableCheckpoints: activeSessionCheckpoints,
      });
      return decision.advertiseContinue ? [session.id] : [];
    })),
  }), [
    plans,
    milestones,
    sessionCompletions,
    sessionInterruptions,
    calendarMaterials,
    calendarState,
    now,
    timeZone,
    personalizationReasons,
    activeSessionCheckpoints,
  ]);
  const selectedBlock = selectedBlockId
    ? model.blocks.find((block) => block.id === selectedBlockId) ?? null
    : null;
  const selectedOutcome = selectedBlock?.outcomeId
    ? model.outcomes.find((outcome) => outcome.id === selectedBlock.outcomeId) ?? null
    : null;
  const todayKey = dateKey(now);
  const activeCapacityDateKey = capacityDateKey ?? todayKey;
  const capacityReferenceDate = activeCapacityDateKey === todayKey
    ? now
    : startOfDay(dateFromKey(activeCapacityDateKey));
  const capacityDayLabel = activeCapacityDateKey === todayKey
    ? "today"
    : `on ${formatDateLabel(capacityReferenceDate.toISOString())}`;
  const todaysBlocks = model.blocks
    .filter((block) => dateKey(new Date(block.startsAt)) === todayKey)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const upcomingBlock = todaysBlocks.find((block) => !block.done && Date.parse(block.endsAt) >= now.getTime())
    ?? todaysBlocks.find((block) => !block.done)
    ?? null;
  const nextUpItems = useMemo(() => buildNextUpQueue(model.blocks, now, 8), [model.blocks, now]);
  const nextUpBucketLabel = (bucket: "overdue" | "today" | "upcoming") =>
    bucket === "overdue" ? "OVERDUE" : bucket === "today" ? "TODAY" : "UPCOMING";
  const nextUpTimeLabel = (iso: string) => {
    const date = new Date(iso);
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
      : new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
  };
  const nearestOutcome = model.outcomes
    .filter((outcome) => outcome.status !== "complete" && Date.parse(outcome.dueAt) >= startOfDay(now).getTime())
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))[0] ?? null;
  const previewCourses = previewCourseSeedsForEmptyState({
    previewMode,
    authoritativePlanCount: plans.length,
    manualEventCount: calendarState.manualEvents.length,
  });
  const protectedSessionIds = useMemo(() => new Set([
    ...adjustmentProtectedSessionIds,
    ...sessionInterruptions.map((interruption) => interruption.planSessionId),
  ]), [adjustmentProtectedSessionIds, sessionInterruptions]);
  const selectedStartDecision = selectedBlock?.source === "plan_session"
    ? sessionStartRecoveryDecision({
      plan: selectedBlock.plan,
      session: selectedBlock.session,
      interruptions: sessionInterruptions,
      restorableCheckpoints: activeSessionCheckpoints,
    })
    : null;
  const selectedShortMinutes = selectedBlock?.source === "plan_session"
    ? Math.max(10, Math.min(20, Math.floor(selectedBlock.session.estimatedMinutes / 2 / 5) * 5))
    : null;
  const selectedCanShorten = selectedBlock?.source === "plan_session" && selectedShortMinutes !== null
    ? canOfferAgendaSessionSplit({
      plan: selectedBlock.plan,
      session: selectedBlock.session,
      targetMinutes: selectedShortMinutes,
      protectedSessionIds,
    })
    : false;

  const selectBlock = useCallback((blockId: string | null) => {
    setSelectedBlockId(blockId);
    updateUi({ selectedBlockId: blockId });
    setMovePanel(null);
    setActionError(null);
  }, [updateUi]);

  const navigateCalendar = useCallback((direction: -1 | 1) => {
    const step = calendarState.ui.view === "day"
      ? 1
      : calendarState.ui.view === "month"
        ? 28
        : calendarState.ui.view === "semester"
          ? 112
          : 7;
    const next = addDays(anchorDate, direction * step);
    updateUi({ anchorDateKey: dateKey(next) });
  }, [anchorDate, calendarState.ui.view, updateUi]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        quickAddRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (quickAddDraft) {
          setQuickAddDraft(null);
        } else {
          selectBlock(null);
        }
        return;
      }
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement;
      if (isTyping || (event.metaKey || event.ctrlKey || event.altKey)) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        navigateCalendar(direction);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateCalendar, quickAddDraft, selectBlock]);

  const setView = (view: CalendarView) => updateUi({ view });

  const parseQuickAdd = () => {
    const input = quickAdd.trim();
    if (!input) {
      onOpenAdd();
      return;
    }
    setActionError(null);
    setQuickAddDraft(parseCalendarQuickAdd(input, { now, timeZone }));
  };

  const addFromEmptySlot = (day: Date, hour: number) => {
    const startsAt = new Date(day);
    startsAt.setHours(hour, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
    setQuickAddDraft({
      raw: "",
      title: "",
      eventType: "personal",
      dueAt: null,
      durationMinutes: DEFAULT_EVENT_MINUTES,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      fixed: false,
      courseLabel: null,
      needsConfirmation: true,
    });
  };

  const confirmQuickAdd = (draft: CalendarQuickAddDraft) => {
    const title = draft.title.trim().slice(0, 160);
    const startsAt = draft.startsAt ?? draft.dueAt;
    if (!title || !startsAt) {
      setActionError("Add a title and a time before saving this calendar item.");
      return null;
    }
    const start = new Date(startsAt);
    const end = draft.endsAt
      ? new Date(draft.endsAt)
      : new Date(start.getTime() + (draft.durationMinutes ?? DEFAULT_EVENT_MINUTES) * 60_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setActionError("Choose a valid start time and duration.");
      return null;
    }
    const timestamp = new Date().toISOString();
    const event: ManualCalendarEvent = {
      id: makeUuid(),
      title,
      eventType: draft.eventType,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      dueAt: draft.dueAt,
      fixed: draft.fixed,
      done: false,
      courseId: null,
      courseLabel: draft.courseLabel,
      outcomeId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const log = manualChangeEntry({ before: null, after: event }, `Added ${title} to the calendar.`);
    setActionError(null);
    const saved = commitCalendarState((current) => ({
      ...current,
      manualEvents: [...current.manualEvents, event],
      changeLog: appendChange(current.changeLog, log),
      ui: { ...current.ui, selectedBlockId: `manual:${event.id}` },
    }));
    setQuickAdd("");
    setQuickAddDraft(null);
    setSelectedBlockId(`manual:${event.id}`);
    setMovePanel(null);
    return saved ? event : null;
  };

  const reschedulePlanBlock = async (
    block: Extract<CalendarBlock, { source: "plan_session" }>,
    scheduledFor: string,
    origin: CalendarChangeLogEntry["origin"] = "manual",
    reason = "You chose a new time for this learning block.",
  ) => {
    const issue = customScheduleIssue(block.session.scheduledFor, scheduledFor);
    if (issue) throw new Error(issue);
    const updates = [{ planSessionId: block.session.id, scheduledFor }];
    if (previewMode) {
      onReschedule(block.plan.id, updates);
    } else {
      const result = await persistPlanSchedule(block.plan.id, updates);
      onReschedule(block.plan.id, result.sessions);
    }
    const entry: CalendarChangeLogEntry = {
      id: makeUuid(),
      at: new Date().toISOString(),
      summary: `Moved ${block.title} ${formatShortDateTime(block.startsAt)} → ${formatShortDateTime(scheduledFor)}`,
      reason,
      origin,
      undoable: true,
      undoneAt: null,
      undo: {
        kind: "session_schedule",
        planId: block.plan.id,
        planSessionId: block.session.id,
        from: block.startsAt,
        to: scheduledFor,
      },
    };
    commitCalendarState((current) => ({
      ...current,
      changeLog: appendChange(current.changeLog, entry),
    }));
  };

  const moveBlock = async (
    block: CalendarBlock,
    scheduledFor: string,
    origin: CalendarChangeLogEntry["origin"] = "manual",
    reason?: string,
  ) => {
    if (block.done || block.source === "milestone" || (origin === "automatic" && block.fixed)) return;
    setPendingAction(`move:${block.id}`);
    setActionError(null);
    try {
      const previousStart = new Date(block.startsAt);
      const nextStart = new Date(scheduledFor);
      if (Number.isNaN(nextStart.getTime())) throw new Error("Choose a valid date and time.");
      if (block.source === "plan_session") {
        await reschedulePlanBlock(block, nextStart.toISOString(), origin, reason);
      } else if (block.source === "manual") {
        const duration = Date.parse(block.endsAt) - Date.parse(block.startsAt);
        const updated: ManualCalendarEvent = {
          ...block.event,
          startsAt: nextStart.toISOString(),
          endsAt: new Date(nextStart.getTime() + duration).toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const log = manualChangeEntry(
          { before: block.event, after: updated },
          `Moved ${block.title} ${formatShortDateTime(previousStart.toISOString())} → ${formatShortDateTime(updated.startsAt)}`,
        );
        commitCalendarState((current) => ({
          ...current,
          manualEvents: replaceById(current.manualEvents, updated),
          changeLog: appendChange(current.changeLog, log),
        }));
      } else {
        const prior = block.suggestion;
        const updated = {
          ...prior,
          startsAt: nextStart.toISOString(),
          status: "accepted" as const,
          flexibility: "pinned" as const,
          updatedAt: new Date().toISOString(),
        };
        const log = suggestionChangeEntry(prior, updated, `Pinned ${block.title} at ${formatShortDateTime(updated.startsAt)}`);
        commitCalendarState((current) => ({
          ...current,
          suggestions: replaceById(current.suggestions, updated),
          changeLog: appendChange(current.changeLog, log),
        }));
      }
      setMovePanel(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not move that calendar block.");
    } finally {
      setPendingAction(null);
    }
  };

  const resizeBlock = async (block: CalendarBlock, minutes: number) => {
    const boundedMinutes = Math.max(5, Math.min(360, Math.round(minutes / 5) * 5));
    if (block.done || block.source === "milestone") return;
    setPendingAction(`resize:${block.id}`);
    setActionError(null);
    try {
      if (block.source === "plan_session") {
        if (protectedSessionIds.has(block.session.id)) {
          throw new Error("This block has saved or interrupted work. Continue or move it without changing its recovery record.");
        }
        await onAdjustDuration(block.session.id, boundedMinutes);
        const entry: CalendarChangeLogEntry = {
          id: makeUuid(),
          at: new Date().toISOString(),
          summary: `Rebuilt the remaining ${block.plan.title} work into ${boundedMinutes}-minute content blocks.`,
          reason: "You chose Shorten. YOVA kept completed and saved work intact, then safely carried unfinished content into the remaining plan instead of visually resizing only one event.",
          origin: "manual",
          undoable: false,
          undoneAt: null,
          undo: {
            kind: "session_schedule",
            planId: block.plan.id,
            planSessionId: block.session.id,
            from: block.startsAt,
            to: block.startsAt,
          },
        };
        commitCalendarState((current) => ({
          ...current,
          changeLog: appendChange(current.changeLog, entry),
        }));
      } else if (block.source === "manual") {
        const updated: ManualCalendarEvent = {
          ...block.event,
          endsAt: new Date(Date.parse(block.startsAt) + boundedMinutes * 60_000).toISOString(),
          updatedAt: new Date().toISOString(),
        };
        commitCalendarState((current) => ({
          ...current,
          manualEvents: replaceById(current.manualEvents, updated),
          changeLog: appendChange(current.changeLog, manualChangeEntry(
            { before: block.event, after: updated },
            `Changed ${block.title} to ${boundedMinutes} minutes.`,
          )),
        }));
      } else {
        const updated = {
          ...block.suggestion,
          durationMinutes: boundedMinutes,
          updatedAt: new Date().toISOString(),
        };
        commitCalendarState((current) => ({
          ...current,
          suggestions: replaceById(current.suggestions, updated),
          changeLog: appendChange(current.changeLog, suggestionChangeEntry(
            block.suggestion,
            updated,
            `Changed ${block.title} to ${boundedMinutes} minutes.`,
          )),
        }));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not resize that calendar block.");
    } finally {
      setPendingAction(null);
    }
  };

  const availableEntries = useMemo(() => plans
    .filter((plan) => plan.status === "active")
    .flatMap((plan) => plan.sessions
      .filter((session) => session.status !== "complete" && session.status !== "skipped")
      .map((session) => ({ plan, session })))
    .sort((left, right) => Date.parse(left.session.scheduledFor) - Date.parse(right.session.scheduledFor)), [plans]);
  const requestedCapacity = availableMinutes === "" ? null : Number(availableMinutes);
  const capacityPlan = requestedCapacity === null || !Number.isFinite(requestedCapacity)
    ? null
    : buildDailyCapacityPlan(
      availableEntries,
      requestedCapacity,
      capacityReferenceDate,
      protectedSessionIds,
      capacityDayLabel,
    );
  const overdueEntry = availableEntries.find(({ session }) => (
    session.status === "ready"
      && session.id !== dismissedRecoverySessionId
      && isSessionOverdue(session.scheduledFor, now)
  )) ?? null;
  const overdueBlock = overdueEntry
    ? model.blocks.find((block): block is Extract<CalendarBlock, { source: "plan_session" }> => (
      block.source === "plan_session" && block.session.id === overdueEntry.session.id
    )) ?? null
    : null;
  const overdueRecoveryDecision = overdueEntry
    ? sessionStartRecoveryDecision({
      plan: overdueEntry.plan,
      session: overdueEntry.session,
      interruptions: sessionInterruptions,
      restorableCheckpoints: activeSessionCheckpoints,
    })
    : null;
  const overdueMinutes = overdueEntry ? recoverySessionMinutes(overdueEntry.session.estimatedMinutes) : null;
  const overdueSplitSafe = overdueEntry && overdueMinutes !== null
    ? canOfferAgendaSessionSplit({
      plan: overdueEntry.plan,
      session: overdueEntry.session,
      targetMinutes: overdueMinutes,
      protectedSessionIds,
    })
    : false;
  const completedSplitForOverdue = overdueEntry
    && completedRecoverySplit?.sessionId === overdueEntry.session.id
      ? completedRecoverySplit
      : null;
  const selectRecoveryReason = (reason: string) => {
    if (!overdueEntry) return;
    const nextReason = recoveryReason === reason ? null : reason;
    setRecoveryReason(nextReason);
    onClassifyRecoveryInterruption(
      overdueEntry.session.id,
      nextReason === "App problem",
    );
  };
  const conceptReviews = useMemo(() => buildConceptReviewAgenda(
    plans.filter((plan) => plan.status === "active" || plan.status === "completed"),
    sessionCompletions,
    now,
  ), [plans, sessionCompletions, now]);

  const saveAvailability = () => {
    if (requestedCapacity === null || !Number.isFinite(requestedCapacity)) {
      setActionError("Choose how many minutes you actually have today.");
      return;
    }
    const minutes = Math.max(0, Math.min(720, Math.round(requestedCapacity)));
    const rawReason = availabilityReason.trim();
    const reason = (rawReason
      ? rawReason.length >= 8
        ? rawReason
        : `You said: ${rawReason}.`
      : `You set ${minutes} available study minutes for ${formatDateLabel(capacityReferenceDate.toISOString())}.`
    ).slice(0, 300);
    const previous = calendarState.availabilityOverrides.find((override) => override.dateKey === activeCapacityDateKey) ?? null;
    const next = {
      dateKey: activeCapacityDateKey,
      availableMinutes: minutes,
      reason,
      updatedAt: new Date().toISOString(),
    };
    const log: CalendarChangeLogEntry = {
      id: makeUuid(),
      at: new Date().toISOString(),
      summary: activeCapacityDateKey === todayKey
        ? `Set today’s available time to ${minutes} minutes.`
        : `Set ${formatDateLabel(capacityReferenceDate.toISOString())} available time to ${minutes} minutes.`,
      reason,
      origin: "manual",
      undoable: true,
      undoneAt: null,
      undo: {
        kind: "availability_override",
        dateKey: activeCapacityDateKey,
        beforeMinutes: previous?.availableMinutes ?? null,
        afterMinutes: minutes,
      },
    };
    commitCalendarState((current) => ({
      ...current,
      availabilityOverrides: [
        ...current.availabilityOverrides.filter((override) => override.dateKey !== activeCapacityDateKey),
        next,
      ],
      changeLog: appendChange(current.changeLog, log),
    }));
    setCapacityPreviewOpen(true);
    setActionError(null);
  };

  const applyCapacityPlan = async () => {
    if (!capacityPlan || !capacityPlan.entry) return;
    const block = model.blocks.find((candidate): candidate is Extract<CalendarBlock, { source: "plan_session" }> => (
      candidate.source === "plan_session" && candidate.session.id === capacityPlan.entry?.session.id
    ));
    if (!block) return;
    setPendingAction("capacity");
    setActionError(null);
    try {
      if (capacityPlan.status === "move" && capacityPlan.scheduledFor) {
        await reschedulePlanBlock(
          block,
          capacityPlan.scheduledFor,
          "automatic",
          `${capacityPlan.reason} You approved this after setting today’s available time.`,
        );
      } else if (capacityPlan.status === "split" && capacityPlan.splitMinutes !== null) {
        await onAdjustDuration(block.session.id, capacityPlan.splitMinutes);
        const entry: CalendarChangeLogEntry = {
          id: makeUuid(),
          at: new Date().toISOString(),
          summary: `Shortened ${block.title} to ${capacityPlan.splitMinutes} minutes after your availability update.`,
          reason: `${capacityPlan.reason} You approved this change.`,
          origin: "automatic",
          undoable: false,
          undoneAt: null,
          undo: {
            kind: "session_schedule",
            planId: block.plan.id,
            planSessionId: block.session.id,
            from: block.startsAt,
            to: block.startsAt,
          },
        };
        commitCalendarState((current) => ({
          ...current,
          changeLog: appendChange(current.changeLog, entry),
        }));
      }
      setCapacityPreviewOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not adjust today’s plan.");
    } finally {
      setPendingAction(null);
    }
  };

  const moveOverdueTomorrow = async () => {
    if (!overdueBlock) return;
    setPendingAction("recovery-move");
    setActionError(null);
    try {
      await reschedulePlanBlock(
        overdueBlock,
        tomorrowAtSessionTime(overdueBlock.startsAt, now),
        "manual",
        "You chose tomorrow after reviewing this missed session. Its saved learning order remains unchanged.",
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not move the missed session.");
    } finally {
      setPendingAction(null);
    }
  };

  const shortenOverdue = async () => {
    if (!overdueBlock || overdueMinutes === null || !overdueSplitSafe) return;
    setPendingAction("recovery-shorten");
    setActionError(null);
    try {
      await onAdjustDuration(overdueBlock.session.id, overdueMinutes);
      const entry: CalendarChangeLogEntry = {
        id: makeUuid(),
        at: new Date().toISOString(),
        summary: `Split the remaining ${overdueBlock.plan.title} work into ${overdueMinutes}-minute content blocks.`,
        reason: "You approved the missed-session recovery. YOVA preserved completed and saved work and carried every unfinished content target into the rebuilt plan.",
        origin: "manual",
        undoable: false,
        undoneAt: null,
        undo: {
          kind: "session_schedule",
          planId: overdueBlock.plan.id,
          planSessionId: overdueBlock.session.id,
          from: overdueBlock.startsAt,
          to: overdueBlock.startsAt,
        },
      };
      commitCalendarState((current) => ({
        ...current,
        changeLog: appendChange(current.changeLog, entry),
      }));
      // Keep recovery in the Calendar after the content-safe rebuild. The
      // parent now owns two authoritative parts, and the learner decides when
      // to open Part 1 instead of this stale handler starting the old session.
      setCompletedRecoverySplit({
        sessionId: overdueBlock.session.id,
        minutes: overdueMinutes,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not safely split the missed session.");
    } finally {
      setPendingAction(null);
    }
  };

  const setSuggestionStatus = (
    block: Extract<CalendarBlock, { source: "suggestion" }>,
    status: "accepted" | "dismissed",
  ) => {
    const updated = {
      ...block.suggestion,
      status,
      updatedAt: new Date().toISOString(),
    };
    commitCalendarState((current) => ({
      ...current,
      suggestions: replaceById(current.suggestions, updated),
      changeLog: appendChange(current.changeLog, suggestionChangeEntry(
        block.suggestion,
        updated,
        `${status === "accepted" ? "Kept" : "Dismissed"} ${block.title}.`,
      )),
    }));
    if (status === "dismissed") selectBlock(null);
  };

  const toggleManualDone = (block: Extract<CalendarBlock, { source: "manual" }>) => {
    const updated = {
      ...block.event,
      done: !block.done,
      updatedAt: new Date().toISOString(),
    };
    commitCalendarState((current) => ({
      ...current,
      manualEvents: replaceById(current.manualEvents, updated),
      changeLog: appendChange(current.changeLog, manualChangeEntry(
        { before: block.event, after: updated },
        `${updated.done ? "Completed" : "Reopened"} ${block.title}.`,
      )),
    }));
  };

  const deleteManualEvent = (block: Extract<CalendarBlock, { source: "manual" }>) => {
    const log = manualChangeEntry({ before: block.event, after: null }, `Removed ${block.title} from the calendar.`);
    commitCalendarState((current) => ({
      ...current,
      manualEvents: current.manualEvents.filter((event) => event.id !== block.event.id),
      changeLog: appendChange(current.changeLog, log),
    }));
    selectBlock(null);
  };

  const completeMilestone = async (block: Extract<CalendarBlock, { source: "milestone" }>) => {
    const actionKey = `milestone-complete:${block.milestone.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await onUpdateMilestone(block.milestone.id, { status: "completed" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not mark that outcome complete.");
    } finally {
      setPendingAction(null);
    }
  };

  const deleteMilestone = async (block: Extract<CalendarBlock, { source: "milestone" }>) => {
    const actionKey = `milestone-delete:${block.milestone.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await onDeleteMilestone(block.milestone.id);
      selectBlock(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not delete that outcome.");
    } finally {
      setPendingAction(null);
    }
  };

  const undoLatestChange = async () => {
    const entry = [...calendarState.changeLog].reverse().find((item) => item.undoneAt === null);
    if (!entry) return;
    const context = { state: calendarState, plans, now };
    const eligibility = calendarChangeUndoEligibility(entry, context);
    const command = calendarUndoCommand(entry, context);
    if (!eligibility.canUndo || !command) {
      setActionError(eligibility.reason);
      return;
    }
    setPendingAction("undo");
    setActionError(null);
    try {
      if (command.kind === "reschedule_session") {
        const block = model.blocks.find((candidate): candidate is Extract<CalendarBlock, { source: "plan_session" }> => (
          candidate.source === "plan_session"
          && candidate.plan.id === command.planId
          && candidate.session.id === command.planSessionId
        ));
        if (!block) throw new Error("That learning block is no longer available to undo.");
        const updates = [{ planSessionId: block.session.id, scheduledFor: command.scheduledFor }];
        if (previewMode) {
          onReschedule(block.plan.id, updates);
        } else {
          const result = await persistPlanSchedule(block.plan.id, updates);
          onReschedule(block.plan.id, result.sessions);
        }
      }
      commitCalendarState((current) => {
        let next = current;
        if (command.kind === "restore_manual_event") {
          const without = current.manualEvents.filter((event) => event.id !== command.eventId);
          next = {
            ...next,
            manualEvents: command.value ? [...without, command.value] : without,
          };
        } else if (command.kind === "restore_suggestion_status") {
          next = {
            ...next,
            suggestions: current.suggestions.map((suggestion) => suggestion.id === command.suggestionId
              ? { ...suggestion, status: command.status, updatedAt: new Date().toISOString() }
              : suggestion),
          };
        } else if (command.kind === "restore_availability") {
          const without = current.availabilityOverrides.filter((override) => override.dateKey !== command.dateKey);
          next = {
            ...next,
            availabilityOverrides: command.availableMinutes === null
              ? without
              : [...without, {
                dateKey: command.dateKey,
                availableMinutes: command.availableMinutes,
                reason: `Restored the earlier ${command.availableMinutes}-minute availability setting.`,
                updatedAt: new Date().toISOString(),
              }],
          };
        }
        return markCalendarChangeUndone(next, entry.id);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not undo that schedule change.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, day: Date, hour: number) => {
    event.preventDefault();
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    if (!drag) return;
    const block = model.blocks.find((candidate) => candidate.id === drag.blockId);
    if (!block) return;
    const slot = event.currentTarget.getBoundingClientRect();
    const slotFraction = slot.height > 0
      ? Math.max(0, Math.min(1, (event.clientY - slot.top) / slot.height))
      : 0;
    const minute = Math.max(0, Math.min(55, Math.round((slotFraction * 60) / 5) * 5));
    const target = new Date(day);
    target.setHours(hour, minute, 0, 0);
    if (drag.mode === "resize") {
      const minutes = Math.round((target.getTime() - Date.parse(block.startsAt)) / 60_000);
      await resizeBlock(block, minutes);
      return;
    }
    await moveBlock(block, target.toISOString());
  };

  const openMovePanel = (block: CalendarBlock) => {
    setMovePanel({ blockId: block.id, value: toLocalDateTimeInput(block.startsAt) });
    setActionError(null);
  };

  const buildPlanSeed = (input: {
    title: string;
    dueAt: string | null;
    description?: string | null;
    requestedMinutes?: number | null;
    itemType?: AddIntakeSeed["itemType"];
  }): AddIntakeSeed => {
    const description = input.description?.trim() || input.title;
    return {
      title: input.title.slice(0, 100),
      objective: `Complete ${input.title}`.slice(0, 500),
      itemType: input.itemType ?? "assignment",
      dueAt: input.dueAt,
      scope: description.slice(0, 400),
      progress: "",
      requestedMinutes: input.requestedMinutes ?? undefined,
      materialsSummary: "No materials attached yet.",
      missingFields: input.description?.trim() ? [] : ["scope"],
      description,
      materials: [],
    };
  };

  const buildPlanForOutcome = (outcome: CalendarOutcome) => {
    const milestone = outcome.milestoneId
      ? milestones.find((candidate) => candidate.id === outcome.milestoneId) ?? null
      : null;
    if (milestone) {
      onConvertMilestone(milestone, "plan");
      return;
    }
    onOpenAdd(buildPlanSeed({
      title: outcome.title,
      dueAt: outcome.dueAt,
      itemType: /\b(exam|test|quiz|midterm|final)\b/i.test(outcome.title) ? "test" : "assignment",
    }), { manualEventId: outcome.manualEventId, reviewSourceFirst: true });
  };

  const handleIssueAction = (issue: CalendarIssue) => {
    if (issue.action.kind === "build_plan") {
      const outcome = model.outcomes.find((candidate) => (
        candidate.id === issue.action.targetId || candidate.milestoneId === issue.action.targetId
      ));
      if (outcome) buildPlanForOutcome(outcome);
      else onOpenAdd();
      return;
    }
    if (issue.action.kind === "retry_material") {
      const material = calendarMaterials.find((candidate) => candidate.id === issue.action.targetId) ?? null;
      const linkedPlan = material?.learningItemId
        ? plans.find((plan) => plan.learningItemId === material.learningItemId) ?? null
        : null;
      if (linkedPlan) {
        onOpenPlan(linkedPlan.id);
      } else {
        setActionError(material
          ? `${material.name} is not linked to an available learning plan. Open the goal that owns this source from Learning, or add the source again there.`
          : "That failed material is no longer in the current account snapshot. Reload Calendar to refresh its status.");
      }
      return;
    }
    if (issue.action.kind === "review_suggested_move") {
      const block = model.blocks.find((candidate) => (
        candidate.source === "suggestion"
        && (candidate.suggestion.id === issue.action.targetId || candidate.id === issue.action.targetId)
      ));
      if (block) selectBlock(block.id);
      return;
    }
    if (issue.action.kind === "reschedule") {
      const block = model.blocks.find((candidate) => (
        candidate.source === "plan_session"
        && (candidate.session.id === issue.action.targetId || candidate.id === issue.action.targetId)
      ));
      if (block) {
        selectBlock(block.id);
        openMovePanel(block);
      }
      return;
    }
    if (issue.action.kind === "resolve_conflict") {
      const block = model.blocks.find((candidate) => (
        candidate.id === issue.action.targetId
        || (candidate.source === "manual" && candidate.event.id === issue.action.targetId)
      ));
      if (block) {
        selectBlock(block.id);
        openMovePanel(block);
      } else {
        setActionError("That conflicting event is no longer on this calendar.");
      }
      return;
    }
    if (issue.action.kind === "review_deferred_content") {
      if (issue.action.targetId) onOpenPlan(issue.action.targetId);
      return;
    }
    if (issue.action.kind === "fit_into_week") {
      if (issue.action.targetId) onOpenPlan(issue.action.targetId);
      return;
    }
    if (issue.action.kind === "adjust_day") {
      const targetDateKey = issue.action.targetId;
      if (targetDateKey && /^\d{4}-\d{2}-\d{2}$/.test(targetDateKey)) {
        const existing = calendarState.availabilityOverrides.find((override) => override.dateKey === targetDateKey);
        setCapacityDateKey(targetDateKey);
        setAvailableMinutes(existing ? String(existing.availableMinutes) : "");
        setAvailabilityReason(existing?.reason ?? "");
        setCapacityPreviewOpen(false);
      }
      setAdjustmentsOpen(true);
      document.querySelector(".agenda-adjustment-tools")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setActionError("That item no longer has a review surface. Reload Calendar to refresh its status.");
  };

  const startBlock = (block: Extract<CalendarBlock, { source: "plan_session" }>) => {
    const accepted = onStart({ planId: block.plan.id, planSessionId: block.session.id });
    if (!accepted) {
      setActionError("That exact learning block is no longer ready. Reload Calendar to use the current plan order.");
    }
  };

  const beginReview = async (review: ConceptReviewAgendaItem) => {
    if (review.action === "scheduled" || pendingAction) return;
    setPendingAction(`review:${review.planId}:${review.concept}`);
    setActionError(null);
    try {
      await props.onActivateReview(review);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "YOVA could not open that concept review.");
    } finally {
      setPendingAction(null);
    }
  };

  const calendarDescription = `${model.blocks.filter((block) => !block.done && isWithinRange(block.startsAt, weekStart, addDays(weekEnd, 1))).length} open blocks · ${model.outcomes.filter((outcome) => outcome.status !== "complete").length} upcoming outcomes · manual changes stay under your control.`;
  const visibleWeekReasons = calendarState.ui.whyExpanded
    ? model.whyThisWeek
    : model.whyThisWeek.slice(0, 2);
  const latestActiveChange = [...calendarState.changeLog].reverse().find((entry) => (
    entry.undoneAt === null
  )) ?? null;
  const latestUndoEligibility = latestActiveChange
    ? calendarChangeUndoEligibility(latestActiveChange, { state: calendarState, plans, now })
    : null;

  return <div className="page agenda-page calendar-page">
    <div className="agenda-page-header calendar-page-header">
      <PageHeader
        eyebrow="CALENDAR"
        title="Plan the work that gets you there"
        description={calendarDescription}
      />
      <button className="button primary agenda-add-button" type="button" onClick={() => onOpenAdd()}>
        <Plus size={18} /> Add to YOVA
      </button>
    </div>
    <GuidedSessionAllowanceNotice allowance={allowance} surface="agenda" checking={allowanceChecking} />
    {actionError && <div className="chat-error calendar-action-error" role="alert">
      <AlertCircle size={16} />
      <span>{actionError}</span>
      <button type="button" aria-label="Dismiss calendar error" onClick={() => setActionError(null)}><X size={15} /></button>
    </div>}

    <div className="calendar-workspace">
      <aside className="calendar-rail" aria-label="Calendar tools and today">
        <section className="section-block calendar-quick-add" aria-labelledby="calendar-quick-add-title">
          <div className="calendar-rail-heading">
            <div>
              <span className="step-label">QUICK ADD</span>
              <h2 id="calendar-quick-add-title">Put something on your calendar</h2>
            </div>
            <kbd>⌘K</kbd>
          </div>
          <div className="calendar-quick-add-row">
            <input
              ref={quickAddRef}
              maxLength={500}
              value={quickAdd}
              placeholder="stats pset due friday, 90 min tonight"
              aria-label="Quick add a calendar item"
              onChange={(event) => setQuickAdd(event.target.value.slice(0, 500))}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                parseQuickAdd();
              }}
            />
            <button type="button" className="button primary" aria-label="Parse quick add" onClick={parseQuickAdd}>
              <ArrowRight size={17} />
            </button>
          </div>
          <small>Describe the item in your own words. YOVA shows what it understood before saving. Manual items stay on this device; learning plans and deadlines keep their existing sync.</small>
          {quickAddDraft && <QuickAddConfirmation
            draft={quickAddDraft}
            onChange={setQuickAddDraft}
            onCancel={() => setQuickAddDraft(null)}
            onConfirm={() => confirmQuickAdd(quickAddDraft)}
            onBuildPlan={() => {
              const dueAt = quickAddDraft.dueAt;
              const duration = quickAddDraft.durationMinutes;
              const manualEvent = confirmQuickAdd(quickAddDraft);
              if (!manualEvent) return;
              onOpenAdd(buildPlanSeed({
                title: quickAddDraft.title,
                dueAt,
                requestedMinutes: duration,
                itemType: quickAddDraft.eventType === "exam" ? "test" : "assignment",
              }), { manualEventId: manualEvent.id, reviewSourceFirst: true });
            }}
          />}
        </section>

        {selectedBlock ? <SelectedBlockDetail
          block={selectedBlock}
          outcome={selectedOutcome}
          pending={pendingAction}
          movePanel={movePanel?.blockId === selectedBlock.id ? movePanel : null}
          hasRecoveryRecord={selectedBlock.source === "plan_session" && protectedSessionIds.has(selectedBlock.session.id)}
          advertiseContinue={selectedStartDecision?.advertiseContinue ?? false}
          canStartWithoutGeneration={selectedStartDecision?.canStartWithoutGeneration ?? false}
          canShorten={selectedCanShorten}
          allowance={allowance}
          allowanceChecking={allowanceChecking}
          onClose={() => selectBlock(null)}
          onStart={() => selectedBlock.source === "plan_session" && startBlock(selectedBlock)}
          onMove={() => openMovePanel(selectedBlock)}
          onMoveValue={(value) => setMovePanel({ blockId: selectedBlock.id, value })}
          onSaveMove={() => {
            if (!movePanel || movePanel.blockId !== selectedBlock.id) return;
            const date = new Date(movePanel.value);
            if (Number.isNaN(date.getTime())) {
              setActionError("Choose a valid date and time.");
              return;
            }
            void moveBlock(selectedBlock, date.toISOString());
          }}
          onCancelMove={() => setMovePanel(null)}
          onShorten={(minutes) => void resizeBlock(selectedBlock, minutes)}
          onSkip={() => {
            if (selectedBlock.source === "plan_session") void onSkipSession?.(selectedBlock.plan.id, selectedBlock.session.id);
            if (selectedBlock.source === "suggestion") setSuggestionStatus(selectedBlock, "dismissed");
          }}
          canSkip={selectedBlock.source === "suggestion" || (selectedBlock.source === "plan_session" && Boolean(onSkipSession))}
          onOpenPlan={() => {
            if (selectedBlock.source === "plan_session") onOpenPlan(selectedBlock.plan.id);
            if (selectedBlock.source === "milestone" && selectedOutcome?.planId) {
              onOpenPlan(selectedOutcome.planId);
            }
          }}
          onToggleDone={() => selectedBlock.source === "manual" && toggleManualDone(selectedBlock)}
          onDelete={() => {
            if (selectedBlock.source === "manual") deleteManualEvent(selectedBlock);
            if (selectedBlock.source === "milestone") void deleteMilestone(selectedBlock);
          }}
          onKeepSuggestion={() => selectedBlock.source === "suggestion" && setSuggestionStatus(selectedBlock, "accepted")}
          onDismissSuggestion={() => selectedBlock.source === "suggestion" && setSuggestionStatus(selectedBlock, "dismissed")}
          onBuildPlan={() => {
            if (selectedBlock.source === "milestone" && !selectedOutcome?.planId) {
              onConvertMilestone(selectedBlock.milestone, "plan");
            } else if (selectedBlock.source === "manual" && selectedBlock.event.dueAt) {
              onOpenAdd(buildPlanSeed({
                title: selectedBlock.title,
                dueAt: selectedBlock.event.dueAt,
                requestedMinutes: blockMinutes(selectedBlock),
                itemType: selectedBlock.blockType === "exam" ? "test" : "assignment",
              }), { manualEventId: selectedBlock.event.id, reviewSourceFirst: true });
            }
          }}
          onEditMilestone={() => {
            if (selectedBlock.source !== "milestone") return;
            setEditingMilestone(selectedBlock.milestone);
            setMilestoneTitle(selectedBlock.milestone.title);
            setMilestoneDueAt(toLocalDateTimeInput(selectedBlock.milestone.dueAt));
          }}
          onCompleteMilestone={() => {
            if (selectedBlock.source === "milestone") void completeMilestone(selectedBlock);
          }}
          onStudyNow={() => {
            if (selectedBlock.source === "milestone") onConvertMilestone(selectedBlock.milestone, "session");
          }}
        /> : <YourDayCard
          blocks={todaysBlocks}
          upNextId={upcomingBlock?.id ?? null}
          now={now}
          allowance={allowance}
          allowanceChecking={allowanceChecking}
          activeSessionCheckpoints={activeSessionCheckpoints}
          sessionInterruptions={sessionInterruptions}
          canSkipSession={Boolean(onSkipSession)}
          onSelect={(block) => selectBlock(block.id)}
          onStart={(block) => startBlock(block)}
          onSkip={(block) => {
            if (block.source === "suggestion") setSuggestionStatus(block, "dismissed");
            if (block.source === "plan_session") void onSkipSession?.(block.plan.id, block.session.id);
          }}
          onKeep={(block) => setSuggestionStatus(block, "accepted")}
          onMove={openMovePanel}
        />}

        {editingMilestone && <section className="section-block agenda-milestones calendar-milestone-editor" aria-label="Edit deadline">
          <div className="section-title"><div><h3>Edit outcome</h3><p>Keep the real due time authoritative.</p></div><button type="button" onClick={() => setEditingMilestone(null)} aria-label="Close outcome editor"><X size={16} /></button></div>
          <label><span>Title</span><input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} /></label>
          <label><span>Due</span><input type="datetime-local" value={milestoneDueAt} onChange={(event) => setMilestoneDueAt(event.target.value)} /></label>
          <div className="calendar-inline-actions">
            <button type="button" className="button ghost" onClick={() => setEditingMilestone(null)}>Cancel</button>
            <button type="button" className="button primary" onClick={() => {
              const dueAt = new Date(milestoneDueAt);
              if (!milestoneTitle.trim() || Number.isNaN(dueAt.getTime())) {
                setActionError("Add a title and valid due time.");
                return;
              }
              void onUpdateMilestone(editingMilestone.id, {
                title: milestoneTitle.trim(),
                dueAt: dueAt.toISOString(),
              }).then(() => setEditingMilestone(null)).catch((error: unknown) => (
                setActionError(error instanceof Error ? error.message : "YOVA could not update that outcome.")
              ));
            }}>Save outcome</button>
          </div>
        </section>}

        <NearestOutcomeCard outcome={nearestOutcome} onOpenPlan={onOpenPlan} onBuildPlan={buildPlanForOutcome} />

        <details className="section-block agenda-adjustment-tools" open={adjustmentsOpen} onToggle={(event) => setAdjustmentsOpen(event.currentTarget.open)}>
          <summary>
            <span className="agenda-capacity-icon"><Clock3 size={18} /></span>
            <div><strong>{activeCapacityDateKey === todayKey ? "Adjust today’s available time" : `Adjust ${formatDateLabel(capacityReferenceDate.toISOString())} available time`}</strong><small>Opt in, review the safe change, then approve it.</small></div>
            <ChevronRight size={17} />
          </summary>
          <div className="agenda-adjustment-body">
            <section className="agenda-planning-basis">
              <Settings2 size={17} />
              <div><strong>You stay in control</strong><p>YOVA can propose moving or safely splitting unfinished work. It never changes the calendar until you approve.</p></div>
            </section>
            <section className="agenda-capacity-planner">
              <label><span>{activeCapacityDateKey === todayKey ? "Minutes available today" : `Minutes available ${formatDateLabel(capacityReferenceDate.toISOString())}`}</span><input type="number" min={0} max={720} step={5} value={availableMinutes} onChange={(event) => setAvailableMinutes(event.target.value)} /></label>
              <label><span>What changed? <small>Optional</small></span><input maxLength={300} value={availabilityReason} placeholder="Example: rehearsal runs late" onChange={(event) => setAvailabilityReason(event.target.value.slice(0, 300))} /></label>
              <button type="button" className="button secondary" onClick={saveAvailability}>Review options</button>
            </section>
            {capacityPreviewOpen && capacityPlan && <section className={`agenda-capacity-options ${capacityPlan.status}`} aria-live="polite">
              <span className="step-label">PROPOSED ADJUSTMENT</span>
              <h3>{capacityHeading(capacityPlan.status)}</h3>
              <p>{capacityPlan.reason}</p>
              <small>{capacityPlan.todayMinutes} minutes planned · {capacityPlan.capacityMinutes} minutes available{capacityPlan.projectedMinutes !== capacityPlan.todayMinutes ? ` · ${capacityPlan.projectedMinutes} minutes after change` : ""}</small>
              {(capacityPlan.status === "move" || capacityPlan.status === "split") && <div className="calendar-inline-actions">
                <button type="button" className="button ghost" onClick={() => setCapacityPreviewOpen(false)}>Keep current plan</button>
                <button type="button" className="button primary" disabled={pendingAction === "capacity"} onClick={() => void applyCapacityPlan()}>{pendingAction === "capacity" ? "Applying…" : "Approve change"}</button>
              </div>}
            </section>}
          </div>
        </details>

        {overdueEntry && overdueBlock && <section className="section-block agenda-recovery calendar-recovery" aria-label="Missed session recovery" aria-live="polite">
          <div className="agenda-recovery-copy">
            <span className="step-label">A SESSION IS STILL WAITING</span>
            <h3>Choose a useful next move without losing the plan.</h3>
            <p><strong>{overdueEntry.session.title}</strong> for {overdueEntry.plan.title} is still ready. {overdueRecoveryDecision?.advertiseContinue ? "Saved work can continue without generating a new lesson." : "YOVA will preserve the unfinished content whichever option you choose."}</p>
          </div>
          {completedSplitForOverdue && <p className="agenda-recovery-result" role="status"><Check size={16} /> Split applied. Part 1 and each remaining part now have a {completedSplitForOverdue.minutes}-minute window. Start Part 1 when you are ready.</p>}
          <div className="agenda-recovery-reasons">
            <strong>What got in the way? <span>Optional</span></strong>
            <div>{["Ran out of time", "Interrupted", "Lost focus", "Too difficult", "Instructions unclear", "Low energy", "App problem"].map((reason) => <button type="button" key={reason} aria-pressed={recoveryReason === reason} className={recoveryReason === reason ? "selected" : ""} onClick={() => selectRecoveryReason(reason)}>{reason}</button>)}</div>
            {recoveryReason === "App problem" && <small>YOVA will not use an app problem as evidence about your study habits.</small>}
            {recoveryReason && recoveryReason !== "App problem" && <small>This answer helps YOVA recommend the recovery choice. It does not create a permanent label.</small>}
          </div>
          <div className="agenda-recovery-actions">
            <button type="button" className="button primary" disabled={Boolean(pendingAction) || guidedSessionAllowanceBlocksNewStart(allowance, overdueRecoveryDecision?.canStartWithoutGeneration ?? false, allowanceChecking)} onClick={() => startBlock(overdueBlock)}>{guidedSessionStartLabel(allowance, completedSplitForOverdue ? `Start Part 1 (${completedSplitForOverdue.minutes} min)` : overdueRecoveryDecision?.advertiseContinue ? "Continue" : recoveryReason === "Too difficult" || recoveryReason === "Instructions unclear" ? "Open setup and choose more support" : "Start it now", overdueRecoveryDecision?.canStartWithoutGeneration ?? false, allowanceChecking)}</button>
            {overdueSplitSafe && overdueMinutes !== null && <button type="button" className="button secondary" disabled={Boolean(pendingAction)} onClick={() => void shortenOverdue()}>{pendingAction === "recovery-shorten" ? <span className="button-spinner dark" /> : null} {recoveryReason === "Ran out of time" || recoveryReason === "Low energy" ? "Recommended: " : ""}Split into {overdueMinutes}-min sessions</button>}
            <button type="button" className="button ghost" disabled={Boolean(pendingAction)} onClick={() => void moveOverdueTomorrow()}>{pendingAction === "recovery-move" ? <span className="button-spinner dark" /> : null} Move to tomorrow</button>
            <button type="button" className="button ghost" disabled={Boolean(pendingAction)} onClick={() => setDismissedRecoverySessionId(overdueEntry.session.id)}>Keep the original plan</button>
          </div>
        </section>}

        <section className="section-block calendar-next-up" aria-labelledby="calendar-next-up-title">
          <div className="section-title">
            <div>
              <span className="step-label">NEXT UP</span>
              <h3 id="calendar-next-up-title">Your order of business</h3>
              <p>What to do next, most urgent first.</p>
            </div>
          </div>
          {nextUpItems.length === 0
            ? <p className="calendar-empty-copy">Nothing waiting right now. Add a plan or a deadline and YOVA will queue the work here.</p>
            : <ol className="calendar-next-up-list">
              {nextUpItems.map((item, index) => {
                const block = item.block;
                const decision = sessionStartRecoveryDecision({
                  plan: block.plan,
                  session: block.session,
                  interruptions: sessionInterruptions,
                  restorableCheckpoints: activeSessionCheckpoints,
                });
                const startBlocked = guidedSessionAllowanceBlocksNewStart(
                  allowance,
                  decision.canStartWithoutGeneration,
                  allowanceChecking,
                );
                const label = guidedSessionStartLabel(
                  allowance,
                  decision.advertiseContinue ? "Continue" : "Start",
                  decision.canStartWithoutGeneration,
                  allowanceChecking,
                );
                return <li key={block.id} className={`calendar-next-up-item ${item.bucket}`}>
                  <button type="button" className="calendar-next-up-open" onClick={() => selectBlock(block.id)}>
                    <span className={`calendar-next-up-tag ${item.bucket}`}>{nextUpBucketLabel(item.bucket)}</span>
                    <span className="calendar-next-up-copy">
                      <strong>{block.title}</strong>
                      <span>{block.methodName} · {block.session.amountLabel} · {nextUpTimeLabel(item.startsAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`button ${index === 0 ? "primary" : "secondary"} calendar-next-up-start`}
                    disabled={startBlocked || Boolean(pendingAction)}
                    onClick={() => startBlock(block)}
                  >{label}</button>
                </li>;
              })}
            </ol>}
        </section>
      </aside>

      <main className="calendar-main">
        <section className="section-block calendar-board" aria-labelledby="calendar-board-title">
          <header className="calendar-board-toolbar">
            <div>
              <span className="step-label">SCHEDULE</span>
              <h2 id="calendar-board-title">{formatWeekRange(weekStart, weekEnd)}</h2>
            </div>
            <div className="calendar-view-switcher" role="tablist" aria-label="Calendar view">
              {VIEW_LABELS.map((view) => <button
                type="button"
                role="tab"
                aria-selected={calendarState.ui.view === view.id}
                className={calendarState.ui.view === view.id ? "selected" : ""}
                key={view.id}
                onClick={() => setView(view.id)}
              >{view.label}</button>)}
            </div>
          </header>
          <div className="calendar-date-navigation">
            <button type="button" aria-label="Previous calendar period" onClick={() => navigateCalendar(-1)}><ChevronLeft size={18} /></button>
            <button type="button" className="button ghost" onClick={() => updateUi({ anchorDateKey: dateKey(now) })}>Today</button>
            <button type="button" aria-label="Next calendar period" onClick={() => navigateCalendar(1)}><ChevronRight size={18} /></button>
          </div>

          {calendarState.ui.view === "week" ? <WeekCalendar
            weekDays={weekDays}
            blocks={model.blocks}
            outcomes={model.outcomes}
            dayLoads={model.dayLoads}
            todayKey={todayKey}
            now={now}
            selectedBlockId={selectedBlockId}
            pendingAction={pendingAction}
            onSelect={selectBlock}
            onOpenPlan={onOpenPlan}
            onAddAt={addFromEmptySlot}
            onDrop={(event, day, hour) => void handleDrop(event, day, hour)}
            onDragStart={(event, block, mode) => {
              dragStateRef.current = { blockId: block.id, mode };
              event.dataTransfer.effectAllowed = mode === "move" ? "move" : "link";
              event.dataTransfer.setData("text/plain", block.id);
            }}
          /> : <CalendarViewStub
            view={calendarState.ui.view}
            blocks={model.blocks}
            outcomes={model.outcomes}
            anchorDate={anchorDate}
            onSelect={selectBlock}
            onReturnToWeek={() => setView("week")}
          />}
        </section>

        <section className="calendar-attention" aria-labelledby="calendar-attention-title">
          {model.issues.length === 0 ? <p className="calendar-on-track"><Check size={16} /> Your week is on track.</p> : <>
            <div className="section-title"><div><h2 id="calendar-attention-title">Needs attention</h2><p>These are viability problems derived from the work and time currently saved.</p></div><span>{model.issues.length}</span></div>
            <div className="calendar-issue-list">{model.issues.map((issue) => <article className={`calendar-issue ${issue.severity}`} key={issue.id}>
              <span className="calendar-severity-dot" aria-label={`${issue.severity} severity`} />
              <div><strong>{issue.title}</strong><p>{issue.reason}</p></div>
              <button type="button" className="button secondary" onClick={() => handleIssueAction(issue)}>{issue.action.label}</button>
            </article>)}</div>
          </>}
        </section>

        {conceptReviews.length > 0 && <section className="section-block review-agenda calendar-review-queue" aria-labelledby="calendar-review-title">
          <div className="section-title"><div><h2 id="calendar-review-title">Retrieval queue</h2><p>Concepts return only when completed checks support another attempt.</p></div><span>{conceptReviews.filter((review) => review.timing === "due").length} due</span></div>
          <div className="review-agenda-list">{conceptReviews.slice(0, 4).map((review) => {
            const key = `${review.planId}:${review.concept}`;
            const loading = pendingAction === `review:${key}`;
            return <article className={`${review.priority} ${review.timing}`} key={key}>
              <span className="review-agenda-icon"><RotateCcw size={16} /></span>
              <div><span>{review.timingLabel}</span><strong>{review.concept}</strong><small>{review.planTitle} · {review.instruction}</small></div>
              {review.action === "scheduled" ? <em>Scheduled</em> : <button type="button" className="button secondary" disabled={Boolean(pendingAction)} onClick={() => void beginReview(review)}>{loading ? "Opening…" : review.action === "activate_review" ? "Start short check" : "Start next session"}</button>}
            </article>;
          })}</div>
        </section>}

        <section className="section-block agenda-milestones calendar-outcomes" aria-labelledby="calendar-outcomes-title">
          <div className="section-title"><div><h2 id="calendar-outcomes-title">Coming up</h2><p>Major outcomes and the preparation blocks that lead to them.</p></div><span>{model.outcomes.filter((outcome) => outcome.status !== "complete").length} open</span></div>
          {model.outcomes.length === 0 ? <p className="calendar-empty-copy">Add an exam, paper, or deadline to connect this week’s work to an outcome.</p> : <div className="calendar-outcome-list">{model.outcomes.slice(0, 5).map((outcome) => <OutcomeRow key={outcome.id} outcome={outcome} onOpenPlan={onOpenPlan} onBuildPlan={buildPlanForOutcome} />)}</div>}
        </section>

        <section className="section-block calendar-week-reasons" aria-labelledby="calendar-reasons-title">
          <div className="section-title"><div><h2 id="calendar-reasons-title">Why this week looks like this</h2><p>Only stored profile, completion, availability, plan-order, and deadline evidence appears here.</p></div><Sparkles size={18} /></div>
          {visibleWeekReasons.length > 0 ? <ul>{visibleWeekReasons.map((reason) => <li key={`${reason.source}:${reason.text}`}><span>{reasonSourceLabel(reason.source)}</span><p>{reason.text}</p></li>)}</ul> : <p className="calendar-empty-copy">YOVA has no saved personalization reason to show yet. Manual calendar choices still work normally.</p>}
          {model.whyThisWeek.length > 2 && <button type="button" className="calendar-disclosure" onClick={() => updateUi({ whyExpanded: !calendarState.ui.whyExpanded })}>{calendarState.ui.whyExpanded ? "Show less" : "Show all"}<ChevronDown size={16} /></button>}
          {personalizationSummary.length > 0 && <details className="calendar-profile-summary"><summary>Profile evidence available to YOVA</summary><ul>{personalizationSummary.map((summary) => <li key={summary}>{summary}</li>)}</ul></details>}
          <button type="button" className="button secondary" onClick={() => props.onAskAdjust ? props.onAskAdjust() : setAdjustmentsOpen(true)}><Settings2 size={16} /> Ask YOVA to adjust</button>
          <details className="calendar-change-log" open={calendarState.ui.changeLogExpanded} onToggle={(event) => updateUi({ changeLogExpanded: event.currentTarget.open })}>
            <summary><History size={16} /> Recent schedule changes <span>{calendarState.changeLog.filter((entry) => entry.undoneAt === null).length}</span></summary>
            {calendarState.changeLog.length === 0 ? <p>No calendar changes have been recorded on this device.</p> : <ol>{[...calendarState.changeLog].reverse().slice(0, 8).map((entry) => <li className={entry.undoneAt ? "undone" : ""} key={entry.id}><div><strong>{entry.summary}</strong><small>{formatDateTime(entry.at)} · {entry.origin === "automatic" ? "YOVA change you approved" : "Manual change"}{entry.undoneAt ? " · Undone" : ""}</small></div><p>{entry.reason}</p></li>)}</ol>}
            {latestActiveChange && latestUndoEligibility && !latestUndoEligibility.canUndo && <small className="calendar-undo-unavailable">Undo unavailable: {latestUndoEligibility.reason}</small>}
            <button type="button" className="button ghost" disabled={!latestActiveChange || !latestUndoEligibility?.canUndo || pendingAction === "undo"} onClick={() => void undoLatestChange()}><RotateCcw size={15} /> {pendingAction === "undo" ? "Undoing…" : "Undo latest change"}</button>
          </details>
        </section>

        {previewCourses.length > 0 && <section className="calendar-preview-seed-note">
          <strong>Empty preview courses</strong>
          <p>{previewCourses.map((course) => course.label).join(" · ")}</p>
          <small>These labels appear only in an empty browser preview. Signed-in calendars use authoritative courses and plans.</small>
        </section>}
      </main>
    </div>
  </div>;
}

function QuickAddConfirmation({
  draft,
  onChange,
  onCancel,
  onConfirm,
  onBuildPlan,
}: {
  draft: CalendarQuickAddDraft;
  onChange: (draft: CalendarQuickAddDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onBuildPlan: () => void;
}) {
  const updateStart = (value: string) => {
    const start = value ? new Date(value) : null;
    if (!start || Number.isNaN(start.getTime())) {
      onChange({ ...draft, startsAt: null, endsAt: null });
      return;
    }
    const duration = draft.durationMinutes ?? DEFAULT_EVENT_MINUTES;
    onChange({
      ...draft,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + duration * 60_000).toISOString(),
    });
  };
  const updateDuration = (value: string) => {
    const minutes = value ? Math.max(5, Math.min(360, Number(value))) : null;
    const start = draft.startsAt ? new Date(draft.startsAt) : null;
    onChange({
      ...draft,
      durationMinutes: minutes,
      endsAt: start && minutes
        ? new Date(start.getTime() + minutes * 60_000).toISOString()
        : draft.endsAt,
    });
  };
  const canSave = Boolean(draft.title.trim() && draft.startsAt);
  const isOutcome = draft.eventType === "deadline" || draft.eventType === "exam";

  return <div className="calendar-quick-confirm" role="dialog" aria-label="Confirm quick add">
    <div className="calendar-quick-confirm-heading"><strong>Confirm what YOVA understood</strong><button type="button" aria-label="Cancel quick add" onClick={onCancel}><X size={15} /></button></div>
    <label><span>Title</span><input autoFocus maxLength={160} value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value.slice(0, 160) })} /></label>
    <div className="calendar-quick-confirm-grid">
      <label><span>Type</span><select value={draft.eventType} onChange={(event) => onChange({ ...draft, eventType: event.target.value as CalendarQuickAddDraft["eventType"] })}><option value="class">Class</option><option value="exam">Exam</option><option value="deadline">Deadline</option><option value="personal">Personal</option><option value="free_block">Free block</option></select></label>
      <label><span>Duration</span><input type="number" min={5} max={360} step={5} value={draft.durationMinutes ?? ""} onChange={(event) => updateDuration(event.target.value)} /></label>
    </div>
    <label><span>Calendar time</span><input type="datetime-local" value={draft.startsAt ? toLocalDateTimeInput(draft.startsAt) : ""} onChange={(event) => updateStart(event.target.value)} /></label>
    {isOutcome && <label><span>Due time</span><input type="datetime-local" value={draft.dueAt ? toLocalDateTimeInput(draft.dueAt) : ""} onChange={(event) => onChange({ ...draft, dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>}
    <label className="calendar-checkbox"><input type="checkbox" checked={draft.fixed} onChange={(event) => onChange({ ...draft, fixed: event.target.checked })} /><span>Fixed time</span></label>
    {draft.startsAt === null && <p className="calendar-confirm-note">No study time was found. Choose when this block should appear; the due time remains separate.</p>}
    <div className="calendar-inline-actions">
      <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      {isOutcome && <button type="button" className="button secondary" disabled={!canSave || !draft.dueAt} onClick={onBuildPlan}>Save and build plan</button>}
      <button type="button" className="button primary" disabled={!canSave} onClick={onConfirm}>Save to calendar</button>
    </div>
  </div>;
}

function SelectedBlockDetail({
  block,
  outcome,
  pending,
  movePanel,
  hasRecoveryRecord,
  advertiseContinue,
  canStartWithoutGeneration,
  canShorten,
  allowance,
  allowanceChecking,
  canSkip,
  onClose,
  onStart,
  onMove,
  onMoveValue,
  onSaveMove,
  onCancelMove,
  onShorten,
  onSkip,
  onOpenPlan,
  onToggleDone,
  onDelete,
  onKeepSuggestion,
  onDismissSuggestion,
  onBuildPlan,
  onEditMilestone,
  onCompleteMilestone,
  onStudyNow,
}: {
  block: CalendarBlock;
  outcome: CalendarOutcome | null;
  pending: string | null;
  movePanel: MovePanelState | null;
  hasRecoveryRecord: boolean;
  advertiseContinue: boolean;
  canStartWithoutGeneration: boolean;
  canShorten: boolean;
  allowance: GuidedSessionAllowanceDisplayState;
  allowanceChecking: boolean;
  canSkip: boolean;
  onClose: () => void;
  onStart: () => void;
  onMove: () => void;
  onMoveValue: (value: string) => void;
  onSaveMove: () => void;
  onCancelMove: () => void;
  onShorten: (minutes: number) => void;
  onSkip: () => void;
  onOpenPlan: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
  onKeepSuggestion: () => void;
  onDismissSuggestion: () => void;
  onBuildPlan: () => void;
  onEditMilestone: () => void;
  onCompleteMilestone: () => void;
  onStudyNow: () => void;
}) {
  const minutes = blockMinutes(block);
  const shortenedMinutes = Math.max(10, Math.min(20, Math.floor(minutes / 2 / 5) * 5));
  const reason = blockPlacementReason(block);
  const canMove = !block.done && block.source !== "milestone";
  const readyToStart = block.source === "plan_session" && block.session.status === "ready";
  const milestoneHasLinkedPlan = block.source === "milestone" && Boolean(outcome?.planId);
  const completingMilestone = block.source === "milestone"
    && pending === `milestone-complete:${block.milestone.id}`;
  const deletingMilestone = block.source === "milestone"
    && pending === `milestone-delete:${block.milestone.id}`;
  const startBlocked = block.source === "plan_session"
    ? guidedSessionAllowanceBlocksNewStart(allowance, canStartWithoutGeneration, allowanceChecking)
    : false;

  return <section className={`section-block calendar-block-detail ${block.source} ${block.blockType}`} aria-labelledby="calendar-block-detail-title">
    <div className="calendar-detail-heading">
      <span className={`calendar-block-type ${block.blockType}`}>{blockTypeLabel(block)}</span>
      <button type="button" aria-label="Close calendar detail" onClick={onClose}><X size={17} /></button>
    </div>
    <h2 id="calendar-block-detail-title">{block.title}</h2>
    <p className="calendar-detail-time"><Clock3 size={15} /> {formatDateTime(block.startsAt)} · {minutes} min {block.fixed && <><LockKeyhole size={13} /> fixed</>}</p>
    {block.courseLabel && <div className="calendar-detail-course">{block.source === "plan_session" && <SubjectIcon plan={block.plan} compact />}<span>{block.courseLabel}</span></div>}
    <dl className="calendar-detail-facts">
      <div><dt>Why here</dt><dd>{reason}</dd></div>
      {block.source === "plan_session" && <><div><dt>Method</dt><dd>{block.methodName}</dd></div><div><dt>Why this method</dt><dd>{block.methodReason}</dd></div></>}
      <div><dt>Flexibility</dt><dd>{flexibilityCopy(block)}</dd></div>
      {outcome && <div><dt>Related outcome</dt><dd>{outcome.title} · {formatDateLabel(outcome.dueAt)} · {outcomeStatusLabel(outcome.status)}</dd></div>}
    </dl>
    {hasRecoveryRecord && <p className="calendar-recovery-note"><RotateCcw size={15} /> A recovery record remains attached if you move this session. Continue appears only when the saved work can be restored safely.</p>}
    {block.source === "plan_session" && !block.done && canShorten && <p className="calendar-recovery-note calendar-shorten-note"><Clock3 size={15} /> Shorten safely rebuilds every unfinished ordinary session in this plan into {shortenedMinutes}-minute content blocks. It does not merely resize this one calendar event.</p>}
    {block.source === "plan_session" && block.session.status === "upcoming" && <p className="calendar-plan-order-note"><LockKeyhole size={14} /> This is upcoming work. It stays visible on your calendar, but follows the earlier unfinished sessions in this plan.</p>}
    <div className="calendar-detail-actions agenda-session-actions">
      {readyToStart && <button type="button" className="button primary" disabled={startBlocked} onClick={onStart}>{guidedSessionStartLabel(allowance, advertiseContinue ? "Continue" : "Start", canStartWithoutGeneration, allowanceChecking)}</button>}
      {block.source === "manual" && <button type="button" className="button primary" onClick={onToggleDone}>{block.done ? "Mark open" : "Mark done"}</button>}
      {block.source === "suggestion" && <button type="button" className="button primary" onClick={onKeepSuggestion}>Keep</button>}
      {canMove && <button type="button" className="button secondary" onClick={onMove}><Move size={15} /> Move</button>}
      {block.source === "plan_session" && !block.done && canShorten && <button type="button" className="button ghost" disabled={pending === `resize:${block.id}`} onClick={() => onShorten(shortenedMinutes)}>Shorten to {shortenedMinutes}-min blocks</button>}
      {canSkip && <button type="button" className="button ghost" onClick={onSkip}>Skip</button>}
      {block.source === "plan_session" && <button type="button" className="button ghost" onClick={onOpenPlan}>Open plan</button>}
      {block.source === "manual" && block.event.dueAt && <button type="button" className="button secondary" onClick={onBuildPlan}>Build plan</button>}
      {block.source === "manual" && <button type="button" className="button ghost danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>}
      {block.source === "suggestion" && <button type="button" className="button ghost" onClick={onDismissSuggestion}>Dismiss</button>}
      {block.source === "milestone" && <>{milestoneHasLinkedPlan
        ? <button type="button" className="button primary" disabled={completingMilestone || deletingMilestone} onClick={onOpenPlan}>Open plan</button>
        : <><button type="button" className="button primary" disabled={completingMilestone || deletingMilestone} onClick={onBuildPlan}>Build plan</button><button type="button" className="button secondary" disabled={completingMilestone || deletingMilestone} onClick={onStudyNow}>Study now</button></>}
      <button type="button" className="button ghost" disabled={completingMilestone || deletingMilestone} onClick={onEditMilestone}>Edit</button>{!block.done && <button type="button" className="button ghost" disabled={completingMilestone || deletingMilestone} onClick={onCompleteMilestone}>{completingMilestone ? "Saving…" : "Mark complete"}</button>}<button type="button" className="button ghost danger" disabled={completingMilestone || deletingMilestone} onClick={onDelete}>{deletingMilestone ? "Deleting…" : <><Trash2 size={15} /> Delete</>}</button></>}
    </div>
    {movePanel && <div className="agenda-move-panel calendar-move-panel">
      <label><span>New time</span><input type="datetime-local" value={movePanel.value} onChange={(event) => onMoveValue(event.target.value)} /></label>
      <div className="calendar-inline-actions"><button type="button" className="button ghost" onClick={onCancelMove}>Cancel</button><button type="button" className="button primary" disabled={pending === `move:${block.id}`} onClick={onSaveMove}>{pending === `move:${block.id}` ? "Saving…" : "Save new time"}</button></div>
    </div>}
  </section>;
}

function YourDayCard({
  blocks,
  upNextId,
  now,
  allowance,
  allowanceChecking,
  activeSessionCheckpoints,
  sessionInterruptions,
  canSkipSession,
  onSelect,
  onStart,
  onSkip,
  onKeep,
  onMove,
}: {
  blocks: CalendarBlock[];
  upNextId: string | null;
  now: Date;
  allowance: GuidedSessionAllowanceDisplayState;
  allowanceChecking: boolean;
  activeSessionCheckpoints: ActiveSessionCheckpoint[];
  sessionInterruptions: SessionInterruption[];
  canSkipSession: boolean;
  onSelect: (block: CalendarBlock) => void;
  onStart: (block: Extract<CalendarBlock, { source: "plan_session" }>) => void;
  onSkip: (block: Extract<CalendarBlock, { source: "plan_session" | "suggestion" }>) => void;
  onKeep: (block: Extract<CalendarBlock, { source: "suggestion" }>) => void;
  onMove: (block: CalendarBlock) => void;
}) {
  return <section className="section-block calendar-your-day" aria-labelledby="calendar-your-day-title">
    <div className="calendar-rail-heading"><div><span className="step-label">YOUR DAY</span><h2 id="calendar-your-day-title">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(now)}</h2></div><span>{blocks.filter((block) => !block.done).length} open</span></div>
    {blocks.length === 0 ? <p className="calendar-empty-copy">Nothing is scheduled today. Add a fixed event or leave the space open.</p> : <div className="calendar-day-timeline">{blocks.map((block) => {
      const upNext = block.id === upNextId;
      const startDecision = block.source === "plan_session" ? sessionStartRecoveryDecision({ plan: block.plan, session: block.session, interruptions: sessionInterruptions, restorableCheckpoints: activeSessionCheckpoints }) : null;
      const readyToStart = block.source === "plan_session" && block.session.status === "ready";
      const startBlocked = block.source === "plan_session" && guidedSessionAllowanceBlocksNewStart(allowance, startDecision?.canStartWithoutGeneration ?? false, allowanceChecking);
      return <article className={`calendar-day-item ${upNext ? "up-next" : ""} ${block.done ? "done" : ""} ${block.fixed ? "fixed" : ""} ${block.source === "suggestion" ? "suggested" : ""}`} key={block.id}>
        <span className="calendar-day-marker">{block.done ? <Check size={13} /> : <Circle size={10} />}</span>
        <div className="calendar-day-copy"><small>{formatTime(block.startsAt)}{block.fixed ? " · Fixed" : block.source === "suggestion" ? " · Suggested" : ""}</small><strong>{block.title}</strong>{upNext && <span>Up next</span>}</div>
        <div className="calendar-day-actions">
          {upNext && readyToStart && <button type="button" className="button primary" disabled={startBlocked} onClick={() => block.source === "plan_session" && onStart(block)}>{guidedSessionStartLabel(allowance, startDecision?.advertiseContinue ? "Continue" : "Start", startDecision?.canStartWithoutGeneration ?? false, allowanceChecking)}</button>}
          {upNext && block.source === "plan_session" && block.session.status === "upcoming" && <p className="calendar-plan-order-note compact">Upcoming work follows the earlier sessions in this plan and cannot be started from this block yet.</p>}
          <button type="button" className="button ghost" onClick={() => onSelect(block)}>Details</button>
          {block.source === "suggestion" && <><button type="button" className="button secondary" onClick={() => onKeep(block)}>Keep</button><button type="button" className="button ghost" onClick={() => onMove(block)}>Move</button><button type="button" className="button ghost" onClick={() => onSkip(block)}>Dismiss</button></>}
          {upNext && block.source === "plan_session" && canSkipSession && <button type="button" className="button ghost" onClick={() => onSkip(block)}>Skip</button>}
        </div>
      </article>;
    })}</div>}
  </section>;
}

function NearestOutcomeCard({
  outcome,
  onOpenPlan,
  onBuildPlan,
}: {
  outcome: CalendarOutcome | null;
  onOpenPlan: (planId: string) => void;
  onBuildPlan: (outcome: CalendarOutcome) => void;
}) {
  if (!outcome) return <section className="section-block calendar-nearest-outcome agenda-summary-rail"><span className="step-label">NEAREST DEADLINE</span><h3>No open outcome yet</h3><p>Add a due date when you want the calendar to connect work to a result.</p></section>;
  const meaningfulProgress = outcome.totalBlocks !== null && outcome.doneBlocks !== null;
  return <section className="section-block calendar-nearest-outcome agenda-summary-rail">
    <span className="step-label">NEAREST DEADLINE</span>
    <h3>{outcome.title}</h3>
    <p>{formatDateTime(outcome.dueAt)}</p>
    {meaningfulProgress && <><SegmentedProgress done={outcome.doneBlocks ?? 0} total={outcome.totalBlocks ?? 0} /><strong>{outcome.doneBlocks} of {outcome.totalBlocks} preparation blocks done</strong></>}
    <small>{outcome.remainingSummary}</small>
    <button type="button" className="button secondary" onClick={() => outcome.planId ? onOpenPlan(outcome.planId) : onBuildPlan(outcome)}>{outcome.planId ? "Open plan" : "Build plan"}</button>
  </section>;
}

function WeekCalendar({
  weekDays,
  blocks,
  outcomes,
  dayLoads,
  todayKey,
  now,
  selectedBlockId,
  pendingAction,
  onSelect,
  onOpenPlan,
  onAddAt,
  onDrop,
  onDragStart,
}: {
  weekDays: Date[];
  blocks: CalendarBlock[];
  outcomes: CalendarOutcome[];
  dayLoads: CalendarDayLoad[];
  todayKey: string;
  now: Date;
  selectedBlockId: string | null;
  pendingAction: string | null;
  onSelect: (blockId: string | null) => void;
  onOpenPlan: (planId: string) => void;
  onAddAt: (day: Date, hour: number) => void;
  onDrop: (event: DragEvent<HTMLElement>, day: Date, hour: number) => void;
  onDragStart: (event: DragEvent<HTMLElement>, block: CalendarBlock, mode: DragState["mode"]) => void;
}) {
  const weekKeys = new Set(weekDays.map(dateKey));
  const visibleOutcomes = calendarOutcomesWithMilestones(outcomes, blocks);
  const visibleBlocks = blocks.filter((block) => (
    weekKeys.has(dateKey(new Date(block.startsAt))) && block.source !== "milestone"
  ));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const currentTop = ((nowMinutes - HOUR_START * 60) / ((HOUR_END - HOUR_START) * 60)) * 100;

  return <div className="calendar-week">
    <nav className="agenda-week-selector calendar-week-headers" aria-label="Week days">
      <span className="calendar-time-corner" aria-hidden="true" />
      {weekDays.map((day) => {
        const key = dateKey(day);
        const load = dayLoads.find((candidate) => candidate.dateKey === key);
        const dueCount = visibleOutcomes.filter((outcome) => dateKey(new Date(outcome.dueAt)) === key).length;
        return <div className={`${key === todayKey ? "today" : ""} ${dueCount ? "exam-day" : ""}`} key={key}>
          <span>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}</span>
          <strong>{day.getDate()}</strong>
          <small>{load?.plannedMinutes ?? 0} min</small>
          <span className={`calendar-load-meter ${load?.level ?? "light"}`} title={`${load?.plannedMinutes ?? 0} planned minutes`}><i style={{ width: `${loadPercent(load)}%` }} /></span>
        </div>;
      })}
    </nav>

    <div className="calendar-due-row" aria-label="Due this week">
      <span className="calendar-due-label">DUE</span>
      {weekDays.map((day) => {
        const due = visibleOutcomes.filter((outcome) => dateKey(new Date(outcome.dueAt)) === dateKey(day));
        return <div className="calendar-due-day" key={dateKey(day)}>{due.map((outcome) => {
          const outcomeBlockId = outcomeInspectionBlockId(outcome, blocks);
          const selected = outcomeBlockId !== null && selectedBlockId === outcomeBlockId;
          return <button
            type="button"
            className={`calendar-due-chip ${outcome.status} ${selected ? "selected" : ""}`}
            title={`${outcome.title}, due ${formatDateTime(outcome.dueAt)}`}
            aria-label={`${outcomeBlockId ? "Inspect" : "Open plan for"} ${outcome.title}, due ${formatDateTime(outcome.dueAt)}`}
            aria-pressed={selected}
            key={outcome.id}
            onClick={() => outcomeBlockId ? onSelect(outcomeBlockId) : outcome.planId ? onOpenPlan(outcome.planId) : undefined}
          >{outcome.title}</button>;
        })}</div>;
      })}
    </div>

    <div className="calendar-time-grid">
      <div className="calendar-time-labels" aria-hidden="true">
        {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => HOUR_START + index).map((hour) => <span className="calendar-hour-label" key={hour}>{formatHour(hour)}</span>)}
      </div>
      {weekDays.map((day) => {
        const key = dateKey(day);
        const dayBlocks = visibleBlocks.filter((block) => dateKey(new Date(block.startsAt)) === key);
        const hasExam = visibleOutcomes.some((outcome) => dateKey(new Date(outcome.dueAt)) === key && /\b(exam|test|quiz|midterm|final)\b/i.test(outcome.title));
        return <div className={`calendar-day-column ${key === todayKey ? "today" : ""} ${hasExam ? "exam-day" : ""}`} key={key}>
          {Array.from({ length: HOUR_END - HOUR_START }, (_, index) => HOUR_START + index).map((hour) => <button
            type="button"
            className="calendar-hour-slot"
            aria-label={`Add at ${formatHour(hour)} on ${formatDateLabel(day.toISOString())}`}
            key={hour}
            onClick={() => onAddAt(day, hour)}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => onDrop(event, day, hour)}
          />)}
          {key === todayKey && currentTop >= 0 && currentTop <= 100 && <span className="calendar-current-time" style={{ "--calendar-now-top": `${currentTop}%` } as CSSProperties}><i /> <small>{formatTime(now.toISOString())}</small></span>}
          {dayBlocks.map((block) => {
            const start = new Date(block.startsAt);
            const startMinutes = start.getHours() * 60 + start.getMinutes();
            const top = ((startMinutes - HOUR_START * 60) / ((HOUR_END - HOUR_START) * 60)) * 100;
            const height = Math.max(2.4, (blockMinutes(block) / ((HOUR_END - HOUR_START) * 60)) * 100);
            const draggable = !block.done && block.source !== "milestone";
            const resizable = draggable && block.source !== "plan_session";
            return <button
              type="button"
              className={`calendar-block ${block.source} ${block.blockType} ${block.done ? "done" : ""} ${selectedBlockId === block.id ? "selected" : ""}`}
              style={{ "--calendar-block-top": `${Math.max(0, Math.min(98, top))}%`, "--calendar-block-height": `${Math.min(100 - Math.max(0, top), height)}%` } as CSSProperties}
              draggable={draggable}
              aria-pressed={selectedBlockId === block.id}
              aria-label={`${block.title}, ${formatTime(block.startsAt)}, ${blockTypeLabel(block)}`}
              key={block.id}
              onClick={(event) => { event.stopPropagation(); onSelect(block.id); }}
              onDragStart={(event) => onDragStart(event, block, "move")}
            >
              <strong>{block.done && <Check size={12} />}{block.fixed && <LockKeyhole size={11} />}{block.title}</strong>
              <small>{formatTime(block.startsAt)} · {blockTypeLabel(block)}</small>
              {resizable && <span
                className="calendar-resize-handle"
                draggable
                title={`Drag to resize ${block.title}`}
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => { event.stopPropagation(); onDragStart(event, block, "resize"); }}
              ><GripVertical size={12} /></span>}
              {pendingAction === `move:${block.id}` && <span className="calendar-block-pending">Saving</span>}
            </button>;
          })}
        </div>;
      })}
    </div>
    <footer className="calendar-legend" aria-label="Calendar legend"><span><i className="fixed" /> Fixed</span><span><i className="deadline" /> Exam or deadline</span><span><i className="yova" /> YOVA block</span><span><i className="suggested" /> Suggested</span><span><i className="done" /> Done</span><small>Drag movable blocks. Manual and suggested blocks have a resize handle; shorten YOVA work safely from Details. Click an empty hour to add.</small></footer>
  </div>;
}

function CalendarViewStub({
  view,
  blocks,
  outcomes,
  anchorDate,
  onSelect,
  onReturnToWeek,
}: {
  view: Exclude<CalendarView, "week">;
  blocks: CalendarBlock[];
  outcomes: CalendarOutcome[];
  anchorDate: Date;
  onSelect: (id: string) => void;
  onReturnToWeek: () => void;
}) {
  const label = VIEW_LABELS.find((candidate) => candidate.id === view)?.label ?? view;
  const nearbyBlocks = blocks
    .filter((block) => Math.abs(Date.parse(block.startsAt) - anchorDate.getTime()) <= 35 * DAY_MS)
    .slice(0, 8);
  return <section className="calendar-view-stub" aria-label={`${label} calendar view`}>
    <CalendarDays size={26} />
    <h3>{label} view is routed but not interactive yet</h3>
    <p>Week is the complete planning surface in this release. This view does not pretend to support moving or resizing.</p>
    {view === "list" && nearbyBlocks.length > 0 && <div className="calendar-stub-list">{nearbyBlocks.map((block) => <button type="button" key={block.id} onClick={() => onSelect(block.id)}><span>{formatDateTime(block.startsAt)}</span><strong>{block.title}</strong></button>)}</div>}
    {view !== "list" && <p><strong>{outcomes.filter((outcome) => outcome.status !== "complete").length}</strong> open outcomes remain visible in Coming up below.</p>}
    <button type="button" className="button primary" onClick={onReturnToWeek}>Return to Week</button>
  </section>;
}

function OutcomeRow({
  outcome,
  onOpenPlan,
  onBuildPlan,
}: {
  outcome: CalendarOutcome;
  onOpenPlan: (planId: string) => void;
  onBuildPlan: (outcome: CalendarOutcome) => void;
}) {
  const meaningfulProgress = outcome.totalBlocks !== null && outcome.doneBlocks !== null;
  return <article className={`calendar-outcome-row ${outcome.status}`}>
    <div className="calendar-outcome-copy"><span>{formatDateLabel(outcome.dueAt)}</span><strong>{outcome.title}</strong><p>{outcome.remainingSummary}</p></div>
    <div className="calendar-outcome-progress">{meaningfulProgress ? <><SegmentedProgress done={outcome.doneBlocks ?? 0} total={outcome.totalBlocks ?? 0} /><small>{outcome.doneBlocks} of {outcome.totalBlocks} preparation blocks complete</small></> : <small>Preparation block count not available yet</small>}</div>
    <span className={`calendar-outcome-status ${outcome.status}`}>{outcomeStatusLabel(outcome.status)}</span>
    <button type="button" className="button secondary" onClick={() => outcome.planId ? onOpenPlan(outcome.planId) : onBuildPlan(outcome)}>{outcome.planId ? "Open plan" : "Build plan"}</button>
  </article>;
}

function SegmentedProgress({ done, total }: { done: number; total: number }) {
  const safeTotal = Math.max(0, Math.min(12, total));
  return <span className="calendar-segmented-progress" role="img" aria-label={`${done} of ${total} preparation blocks complete`}>{Array.from({ length: safeTotal }, (_, index) => <i className={index < done ? "done" : ""} key={index} />)}</span>;
}

function manualChangeEntry(
  undo: Extract<CalendarChangeLogEntry["undo"], { kind: "manual_event" }> extends never
    ? never
    : { before: ManualCalendarEvent | null; after: ManualCalendarEvent | null },
  summary: string,
): CalendarChangeLogEntry {
  const eventId = undo.after?.id ?? undo.before?.id;
  if (!eventId) throw new Error("A manual calendar change needs an event.");
  return {
    id: makeUuid(),
    at: new Date().toISOString(),
    summary,
    reason: "You made this calendar change manually.",
    origin: "manual",
    undoable: true,
    undoneAt: null,
    undo: {
      kind: "manual_event",
      eventId,
      before: undo.before,
      after: undo.after,
    },
  };
}

function suggestionChangeEntry(
  before: CalendarSuggestion,
  after: CalendarSuggestion,
  summary: string,
): CalendarChangeLogEntry {
  const undoable = before.status !== after.status
    && before.startsAt === after.startsAt
    && before.durationMinutes === after.durationMinutes
    && before.flexibility === after.flexibility;
  return {
    id: makeUuid(),
    at: new Date().toISOString(),
    summary,
    reason: after.reason.text,
    origin: "manual",
    undoable,
    undoneAt: null,
    undo: {
      kind: "suggestion_status",
      suggestionId: after.id,
      before: before.status,
      after: after.status,
    },
  };
}

function appendChange(
  changes: CalendarChangeLogEntry[],
  entry: CalendarChangeLogEntry,
) {
  return [...changes, entry].slice(-200);
}

function replaceById<T extends { id: string }>(items: T[], replacement: T) {
  return items.map((item) => item.id === replacement.id ? replacement : item);
}

function calendarOutcomesWithMilestones(
  outcomes: readonly CalendarOutcome[],
  blocks: readonly CalendarBlock[],
) {
  const representedMilestoneIds = new Set(outcomes.flatMap((outcome) => (
    outcome.milestoneId ? [outcome.milestoneId] : []
  )));
  const missingMilestones = blocks.flatMap<CalendarOutcome>((block) => {
    if (block.source !== "milestone" || representedMilestoneIds.has(block.milestone.id)) return [];
    return [{
      id: block.outcomeId ?? `outcome:milestone:${block.milestone.id}`,
      title: block.title,
      courseId: block.courseId,
      dueAt: block.milestone.dueAt,
      status: block.done ? "complete" : "needs_planning",
      totalBlocks: null,
      doneBlocks: null,
      remainingSummary: block.done ? "Marked complete" : "Saved deadline",
      source: "milestone",
      planId: null,
      milestoneId: block.milestone.id,
      manualEventId: null,
    }];
  });
  return [...outcomes, ...missingMilestones]
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
}

function outcomeInspectionBlockId(
  outcome: CalendarOutcome,
  blocks: readonly CalendarBlock[],
) {
  const block = blocks.find((candidate) => (
    candidate.source === "milestone"
      ? candidate.milestone.id === outcome.milestoneId
      : candidate.source === "manual"
        ? candidate.event.id === outcome.manualEventId
        : false
  ));
  return block?.id ?? null;
}

function blockMinutes(block: CalendarBlock) {
  return Math.max(1, Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60_000));
}

function blockPlacementReason(block: CalendarBlock) {
  if (block.source === "plan_session" || block.source === "suggestion") return block.placementReason.text;
  if (block.source === "manual") return "Added manually. YOVA has not inferred a placement reason.";
  return `This fixed outcome is due ${formatDateTime(block.milestone.dueAt)}.`;
}

function flexibilityCopy(block: CalendarBlock) {
  if (block.source === "milestone") return "The due time is fixed. Edit it only when the real deadline changes.";
  if (block.source === "manual") return block.fixed
    ? "Marked fixed by you. You can still correct or move it manually."
    : "Fully editable because you added it manually.";
  if (block.source === "suggestion") return block.flexibility === "pinned"
    ? "Pinned by you; YOVA will not move it automatically."
    : "Optional and dismissible. Drag it to choose a time.";
  return "Movable before it starts. YOVA preserves plan order and deadlines when it proposes a change.";
}

function blockTypeLabel(block: CalendarBlock) {
  if (block.source === "plan_session") return block.learningMode === "learn" ? "Learn" : "Practice";
  const labels: Record<CalendarBlock["blockType"], string> = {
    class: "Class",
    exam: "Exam",
    deadline: "Deadline",
    yova: "YOVA",
    suggested: "Suggested",
    personal: "Personal",
    free_block: "Free block",
  };
  return labels[block.blockType];
}

function outcomeStatusLabel(status: CalendarOutcome["status"]) {
  const labels: Record<CalendarOutcome["status"], string> = {
    on_track: "On track",
    needs_planning: "Needs planning",
    at_risk: "At risk",
    ready: "Ready",
    complete: "Complete",
  };
  return labels[status];
}

function reasonSourceLabel(source: CalendarReason["source"]) {
  const labels: Record<CalendarReason["source"], string> = {
    learner_choice: "Your choice",
    learner_profile: "Your profile",
    completion_history: "Recent evidence",
    plan_sequence: "Plan order",
    deadline: "Deadline",
    availability: "Your availability",
    automatic_change: "Approved change",
    suggestion: "Suggestion",
  };
  return labels[source];
}

function capacityHeading(status: ReturnType<typeof buildDailyCapacityPlan>["status"]) {
  const labels: Record<ReturnType<typeof buildDailyCapacityPlan>["status"], string> = {
    empty: "Nothing needs to move",
    fits: "Today already fits",
    move: "Move one unfinished block",
    split: "Shorten one safe content block",
    blocked: "No safe automatic change",
  };
  return labels[status];
}

function loadPercent(load: CalendarDayLoad | undefined) {
  if (!load) return 0;
  const denominator = load.availableMinutes && load.availableMinutes > 0
    ? load.availableMinutes
    : 120;
  return Math.max(4, Math.min(100, Math.round(load.plannedMinutes / denominator * 100)));
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  return next;
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isWithinRange(value: string, start: Date, end: Date) {
  const time = Date.parse(value);
  return time >= start.getTime() && time < end.getTime();
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatHour(hour: number) {
  const date = new Date(2020, 0, 1, hour);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(date);
}

function formatWeekRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = new Intl.DateTimeFormat("en-US", sameMonth
    ? { month: "long", day: "numeric" }
    : { month: "short", day: "numeric" }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(end);
  return `${startLabel} – ${endLabel}`;
}

function resolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

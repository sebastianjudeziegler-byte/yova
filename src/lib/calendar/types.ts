import { z } from "zod";
import { CalendarDateKeySchema, CalendarRecurrenceSchema } from "@/lib/calendar/recurrence-schema";
import { deadlineDateInputFromIso } from "@/lib/intake/deadline";
import type {
  DeadlineMilestone,
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";

export const CALENDAR_STORAGE_VERSION = 1 as const;

export const CalendarViewSchema = z.enum([
  "day",
  "week",
  "month",
  "semester",
  "list",
]);

export const ManualCalendarEventTypeSchema = z.enum([
  "class",
  "exam",
  "deadline",
  "personal",
  "free_block",
]);

export const CalendarReasonSchema = z.object({
  text: z.string().trim().min(8).max(500),
  source: z.enum([
    "learner_choice",
    "learner_profile",
    "completion_history",
    "plan_sequence",
    "deadline",
    "availability",
    "automatic_change",
    "suggestion",
  ]),
  evidenceRefs: z.array(z.string().trim().min(1).max(180)).max(12).default([]),
}).strict();

const ManualCalendarEventFieldsSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(160),
  eventType: ManualCalendarEventTypeSchema,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  fixed: z.boolean(),
  deadlineOnly: z.boolean().optional(),
  done: z.boolean().default(false),
  courseId: z.string().trim().min(1).max(128).nullable().default(null),
  courseLabel: z.string().trim().min(1).max(120).nullable().default(null),
  outcomeId: z.string().trim().min(1).max(128).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const ManualCalendarEventSchema = ManualCalendarEventFieldsSchema.extend({
  recurrence: CalendarRecurrenceSchema.optional(),
  recurrenceExceptions: z.array(z.object({
    dateKey: CalendarDateKeySchema,
    event: ManualCalendarEventFieldsSchema.nullable(),
  }).strict()).max(1000).optional(),
}).strict().superRefine((event, context) => {
  if (event.recurrence?.until && event.recurrence.until < deadlineDateInputFromIso(event.startsAt, event.recurrence.timeZone)) {
    context.addIssue({ code: "custom", path: ["recurrence", "until"], message: "The last repeat date must be on or after the first occurrence." });
  }
  if (event.recurrence && (event.deadlineOnly || event.eventType === "exam" || event.eventType === "deadline")) {
    context.addIssue({ code: "custom", path: ["recurrence"], message: "Repeating items need a class, personal or free-time event." });
  }
  if (new Set(event.recurrenceExceptions?.map((item) => item.dateKey)).size !== (event.recurrenceExceptions?.length ?? 0)) {
    context.addIssue({ code: "custom", path: ["recurrenceExceptions"], message: "Each occurrence may have only one exception." });
  }
  if (event.deadlineOnly && (!event.dueAt || !["exam", "deadline"].includes(event.eventType))) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "A deadline-only item needs an outcome type and a due date." });
  }
  if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "A calendar event must end after it starts.",
    });
  }
});

export const CalendarSuggestionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(160),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().min(5).max(360),
  planId: z.string().trim().min(1).max(128).nullable().default(null),
  planSessionId: z.string().trim().min(1).max(128).nullable().default(null),
  courseId: z.string().trim().min(1).max(128).nullable().default(null),
  outcomeId: z.string().trim().min(1).max(128).nullable().default(null),
  status: z.enum(["pending", "accepted", "dismissed"]),
  flexibility: z.enum(["unplaced", "movable", "pinned"]),
  reason: CalendarReasonSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((suggestion, context) => {
  if (suggestion.flexibility === "pinned" && suggestion.startsAt === null) {
    context.addIssue({
      code: "custom",
      path: ["startsAt"],
      message: "A pinned suggestion needs a start time.",
    });
  }
});

export const CalendarAvailabilityOverrideSchema = z.object({
  dateKey: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  availableMinutes: z.number().int().min(0).max(720),
  reason: z.string().trim().min(8).max(300),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

const SessionScheduleUndoSchema = z.object({
  kind: z.literal("session_schedule"),
  planId: z.string().trim().min(1).max(128),
  planSessionId: z.string().trim().min(1).max(128),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
}).strict();

const ManualEventUndoSchema = z.object({
  kind: z.literal("manual_event"),
  eventId: z.string().trim().min(1).max(128),
  before: ManualCalendarEventSchema.nullable(),
  after: ManualCalendarEventSchema.nullable(),
}).strict().refine((value) => value.before !== null || value.after !== null, {
  message: "A manual-event change needs a before or after value.",
});

const SuggestionUndoSchema = z.object({
  kind: z.literal("suggestion_status"),
  suggestionId: z.string().trim().min(1).max(128),
  before: z.enum(["pending", "accepted", "dismissed"]),
  after: z.enum(["pending", "accepted", "dismissed"]),
}).strict();

const AvailabilityUndoSchema = z.object({
  kind: z.literal("availability_override"),
  dateKey: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  beforeMinutes: z.number().int().min(0).max(720).nullable(),
  afterMinutes: z.number().int().min(0).max(720).nullable(),
}).strict();

export const CalendarUndoMetadataSchema = z.union([
  SessionScheduleUndoSchema,
  ManualEventUndoSchema,
  SuggestionUndoSchema,
  AvailabilityUndoSchema,
]);

export const CalendarChangeLogEntrySchema = z.object({
  id: z.string().trim().min(1).max(128),
  at: z.string().datetime({ offset: true }),
  summary: z.string().trim().min(3).max(300),
  reason: z.string().trim().min(8).max(500),
  origin: z.enum(["manual", "automatic"]),
  undoable: z.boolean(),
  undoneAt: z.string().datetime({ offset: true }).nullable().default(null),
  undo: CalendarUndoMetadataSchema,
}).strict().superRefine((entry, context) => {
  if (!entry.undoable && entry.undoneAt !== null) {
    context.addIssue({
      code: "custom",
      path: ["undoneAt"],
      message: "A non-undoable change cannot be marked undone.",
    });
  }
});

export const CalendarUiStateSchema = z.object({
  view: CalendarViewSchema.default("week"),
  anchorDateKey: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).nullable().default(null),
  selectedBlockId: z.string().trim().min(1).max(180).nullable().default(null),
  whyExpanded: z.boolean().default(false),
  changeLogExpanded: z.boolean().default(false),
}).strict();

export const CalendarPrototypeStateSchema = z.object({
  version: z.literal(CALENDAR_STORAGE_VERSION),
  accountId: z.string().trim().min(1).max(180),
  manualEvents: z.array(ManualCalendarEventSchema).max(500),
  suggestions: z.array(CalendarSuggestionSchema).max(200),
  availabilityOverrides: z.array(CalendarAvailabilityOverrideSchema).max(366),
  changeLog: z.array(CalendarChangeLogEntrySchema).max(200),
  ui: CalendarUiStateSchema,
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((state, context) => {
  checkUnique(state.manualEvents, "manualEvents", context);
  checkUnique(state.suggestions, "suggestions", context);
  checkUnique(state.changeLog, "changeLog", context);
  const dateKeys = new Set<string>();
  state.availabilityOverrides.forEach((override, index) => {
    if (dateKeys.has(override.dateKey)) {
      context.addIssue({
        code: "custom",
        path: ["availabilityOverrides", index, "dateKey"],
        message: "Each day may have only one availability override.",
      });
    }
    dateKeys.add(override.dateKey);
  });
});

function checkUnique(
  items: readonly { id: string }[],
  path: string,
  context: z.RefinementCtx,
) {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: [path, index, "id"],
        message: "Calendar identifiers must be unique within their collection.",
      });
    }
    ids.add(item.id);
  });
}

export type CalendarView = z.infer<typeof CalendarViewSchema>;
export type CalendarReason = z.infer<typeof CalendarReasonSchema>;
export type ManualCalendarEvent = z.infer<typeof ManualCalendarEventSchema>;
export type CalendarSuggestion = z.infer<typeof CalendarSuggestionSchema>;
export type CalendarAvailabilityOverride = z.infer<typeof CalendarAvailabilityOverrideSchema>;
export type CalendarUndoMetadata = z.infer<typeof CalendarUndoMetadataSchema>;
export type CalendarChangeLogEntry = z.infer<typeof CalendarChangeLogEntrySchema>;
export type CalendarUiState = z.infer<typeof CalendarUiStateSchema>;
export type CalendarPrototypeState = z.infer<typeof CalendarPrototypeStateSchema>;

export type CalendarBlockBase = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  done: boolean;
  fixed: boolean;
  courseId: string | null;
  courseLabel: string | null;
  outcomeId: string | null;
};

export type PlanSessionCalendarBlock = CalendarBlockBase & {
  source: "plan_session";
  blockType: "yova";
  plan: LearningPlan;
  session: LearningPlanSession;
  learningMode: "learn" | "study";
  methodName: string;
  methodReason: string;
  placementReason: CalendarReason;
  flexibility: "movable";
};

export type MilestoneCalendarBlock = CalendarBlockBase & {
  source: "milestone";
  blockType: "exam" | "deadline";
  milestone: DeadlineMilestone;
};

export type ManualCalendarBlock = CalendarBlockBase & {
  source: "manual";
  blockType: z.infer<typeof ManualCalendarEventTypeSchema>;
  event: ManualCalendarEvent;
  series?: { master: ManualCalendarEvent; dateKey: string };
};

export type SuggestedCalendarBlock = CalendarBlockBase & {
  source: "suggestion";
  blockType: "suggested";
  suggestion: CalendarSuggestion;
  placementReason: CalendarReason;
  flexibility: CalendarSuggestion["flexibility"];
};

export type CalendarBlock =
  | PlanSessionCalendarBlock
  | MilestoneCalendarBlock
  | ManualCalendarBlock
  | SuggestedCalendarBlock;

export const CALENDAR_OUTCOME_STATUSES = [
  "on_track",
  "needs_planning",
  "at_risk",
  "ready",
  "complete",
] as const;

export type CalendarOutcomeStatus = (typeof CALENDAR_OUTCOME_STATUSES)[number];

export type CalendarOutcome = {
  id: string;
  title: string;
  courseId: string | null;
  dueAt: string;
  status: CalendarOutcomeStatus;
  totalBlocks: number | null;
  doneBlocks: number | null;
  remainingSummary: string;
  source: "plan" | "milestone" | "manual";
  planId: string | null;
  milestoneId: string | null;
  manualEventId: string | null;
};

export const CALENDAR_ISSUE_KINDS = [
  "assignment_without_plan",
  "deadline_capacity_gap",
  "overloaded_day",
  "missed_unrescheduled_session",
  "material_failed",
  "flexible_block_pending",
  "imported_item_pending",
  "fixed_event_conflict",
  "deferred_content_unscheduled",
] as const;

export type CalendarIssueKind = (typeof CALENDAR_ISSUE_KINDS)[number];
export type CalendarIssueSeverity = "info" | "warning" | "critical";

export type CalendarIssueAction = {
  kind:
    | "build_plan"
    | "fit_into_week"
    | "adjust_day"
    | "reschedule"
    | "retry_material"
    | "review_suggested_move"
    | "confirm_import"
    | "resolve_conflict"
    | "review_deferred_content";
  label: string;
  targetId: string | null;
};

export type CalendarIssue = {
  id: string;
  kind: CalendarIssueKind;
  severity: CalendarIssueSeverity;
  title: string;
  reason: string;
  action: CalendarIssueAction;
};

export type CalendarDayLoad = {
  dateKey: string;
  plannedMinutes: number;
  fixedMinutes: number;
  availableMinutes: number | null;
  blockCount: number;
  level: "light" | "focused" | "heavy";
  overloaded: boolean;
};

export type CalendarMaterialState = {
  id: string;
  name: string;
  processingStatus: "uploaded" | "processing" | "ready" | "failed";
  learningItemId: string | null;
};

export type CalendarImportedItem = {
  id: string;
  title: string;
  dueAt: string | null;
  status: "pending" | "confirmed" | "dismissed";
  sourceLabel: string;
};

export type CalendarModelInput = {
  plans: readonly LearningPlan[];
  milestones: readonly DeadlineMilestone[];
  completions?: readonly SessionCompletion[];
  interruptions?: readonly SessionInterruption[];
  materials?: readonly CalendarMaterialState[];
  importedItems?: readonly CalendarImportedItem[];
  /** Sessions with a validated recovery point should describe the route that their saved resource executes. */
  executedSessionIds?: readonly string[];
  localState: CalendarPrototypeState;
  now?: Date;
  timeZone?: string;
  personalizationReasons?: readonly CalendarReason[];
  visibleRange?: { start: Date; end: Date };
};

export type CalendarModel = {
  blocks: CalendarBlock[];
  outcomes: CalendarOutcome[];
  issues: CalendarIssue[];
  dayLoads: CalendarDayLoad[];
  whyThisWeek: CalendarReason[];
};

export type PreviewCourseSeed = {
  id: string;
  label: string;
  provenance: "empty_preview_seed";
};

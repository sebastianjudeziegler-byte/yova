import { z } from "zod";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

export const BROAD_RECALL_PROGRESS_KIND = "broad_recall" as const;
export const BROAD_RECALL_PROGRESS_FORMAT = "broad_recall_v1" as const;

export const BROAD_RECALL_GAP_STATUSES = [
  "covered",
  "partial",
  "missing",
] as const;

export const BROAD_RECALL_TRANSFER_RESULTS = [
  "secure",
  "needs_review",
  "unverified",
] as const;

const BroadRecallGapStatusSchema = z.enum(BROAD_RECALL_GAP_STATUSES);
const BroadRecallTransferResultSchema = z.enum(BROAD_RECALL_TRANSFER_RESULTS);

const BroadRecallTargetBindingSchema = z.object({
  targetId: z.string().uuid(),
  evidenceId: z.string().min(1).max(200),
}).strict().superRefine((binding, context) => {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A broad-recall target must use its exact final-check evidence identifier.",
    });
  }
});

const BroadRecallComparisonCompletedEventSchema = z.object({
  type: z.literal("comparison_completed"),
  gapStatuses: z.array(BroadRecallGapStatusSchema).min(1).max(6),
}).strict();

const BroadRecallCorrectionCompletedEventSchema = z.object({
  type: z.literal("correction_completed"),
}).strict();

const BroadRecallTransferEvaluatedEventSchema = z.object({
  type: z.literal("transfer_evaluated"),
  results: z.array(BroadRecallTransferResultSchema).min(1).max(3),
}).strict();

const BroadRecallEventSchema = z.discriminatedUnion("type", [
  BroadRecallComparisonCompletedEventSchema,
  BroadRecallCorrectionCompletedEventSchema,
  BroadRecallTransferEvaluatedEventSchema,
]);

const BROAD_RECALL_EVENT_ORDER = [
  "comparison_completed",
  "correction_completed",
  "transfer_evaluated",
] as const;

export const BroadRecallProgressSchema = z.object({
  kind: z.literal(BROAD_RECALL_PROGRESS_KIND),
  format: z.literal(BROAD_RECALL_PROGRESS_FORMAT),
  activityIndex: z.number().int().min(0).max(23),
  gapCount: z.number().int().min(1).max(6),
  bindings: z.array(BroadRecallTargetBindingSchema).min(1).max(3),
  events: z.array(BroadRecallEventSchema).max(BROAD_RECALL_EVENT_ORDER.length),
}).strict().superRefine((progress, context) => {
  reportDuplicateBindings(progress.bindings, context);

  progress.events.forEach((event, eventIndex) => {
    if (event.type !== BROAD_RECALL_EVENT_ORDER[eventIndex]) {
      context.addIssue({
        code: "custom",
        path: ["events", eventIndex, "type"],
        message: "Broad-recall events must form the canonical immutable prefix.",
      });
    }
  });

  const comparison = progress.events[0];
  if (
    comparison?.type === "comparison_completed"
    && comparison.gapStatuses.length !== progress.gapCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["events", 0, "gapStatuses"],
      message: "Comparison must classify every configured gap exactly once.",
    });
  }

  const transfer = progress.events[2];
  if (
    transfer?.type === "transfer_evaluated"
    && transfer.results.length !== progress.bindings.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["events", 2, "results"],
      message: "Transfer must record exactly one result per ordered target binding.",
    });
  }
});

type ParsedBroadRecallProgress = z.infer<typeof BroadRecallProgressSchema>;

export type BroadRecallGapStatus = z.infer<typeof BroadRecallGapStatusSchema>;
export type BroadRecallTransferResult = z.infer<typeof BroadRecallTransferResultSchema>;
export type BroadRecallTargetBinding = DeepReadonly<
  z.infer<typeof BroadRecallTargetBindingSchema>
>;
export type BroadRecallProgressEvent = DeepReadonly<
  z.infer<typeof BroadRecallEventSchema>
>;
export type BroadRecallProgress = DeepReadonly<ParsedBroadRecallProgress>;

export const BROAD_RECALL_DURABLE_STAGES = [
  "broad_attempt",
  "gap_repair",
  "closed_source_transfer",
  "complete",
] as const;

export type BroadRecallDurableStage = typeof BROAD_RECALL_DURABLE_STAGES[number];
export type BroadRecallProgressRank = 0 | 1 | 2 | 3;

export type BroadRecallProgressMergeResult =
  | Readonly<{
    kind: "merged";
    source: "left" | "right" | "equal";
    progress: BroadRecallProgress;
  }>
  | Readonly<{
    kind: "conflict";
    reason: "invalid_progress" | "identity_mismatch" | "event_divergence";
  }>;

export function readBroadRecallProgress(value: unknown): BroadRecallProgress | null {
  const parsed = BroadRecallProgressSchema.safeParse(value);
  return parsed.success ? deepFreeze(parsed.data) : null;
}

export function startBroadRecallProgress({
  activityIndex,
  gapCount,
  bindings,
}: {
  activityIndex: number;
  gapCount: number;
  bindings: readonly BroadRecallTargetBinding[];
}): BroadRecallProgress | null {
  return readBroadRecallProgress({
    kind: BROAD_RECALL_PROGRESS_KIND,
    format: BROAD_RECALL_PROGRESS_FORMAT,
    activityIndex,
    gapCount,
    bindings,
    events: [],
  });
}

export function completeBroadRecallComparison(
  progress: BroadRecallProgress,
  gapStatuses: readonly BroadRecallGapStatus[],
): BroadRecallProgress | null {
  const current = readBroadRecallProgress(progress);
  if (!current || current.events.length !== 0) return null;
  return readBroadRecallProgress({
    ...current,
    events: [{ type: "comparison_completed", gapStatuses }],
  });
}

export function completeBroadRecallCorrection(
  progress: BroadRecallProgress,
): BroadRecallProgress | null {
  const current = readBroadRecallProgress(progress);
  if (!current || current.events.length !== 1) return null;
  return readBroadRecallProgress({
    ...current,
    events: [...current.events, { type: "correction_completed" }],
  });
}

export function recordBroadRecallTransferEvaluation(
  progress: BroadRecallProgress,
  results: readonly BroadRecallTransferResult[],
): BroadRecallProgress | null {
  const current = readBroadRecallProgress(progress);
  if (!current || current.events.length !== 2) return null;
  return readBroadRecallProgress({
    ...current,
    events: [...current.events, { type: "transfer_evaluated", results }],
  });
}

export function broadRecallProgressRank(
  progress: BroadRecallProgress,
): BroadRecallProgressRank {
  return progress.events.length as BroadRecallProgressRank;
}

export function broadRecallDurableStage(
  progress: BroadRecallProgress,
): BroadRecallDurableStage {
  return BROAD_RECALL_DURABLE_STAGES[broadRecallProgressRank(progress)];
}

export function broadRecallProgressIsComplete(progress: BroadRecallProgress) {
  return broadRecallProgressRank(progress) === 3;
}

/**
 * Reconciles browser and cloud progress without trusting save time. Progress is
 * an immutable event prefix: equal prefixes are idempotent, and a structurally
 * longer prefix wins. A divergent event can never be silently overwritten.
 */
export function mergeBroadRecallProgress(
  leftValue: unknown,
  rightValue: unknown,
): BroadRecallProgressMergeResult {
  const left = readBroadRecallProgress(leftValue);
  const right = readBroadRecallProgress(rightValue);
  if (!left || !right) {
    return Object.freeze({ kind: "conflict", reason: "invalid_progress" });
  }
  if (!sameProgressIdentity(left, right)) {
    return Object.freeze({ kind: "conflict", reason: "identity_mismatch" });
  }

  const sharedLength = Math.min(left.events.length, right.events.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (!sameEvent(left.events[index]!, right.events[index]!)) {
      return Object.freeze({ kind: "conflict", reason: "event_divergence" });
    }
  }

  if (left.events.length === right.events.length) {
    return Object.freeze({ kind: "merged", source: "equal", progress: left });
  }
  if (left.events.length > right.events.length) {
    return Object.freeze({ kind: "merged", source: "left", progress: left });
  }
  return Object.freeze({ kind: "merged", source: "right", progress: right });
}

function reportDuplicateBindings(
  bindings: readonly BroadRecallTargetBinding[],
  context: z.RefinementCtx,
) {
  const targetIds = bindings.map((binding) => binding.targetId);
  const evidenceIds = bindings.map((binding) => binding.evidenceId);
  if (new Set(targetIds).size !== targetIds.length) {
    context.addIssue({
      code: "custom",
      path: ["bindings"],
      message: "Broad-recall target bindings must be unique.",
    });
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["bindings"],
      message: "Broad-recall evidence bindings must be unique.",
    });
  }
}

function sameProgressIdentity(
  left: BroadRecallProgress,
  right: BroadRecallProgress,
) {
  return left.kind === right.kind
    && left.format === right.format
    && left.activityIndex === right.activityIndex
    && left.gapCount === right.gapCount
    && sameBindings(left.bindings, right.bindings);
}

function sameBindings(
  left: readonly BroadRecallTargetBinding[],
  right: readonly BroadRecallTargetBinding[],
) {
  return left.length === right.length
    && left.every((binding, index) => (
      binding.targetId === right[index]?.targetId
      && binding.evidenceId === right[index]?.evidenceId
    ));
}

function sameEvent(
  left: BroadRecallProgressEvent,
  right: BroadRecallProgressEvent,
) {
  if (left.type !== right.type) return false;
  if (left.type === "correction_completed") return true;
  if (left.type === "comparison_completed") {
    return right.type === "comparison_completed"
      && sameStrings(left.gapStatuses, right.gapStatuses);
  }
  return right.type === "transfer_evaluated"
    && sameStrings(left.results, right.results);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

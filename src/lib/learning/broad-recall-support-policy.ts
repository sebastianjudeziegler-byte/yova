import { z } from "zod";
import {
  BROAD_RECALL_DURABLE_STAGES,
  broadRecallDurableStage,
  readBroadRecallProgress,
  type BroadRecallDurableStage,
} from "@/lib/learning/broad-recall-progress";

/**
 * The durable event prefix and the ephemeral runtime view are deliberately
 * separate. For example, `compare_open` is authorized by the current in-memory
 * attempt but is never restored from the still-empty durable event prefix.
 */
export const BROAD_RECALL_SUPPORT_VIEWS = [
  "recall_closed",
  "compare_open",
  "repair_open",
  "transfer_closed",
  "evaluating",
  "complete",
] as const;

export type BroadRecallSupportView =
  typeof BROAD_RECALL_SUPPORT_VIEWS[number];

const BroadRecallDurableStageSchema = z.enum(BROAD_RECALL_DURABLE_STAGES);
const BroadRecallSupportViewSchema = z.enum(BROAD_RECALL_SUPPORT_VIEWS);

const ReadySupportContextSchema = z.object({
  kind: z.literal("ready"),
  durableStage: BroadRecallDurableStageSchema,
  view: BroadRecallSupportViewSchema,
}).strict();

const EvaluatorUnavailableSupportContextSchema = z.object({
  kind: z.literal("evaluator_unavailable"),
  durableStage: z.literal("closed_source_transfer"),
  view: z.enum(["transfer_closed", "evaluating"]),
}).strict();

const NonInteractiveSupportContextSchema = z.object({
  kind: z.enum(["invalid", "conflict"]),
}).strict();

const READY_VIEWS_BY_DURABLE_STAGE: Readonly<
  Record<BroadRecallDurableStage, readonly BroadRecallSupportView[]>
> = Object.freeze({
  broad_attempt: Object.freeze(["recall_closed", "compare_open"] as const),
  gap_repair: Object.freeze(["repair_open"] as const),
  closed_source_transfer: Object.freeze(["transfer_closed", "evaluating"] as const),
  complete: Object.freeze(["complete"] as const),
});

/**
 * A projected, privacy-safe runtime state. Callers must not pass the complete
 * controller (which contains learner drafts); the strict schema rejects every
 * extra field.
 */
export const BroadRecallSupportContextSchema = z.discriminatedUnion("kind", [
  ReadySupportContextSchema,
  EvaluatorUnavailableSupportContextSchema,
  NonInteractiveSupportContextSchema,
]).superRefine((context, refinement) => {
  if (
    context.kind === "ready"
    && !READY_VIEWS_BY_DURABLE_STAGE[context.durableStage].includes(context.view)
  ) {
    refinement.addIssue({
      code: "custom",
      path: ["view"],
      message: "The ephemeral broad-recall view does not match its durable event stage.",
    });
  }
});

export type BroadRecallSupportContext = Readonly<
  z.infer<typeof BroadRecallSupportContextSchema>
>;

export type BroadRecallSupportPolicy = Readonly<{
  kind: "broad_recall_support_v1";
  sourceComparison: "denied" | "exact_saved_source_only";
  previousLesson: "denied" | "normal_post_check";
  modelAnswer: "denied" | "normal_post_check";
  sessionGuide: "denied" | "normal_post_check";
  tutor: "denied" | "normal_post_check";
  notesAndHelp: "denied" | "normal_post_check";
  transferReference: "denied" | "exact_saved_transfer_reference";
  exitBehavior:
    | "confirm_preserve_durable_discard_ephemeral"
    | "safe_exit_discard_ephemeral"
    | "normal_post_check_exit";
}>;

const DENY_POLICY: BroadRecallSupportPolicy = Object.freeze({
  kind: "broad_recall_support_v1",
  sourceComparison: "denied",
  previousLesson: "denied",
  modelAnswer: "denied",
  sessionGuide: "denied",
  tutor: "denied",
  notesAndHelp: "denied",
  transferReference: "denied",
  exitBehavior: "safe_exit_discard_ephemeral",
});

const CLOSED_WORK_POLICY: BroadRecallSupportPolicy = Object.freeze({
  ...DENY_POLICY,
  exitBehavior: "confirm_preserve_durable_discard_ephemeral",
});

const COMPARE_POLICY: BroadRecallSupportPolicy = Object.freeze({
  ...CLOSED_WORK_POLICY,
  sourceComparison: "exact_saved_source_only",
});

/**
 * Returns the exact support policy for a validated runtime projection. Every
 * malformed, contradictory, conflicted, or evaluator-unavailable input uses
 * the same deny-by-default policy. A client-authored complete progress prefix
 * is not evaluation authority, so post-check surfaces remain denied until a
 * separate server-verified completion context is wired.
 */
export function broadRecallSupportPolicy(
  value: unknown,
): BroadRecallSupportPolicy {
  const parsed = BroadRecallSupportContextSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== "ready") return DENY_POLICY;

  if (parsed.data.view === "compare_open") return COMPARE_POLICY;
  if (parsed.data.view === "complete") return DENY_POLICY;
  return CLOSED_WORK_POLICY;
}

/**
 * Reloads only from a validated durable event prefix. Ephemeral compare and
 * evaluation authorization is intentionally lost: an empty prefix returns to
 * closed recall, a repaired prefix returns to closed transfer, and even a
 * client-authored complete prefix cannot restore post-check surfaces.
 */
export function broadRecallSupportPolicyAfterReload(
  progressValue: unknown,
): BroadRecallSupportPolicy {
  const progress = readBroadRecallProgress(progressValue);
  if (!progress) return DENY_POLICY;

  const durableStage = broadRecallDurableStage(progress);
  return broadRecallSupportPolicy({
    kind: "ready",
    durableStage,
    view: RESTORED_VIEW_BY_DURABLE_STAGE[durableStage],
  });
}

const RESTORED_VIEW_BY_DURABLE_STAGE: Readonly<
  Record<BroadRecallDurableStage, BroadRecallSupportView>
> = Object.freeze({
  broad_attempt: "recall_closed",
  gap_repair: "repair_open",
  closed_source_transfer: "transfer_closed",
  complete: "complete",
});

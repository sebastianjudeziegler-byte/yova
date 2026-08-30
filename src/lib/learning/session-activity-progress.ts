import { z } from "zod";
import {
  BroadRecallProgressSchema,
  broadRecallProgressRank,
  mergeBroadRecallProgress,
  readBroadRecallProgress,
  type BroadRecallProgress,
} from "@/lib/learning/broad-recall-progress";
import {
  isRetrievalRoundComplete,
  recordRecall,
  revealActivePrompt,
  startRetrievalRound,
  type RetrievalRecall,
  type RetrievalRoundState,
} from "@/lib/learning/retrieval-round-progress";

const RetrievalRecallSchema = z.enum(["got_it", "partly", "missed"]);

/**
 * Privacy-safe progress for one method-specific activity.
 *
 * A retrieval round stores only the learner's bounded self-ratings in the
 * order they were made. The active prompt, retry queue, and attempt counts are
 * deterministic from that sequence, so draft answers and revealed reference
 * text never need to enter a recovery marker.
 */
export const RetrievalRoundActivityProgressSchema = z.object({
  kind: z.literal("retrieval_round"),
  activityIndex: z.number().int().min(0).max(23),
  promptCount: z.number().int().min(3).max(10),
  ratings: z.array(RetrievalRecallSchema).max(20),
}).strict().superRefine((progress, context) => {
  let state = startRetrievalRound(progress.promptCount);
  progress.ratings.forEach((rating, ratingIndex) => {
    if (isRetrievalRoundComplete(state)) {
      context.addIssue({
        code: "custom",
        path: ["ratings", ratingIndex],
        message: "A retrieval round cannot record ratings after it is complete.",
      });
      return;
    }
    state = recordRecall(revealActivePrompt(state), rating);
  });
});

export type RetrievalRoundActivityProgress = z.infer<
  typeof RetrievalRoundActivityProgressSchema
>;
export type SessionActivityProgress = RetrievalRoundActivityProgress | BroadRecallProgress;
type SessionActivityProgressInput = z.input<typeof RetrievalRoundActivityProgressSchema>
  | z.input<typeof BroadRecallProgressSchema>;

/**
 * Keep the deployed retrieval object unchanged while allowing the dedicated
 * broad-recall recovery marker through the same persistence seams. The schema
 * output is typed at the pure kernel's readonly boundary; neither branch adds
 * defaults or fields, so a parsed legacy retrieval marker serializes
 * byte-for-byte like the input object.
 */
export const SessionActivityProgressSchema: z.ZodType<
  SessionActivityProgress,
  SessionActivityProgressInput
> = z.union([
  RetrievalRoundActivityProgressSchema,
  BroadRecallProgressSchema,
]);

export type SessionActivityProgressMergeResult =
  | Readonly<{
    kind: "merged";
    source: "left" | "right" | "equal";
    progress: SessionActivityProgress | undefined;
  }>
  | Readonly<{
    kind: "conflict";
    reason: "invalid_progress" | "identity_mismatch" | "event_divergence";
  }>;
export type SessionActivityProgressConflictReason = Extract<
  SessionActivityProgressMergeResult,
  { kind: "conflict" }
>["reason"];

export function readSessionActivityProgress(value: unknown): SessionActivityProgress | null {
  const retrieval = RetrievalRoundActivityProgressSchema.safeParse(value);
  if (retrieval.success) return retrieval.data;
  return readBroadRecallProgress(value);
}

export function isRetrievalRoundActivityProgress(
  progress: SessionActivityProgress | null | undefined,
): progress is RetrievalRoundActivityProgress {
  return progress?.kind === "retrieval_round";
}

export function isBroadRecallActivityProgress(
  progress: SessionActivityProgress | null | undefined,
): progress is BroadRecallProgress {
  return progress?.kind === "broad_recall";
}

/**
 * Broad recall is never legacy activity state: its target/evidence bindings are
 * meaningful only inside an exact committed StudyRoute revision. Retrieval
 * markers predate route revisions and intentionally retain their old envelope.
 */
export function sessionActivityProgressHasRequiredRouteIdentity(
  progress: SessionActivityProgress | null | undefined,
  routeRevisionId: unknown,
) {
  return !isBroadRecallActivityProgress(progress)
    || z.string().uuid().safeParse(routeRevisionId).success;
}

type ActivityRuntimeIdentity = Readonly<{
  sourceActivityIndex?: number;
  methodRuntime?: Readonly<{
    kind?: unknown;
    format?: unknown;
    prompts?: readonly unknown[];
    gapChecklist?: readonly unknown[] | null;
    targetBindings?: readonly Readonly<{
      targetId?: unknown;
      evidenceId?: unknown;
    }>[] | null;
  }> | null;
}>;

/**
 * Recovery progress must remain compatible with the generated runtime that
 * will consume it. This blocks cross-method, prompt-count, and binding drift;
 * resource fingerprints remain the authoritative cross-resource boundary.
 */
export function sessionActivityProgressMatchesLessonRuntime(
  progress: SessionActivityProgress | null | undefined,
  activities: readonly ActivityRuntimeIdentity[],
) {
  if (!progress) return true;
  const activity = activities.find((candidate, displayIndex) => (
    (candidate.sourceActivityIndex ?? displayIndex) === progress.activityIndex
  ));
  const runtime = activity?.methodRuntime;
  if (!runtime || runtime.kind !== "retrieval_round") return false;

  if (isRetrievalRoundActivityProgress(progress)) {
    return runtime.format !== "broad_recall_v1"
      && Array.isArray(runtime.prompts)
      && runtime.prompts.length === progress.promptCount;
  }

  if (
    runtime.format !== "broad_recall_v1"
    || !Array.isArray(runtime.gapChecklist)
    || runtime.gapChecklist.length !== progress.gapCount
    || !Array.isArray(runtime.targetBindings)
    || runtime.targetBindings.length !== progress.bindings.length
  ) return false;

  return progress.bindings.every((binding, index) => {
    const runtimeBinding = runtime.targetBindings?.[index];
    return runtimeBinding?.targetId === binding.targetId
      && runtimeBinding.evidenceId === binding.evidenceId;
  });
}

export function restoreRetrievalRoundActivityProgress({
  progress,
  activityIndex,
  promptCount,
}: {
  progress: SessionActivityProgress | null | undefined;
  activityIndex: number;
  promptCount: number;
}): {
  progress: RetrievalRoundActivityProgress;
  state: RetrievalRoundState;
} {
  const parsed = RetrievalRoundActivityProgressSchema.safeParse(progress);
  const matching = parsed.success
    && parsed.data.activityIndex === activityIndex
    && parsed.data.promptCount === promptCount
    ? parsed.data
    : {
      kind: "retrieval_round" as const,
      activityIndex,
      promptCount,
      ratings: [],
    };
  let state = startRetrievalRound(promptCount);
  for (const rating of matching.ratings) {
    if (isRetrievalRoundComplete(state)) break;
    state = recordRecall(revealActivePrompt(state), rating);
  }
  return { progress: matching, state };
}

export function appendRetrievalRoundRating(
  progress: RetrievalRoundActivityProgress,
  rating: RetrievalRecall,
): RetrievalRoundActivityProgress | null {
  const next = RetrievalRoundActivityProgressSchema.safeParse({
    ...progress,
    ratings: [...progress.ratings, rating],
  });
  return next.success ? next.data : null;
}

export function retrievalRoundActivityProgressIsComplete({
  progress,
  activityIndex,
  promptCount,
}: {
  progress: SessionActivityProgress | null | undefined;
  activityIndex: number;
  promptCount: number;
}) {
  return isRetrievalRoundComplete(restoreRetrievalRoundActivityProgress({
    progress,
    activityIndex,
    promptCount,
  }).state);
}

export function sessionActivityProgressRank(progress?: SessionActivityProgress) {
  if (!progress) return 0;
  return isRetrievalRoundActivityProgress(progress)
    ? progress.ratings.length
    : broadRecallProgressRank(progress);
}

/**
 * An empty retrieval marker predates any durable learner action. By contrast,
 * a broad-recall marker is created only once its privacy-safe activity identity
 * has been bound, so even its empty event prefix can safely resume at the
 * initial broad-attempt stage.
 */
export function sessionActivityProgressIsResumable(
  progress: SessionActivityProgress | null | undefined,
) {
  if (!progress) return false;
  return isBroadRecallActivityProgress(progress) || progress.ratings.length > 0;
}

/**
 * Reconciles recovery markers as immutable histories. Missing progress is a
 * valid empty side; malformed values, activity identity changes, and divergent
 * event/rating histories are explicit conflicts rather than timestamp ties.
 */
export function mergeSessionActivityProgress(
  leftValue: unknown,
  rightValue: unknown,
): SessionActivityProgressMergeResult {
  const leftMissing = leftValue === undefined;
  const rightMissing = rightValue === undefined;
  const left = leftMissing ? undefined : readSessionActivityProgress(leftValue) ?? undefined;
  const right = rightMissing ? undefined : readSessionActivityProgress(rightValue) ?? undefined;

  if ((!leftMissing && !left) || (!rightMissing && !right)) {
    return Object.freeze({ kind: "conflict", reason: "invalid_progress" });
  }
  if (!left && !right) {
    return Object.freeze({ kind: "merged", source: "equal", progress: undefined });
  }
  if (!left && right) {
    return Object.freeze({ kind: "merged", source: "right", progress: right });
  }
  if (left && !right) {
    return Object.freeze({ kind: "merged", source: "left", progress: left });
  }
  if (!left || !right || left.kind !== right.kind) {
    return Object.freeze({ kind: "conflict", reason: "identity_mismatch" });
  }

  if (isBroadRecallActivityProgress(left) && isBroadRecallActivityProgress(right)) {
    return mergeBroadRecallProgress(left, right);
  }
  if (
    !isRetrievalRoundActivityProgress(left)
    || !isRetrievalRoundActivityProgress(right)
    || left.activityIndex !== right.activityIndex
    || left.promptCount !== right.promptCount
  ) {
    return Object.freeze({ kind: "conflict", reason: "identity_mismatch" });
  }

  const sharedLength = Math.min(left.ratings.length, right.ratings.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left.ratings[index] !== right.ratings[index]) {
      return Object.freeze({ kind: "conflict", reason: "event_divergence" });
    }
  }
  if (left.ratings.length === right.ratings.length) {
    return Object.freeze({ kind: "merged", source: "equal", progress: left });
  }
  return left.ratings.length > right.ratings.length
    ? Object.freeze({ kind: "merged", source: "left", progress: left })
    : Object.freeze({ kind: "merged", source: "right", progress: right });
}

import { z } from "zod";
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
export type SessionActivityProgress = RetrievalRoundActivityProgress;

/**
 * Keep the deployed retrieval object unchanged. Retired activity markers are
 * removed from their checkpoint or interruption envelope before this strict
 * schema is evaluated.
 */
export const SessionActivityProgressSchema = RetrievalRoundActivityProgressSchema;

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
  const retrieval = SessionActivityProgressSchema.safeParse(value);
  return retrieval.success ? retrieval.data : null;
}

export function isRetrievalRoundActivityProgress(
  progress: SessionActivityProgress | null | undefined,
): progress is RetrievalRoundActivityProgress {
  return progress?.kind === "retrieval_round";
}

export function isRetiredSessionActivityProgressMarker(value: unknown) {
  return isRecord(value) && value.kind === "broad_recall";
}

/**
 * Previously saved checkpoints and interruption outboxes can contain a marker
 * for a removed activity. Discard only that nested marker and retain the exact
 * surrounding envelope so Continue, Exit, and Save remain available.
 */
export function stripRetiredSessionActivityProgressMarker(value: unknown): unknown {
  if (!isRecord(value) || !isRetiredSessionActivityProgressMarker(value.activityProgress)) {
    return value;
  }
  const sanitized = { ...value };
  delete sanitized.activityProgress;
  return sanitized;
}

type ActivityRuntimeIdentity = Readonly<{
  sourceActivityIndex?: number;
  methodRuntime?: Readonly<{
    kind?: unknown;
    prompts?: readonly unknown[];
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

  return Array.isArray(runtime.prompts)
    && runtime.prompts.length === progress.promptCount;
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
  return progress?.ratings.length ?? 0;
}

/** An empty retrieval marker predates any durable learner action. */
export function sessionActivityProgressIsResumable(
  progress: SessionActivityProgress | null | undefined,
) {
  return Boolean(progress && progress.ratings.length > 0);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

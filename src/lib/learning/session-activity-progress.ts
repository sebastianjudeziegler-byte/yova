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

export const SessionActivityProgressSchema = RetrievalRoundActivityProgressSchema;

export type RetrievalRoundActivityProgress = z.infer<
  typeof RetrievalRoundActivityProgressSchema
>;
export type SessionActivityProgress = z.infer<typeof SessionActivityProgressSchema>;

export function readSessionActivityProgress(value: unknown): SessionActivityProgress | null {
  const parsed = SessionActivityProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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

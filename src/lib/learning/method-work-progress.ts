import { z } from "zod";

const MethodWorkTopicSchema = z.string().trim().min(1).max(240);

export const MethodWorkProgressSchema = z.object({
  checkedTopics: z.array(MethodWorkTopicSchema).max(12),
  sourceReviewed: z.boolean(),
}).strict().superRefine((progress, context) => {
  if (new Set(progress.checkedTopics).size !== progress.checkedTopics.length) {
    context.addIssue({
      code: "custom",
      message: "Method-work topics must be unique.",
      path: ["checkedTopics"],
    });
  }
});

export type MethodWorkProgress = z.infer<typeof MethodWorkProgressSchema>;

export function emptyMethodWorkProgress(): MethodWorkProgress {
  return {
    checkedTopics: [],
    sourceReviewed: false,
  };
}

export function boundedMethodWorkProgress(
  progress: MethodWorkProgress,
  topics: readonly string[],
): MethodWorkProgress {
  const availableTopics = new Set(topics);
  return {
    checkedTopics: [...new Set(progress.checkedTopics)]
      .filter((topic) => availableTopics.has(topic))
      .slice(0, 12),
    sourceReviewed: progress.sourceReviewed,
  };
}

/**
 * Method-work notes are deliberately absent. The extra unfinished step is the
 * private workpad: its text is never persisted, so a working checkpoint must
 * remain resumable even after every visible checkbox has been selected.
 */
export function methodWorkCheckpointCounts({
  progress,
  topics,
  sourceFirstRequired,
  awaitingFinish = false,
}: {
  progress: MethodWorkProgress;
  topics: readonly string[];
  sourceFirstRequired: boolean;
  awaitingFinish?: boolean;
}) {
  const bounded = boundedMethodWorkProgress(progress, topics);
  const checkedCount = bounded.checkedTopics.length
    + (sourceFirstRequired && bounded.sourceReviewed ? 1 : 0);
  const totalSteps = Math.max(1, topics.length + (sourceFirstRequired ? 1 : 0) + 1);
  const completedSteps = awaitingFinish ? totalSteps : Math.min(checkedCount, totalSteps - 1);
  return {
    completedSteps,
    totalSteps,
    resumeStep: completedSteps,
  };
}

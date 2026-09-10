import { z } from "zod";
import type { ConceptEvidence } from "@/lib/domain";
import type { WorkBlock } from "./schema";

const id = z.string().min(1).max(200);
export const BlockAttemptSchema = z.object({
  questionId: id, outcome: z.enum(["secure", "needs_review", "uncertain", "unscored"]),
  feedback: z.string().min(1).max(2_000), assisted: z.boolean(),
}).strict();
export const BlockProgressSchema = z.object({
  blockId: z.string().uuid(), sourceCompletedIds: z.array(id).max(20),
  explanationCompletedIds: z.array(id).max(20).default([]),
  attempts: z.array(BlockAttemptSchema).max(12),
  revealedQuestionIds: z.array(id).max(12), reportedQuestionIds: z.array(id).max(12),
  hintCounts: z.record(id, z.number().int().min(0).max(3)),
  complete: z.boolean(), receipt: z.string().max(2_000).nullable(),
}).strict();
export type BlockProgress = z.infer<typeof BlockProgressSchema>;
export type BlockAttempt = z.infer<typeof BlockAttemptSchema>;
export const BlockActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state") }).strict(),
  z.object({ action: z.literal("source_complete"), sourceId: id }).strict(),
  z.object({ action: z.literal("explanation_complete"), activityId: id }).strict(),
  z.object({ action: z.literal("answer"), questionId: id, answer: z.string().trim().min(1).max(3_000) }).strict(),
  z.object({ action: z.literal("hint"), questionId: id }).strict(),
  z.object({ action: z.literal("reveal"), questionId: id }).strict(),
  z.object({ action: z.literal("report"), questionId: id }).strict(),
  z.object({ action: z.literal("complete") }).strict(),
]);
export type BlockAction = z.infer<typeof BlockActionSchema>;
export function initialBlockProgress(blockId: string): BlockProgress {
  return { blockId, sourceCompletedIds: [], explanationCompletedIds: [], attempts: [], revealedQuestionIds: [], reportedQuestionIds: [], hintCounts: {}, complete: false, receipt: null };
}
export function blockCanComplete(block: WorkBlock, progress: BlockProgress) {
  return progress.blockId === block.id && block.activities.every(activity => (
    activity.sourceId ? progress.sourceCompletedIds.includes(activity.sourceId)
      : activity.kind === "ai_explanation" ? progress.explanationCompletedIds.includes(activity.id)
        : activity.questionIds.every(id => progress.attempts.some(attempt => attempt.questionId === id))
  ));
}
export function blockReceipt(block: WorkBlock, progress: BlockProgress) {
  const secure = progress.attempts.filter(attempt => attempt.outcome === "secure" && !attempt.assisted).length;
  const gaps = progress.attempts.filter(attempt => attempt.outcome === "needs_review").length;
  const unscored = progress.attempts.length - secure - gaps;
  const result = secure ? `You demonstrated ${secure} of ${block.questions.length} ideas` : "This check has not yet demonstrated an independent answer";
  const change = gaps ? `${gaps} ${gaps === 1 ? "idea still needs" : "ideas still need"} work` : unscored ? `${unscored} ${unscored === 1 ? "answer remains" : "answers remain"} unverified` : "the checked ideas are recorded";
  const next = gaps || unscored ? "use a targeted example or the source section next" : "continue to your next planned block";
  const profile = block.personalization.shortFocus ? "in your short check" : block.personalization.reflective ? "by explaining in your own words" : block.personalization.examplesFirst ? "after starting with an example" : "in this practice check";
  return `${result} ${profile}; ${change}, and ${next}.`;
}
/** Used only on the server with the stored, checked ledger. Never accepts a
 * request's outcome, topic binding, key or concept. Source ticks are absent. */
export function checkedBlockEvidence(block: WorkBlock, progress: BlockProgress, routeRevisionId: string): ConceptEvidence[] {
  if (!progress.complete || !blockCanComplete(block, progress)) return [];
  return progress.attempts.flatMap(attempt => {
    const question = block.questions.find(question => question.id === attempt.questionId);
    if (!question || attempt.assisted || !["secure", "needs_review"].includes(attempt.outcome)) return [];
    return [{ topicId: question.topicId, routeRevisionId, concept: question.prompt.slice(0, 120),
      outcome: attempt.outcome as "secure" | "needs_review", activityType: question.format === "multiple_choice" ? "multiple_choice" : "free_response",
      methodPhase: "retrieve", attempt: 1,
      ...(attempt.outcome === "needs_review" ? { misconceptionSummary: attempt.feedback.slice(0, 300) } : {}),
    }];
  });
}

/** Pure reducer of already-authorized actions. Only the server supplies the
 * evaluated attempt. Completion never depends on a self-rating. */
export function advanceBlockProgress(block: WorkBlock, stored: BlockProgress, action: BlockAction, checkedAttempt?: BlockAttempt): BlockProgress {
  if (stored.blockId !== block.id) throw new Error("This progress belongs to another block.");
  const progress = structuredClone(stored);
  if (action.action === "state") return progress;
  if (progress.complete) return progress;
  if (action.action === "source_complete") {
    if (!block.activities.some(activity => activity.sourceId === action.sourceId)) throw new Error("This source is not a required step in the block.");
    progress.sourceCompletedIds = [...new Set([...progress.sourceCompletedIds, action.sourceId])];
  } else if (action.action === "explanation_complete") {
    if (!block.activities.some(activity => activity.id === action.activityId && activity.kind === "ai_explanation")) throw new Error("This explanation is not in the block.");
    progress.explanationCompletedIds = [...new Set([...progress.explanationCompletedIds, action.activityId])];
  } else if (action.action === "complete") {
    if (!blockCanComplete(block, progress)) throw new Error("Finish the source or explanation and the practice check before completing this block.");
    progress.complete = true;
    progress.receipt = blockReceipt(block, progress);
  } else {
    const question = block.questions.find(question => question.id === action.questionId);
    if (!question) throw new Error("This question is not in the saved block.");
    const alreadyChecked = progress.attempts.some(attempt => attempt.questionId === question.id);
    if (action.action === "hint" && !alreadyChecked) {
      progress.hintCounts[question.id] = Math.min(question.hints.length, (progress.hintCounts[question.id] ?? 0) + 1);
    } else if (action.action === "reveal" || action.action === "report") {
      const list = action.action === "reveal" ? "revealedQuestionIds" : "reportedQuestionIds";
      progress[list] = [...new Set([...progress[list], question.id])];
      if (!alreadyChecked) progress.attempts.push({ questionId: question.id, outcome: "unscored", assisted: true,
        feedback: action.action === "reveal" ? "You viewed the answer. Continue when ready; this is not independent evidence." : "Question reported. You can continue; this item will not count as learning evidence." });
    } else if (action.action === "answer" && !alreadyChecked) {
      if (!checkedAttempt || checkedAttempt.questionId !== question.id) throw new Error("A server-checked answer is required.");
      progress.attempts.push(BlockAttemptSchema.parse({ ...checkedAttempt, assisted: checkedAttempt.assisted || (progress.hintCounts[question.id] ?? 0) > 0 }));
    }
  }
  return BlockProgressSchema.parse(progress);
}

export function blockCheckpointCounts(block: WorkBlock, progress?: BlockProgress | null) {
  const totalSteps = block.activities.reduce((sum, activity) => sum + Math.max(1, activity.questionIds.length), 0);
  const completedSteps = progress?.blockId === block.id ? block.activities.reduce((sum, activity) => sum + (
    activity.sourceId ? Number(progress.sourceCompletedIds.includes(activity.sourceId))
      : activity.kind === "ai_explanation" ? Number(progress.explanationCompletedIds.includes(activity.id))
        : activity.questionIds.filter(id => progress.attempts.some(attempt => attempt.questionId === id)).length
  ), 0) : 0;
  return { totalSteps, completedSteps, resumeStep: completedSteps };
}

import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CachedGeneratedSessionV19Schema } from "@/lib/session-generation/schema";
import { BlockAnswerKeySchema } from "./schema";
import { BlockProgressSchema, checkedBlockEvidence, type BlockProgress } from "./progress";

export const BlockBindingSchema = z.object({
  planId: z.string().uuid(), planSessionId: z.string().uuid(), routeRevisionId: z.string().uuid(), blockId: z.string().uuid(),
});
export type BlockBinding = z.infer<typeof BlockBindingSchema>;
const StoredBlockSchema = z.object({
  resource: CachedGeneratedSessionV19Schema, answerKeys: z.array(BlockAnswerKeySchema).min(1).max(12),
  progress: BlockProgressSchema, progressVersion: z.number().int().min(0),
});
function rpcBinding(userId: string, binding: BlockBinding) {
  return { actor_user_id: userId, requested_plan_id: binding.planId, requested_session_id: binding.planSessionId,
    requested_route_id: binding.routeRevisionId, requested_block_id: binding.blockId };
}
export async function readStoredBlock(userId: string, binding: BlockBinding) {
  const { data, error } = await createSupabaseAdminClient().rpc("read_session_work_block_v1", rpcBinding(userId, binding));
  if (error) throw new Error("This saved block changed or is no longer available. Reopen the session to continue.");
  return StoredBlockSchema.parse(data);
}
export function blockCompletionSummary(stored: z.infer<typeof StoredBlockSchema>, progress: BlockProgress, binding: BlockBinding) {
  const conceptEvidence = checkedBlockEvidence(stored.resource.block, progress, binding.routeRevisionId);
  return { correctAnswers: conceptEvidence.filter(item => item.outcome === "secure").length,
    totalAnswers: conceptEvidence.length, conceptEvidence, observedGap: conceptEvidence.filter(item => item.outcome === "needs_review").map(item => item.misconceptionSummary).join(" ") || "No independently checked gap in this block." };
}
export async function saveStoredBlockProgress(userId: string, binding: BlockBinding, stored: z.infer<typeof StoredBlockSchema>, progress: BlockProgress) {
  const { error } = await createSupabaseAdminClient().rpc("save_session_work_block_progress_v1", {
    ...rpcBinding(userId, binding), expected_version: stored.progressVersion, requested_progress: progress,
    checked_summary: progress.complete ? blockCompletionSummary(stored, progress, binding) : null,
  });
  if (error) throw new Error("Your saved progress changed in another tab. Reopen this block to use the latest saved progress.");
}
export function publicBlockProgress(stored: z.infer<typeof StoredBlockSchema>, progress: BlockProgress, binding: BlockBinding) {
  const available = new Set([...progress.revealedQuestionIds, ...progress.attempts.map(item => item.questionId)]);
  return { progress, solutions: Object.fromEntries(stored.answerKeys.filter(key => available.has(key.questionId)).map(key => [key.questionId,
    { answer: key.answer, explanation: key.explanation, workedSolution: key.workedSolution }])),
    ...(progress.complete ? { summary: blockCompletionSummary(stored, progress, binding) } : {}),
  };
}

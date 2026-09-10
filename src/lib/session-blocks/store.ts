import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CachedGeneratedSessionV19Schema } from "@/lib/session-generation/schema";
import { BlockAnswerKeySchema } from "./schema";
import { BlockProgressSchema, checkedBlockEvidence, type BlockProgress, initialBlockProgress } from "./progress";

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


// The existing development-only browser preview has no cloud account. Retain
// server-prepared keys here, never in localStorage or action requests. Normal
// authenticated use always goes through the private database ledger above.
type StoredBlock = z.infer<typeof StoredBlockSchema>;
const previewGlobal = globalThis as typeof globalThis & { yovaDevelopmentBlocks?: Map<string, { expiresAt: number; stored: StoredBlock }> };
function developmentBlocks(): Map<string, { expiresAt: number; stored: StoredBlock }> {
  if (process.env.NODE_ENV !== "development") throw new Error("Development block storage is unavailable.");
  const blocks = previewGlobal.yovaDevelopmentBlocks ??= new Map();
  for (const [key, entry] of blocks) if (entry.expiresAt <= Date.now()) blocks.delete(key);
  return blocks;
}
const developmentKey = (binding: BlockBinding) => JSON.stringify([binding.planId, binding.planSessionId, binding.routeRevisionId, binding.blockId]);
export function saveDevelopmentBlock(binding: BlockBinding, resource: unknown, answerKeys: unknown) {
  const stored = StoredBlockSchema.parse({ resource, answerKeys, progress: initialBlockProgress(binding.blockId), progressVersion: 0 });
  if (stored.resource.block.id !== binding.blockId || stored.resource.routeRevisionId !== binding.routeRevisionId) throw new Error("The prepared block does not match this preview.");
  const blocks = developmentBlocks(); const key = developmentKey(binding);
  const existing = blocks.get(key);
  if (existing) {
    if (JSON.stringify(existing.stored.resource) !== JSON.stringify(stored.resource) || JSON.stringify(existing.stored.answerKeys) !== JSON.stringify(stored.answerKeys)) throw new Error("This preview already has a different prepared block.");
    return;
  }
  while (blocks.size >= 100) blocks.delete(blocks.keys().next().value!);
  blocks.set(key, { stored, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
}
export function readDevelopmentBlock(binding: BlockBinding): StoredBlock {
  const entry = developmentBlocks().get(developmentKey(binding));
  if (!entry) throw new Error("This development preview expired. Reopen its recovery options to prepare a new block.");
  return structuredClone(entry.stored);
}
export function saveDevelopmentBlockProgress(binding: BlockBinding, stored: StoredBlock, progress: BlockProgress) {
  const entry = developmentBlocks().get(developmentKey(binding));
  if (!entry || entry.stored.progressVersion !== stored.progressVersion) throw new Error("Your practice changed in another tab. Reopen its saved progress.");
  entry.stored = { ...entry.stored, progress: BlockProgressSchema.parse(progress), progressVersion: stored.progressVersion + 1 };
}

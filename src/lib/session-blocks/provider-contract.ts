import { z } from "zod";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import type { BlockContentPlan } from "./plan";
import type { BlockAnswerKey, WorkBlock } from "./schema";

const text = (max: number) => z.string().trim().min(1).max(max);
export const BlockFillSchema = z.object({
  explanations: z.array(z.object({ topicId: z.string().uuid(), text: text(12_000) }).strict()).max(6),
  questions: z.array(z.object({
    id: text(200), topicId: z.string().uuid(), prompt: text(1_600), choices: z.array(text(500)).max(5),
    answer: text(2_000), requiredIdeas: z.array(text(600)).min(1).max(6), explanation: text(2_000),
    hints: z.array(text(700)).max(3), workedExample: text(2_500).nullable(), workedSolution: z.array(text(1_000)).max(8),
  }).strict()).min(1).max(12),
}).strict();
export type BlockFill = z.infer<typeof BlockFillSchema>;
export type BlockProviderInput = BlockContentPlan & {
  context: Pick<SessionGenerationContext, "session" | "learningGoal" | "knowledgeTopics" | "learnerProfile">;
};
export type BlockCallOptions = { signal?: AbortSignal; timeoutMs: number };
export type BlockReviewInput = {
  block: Omit<WorkBlock, "semanticReview">; answerKeys: BlockAnswerKey[];
  assignedTopics: SessionGenerationContext["knowledgeTopics"];
  deferredContent: string[];
};
export const BlockReviewSchema = z.object({
  verdict: z.enum(["pass", "fail"]), reason: text(1_200),
}).strict();
export type BlockProvider = {
  generate(input: BlockProviderInput, options: BlockCallOptions): Promise<BlockFill>;
  review(input: BlockReviewInput, options: BlockCallOptions): Promise<z.infer<typeof BlockReviewSchema>>;
  model?: string;
  usage?: () => { inputTokens: number; cachedInputTokens: number; outputTokens: number; responseId: string };
};

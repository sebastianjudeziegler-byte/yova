import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  aiUsageLimitFor,
  publicPasswordAccountsAreOpen,
  type AIUsageAction,
} from "@/lib/server/ai-usage-policy";

export type { AIUsageAction } from "@/lib/server/ai-usage-policy";

const AIUsageClaimSchema = z.object({
  allowed: z.boolean(),
  retryAfterSeconds: z.number().int().min(0).max(86_400),
  remainingToday: z.number().int().min(0),
});

const AvailableAIUsageStatusSchema = z.object({
  allowed: z.literal(true),
  limitedBy: z.null(),
  retryAfterSeconds: z.literal(0),
  remainingToday: z.number().int().min(1).max(1_000),
  resetAt: z.null(),
}).strict();

const LimitedAIUsageStatusSchema = z.object({
  allowed: z.literal(false),
  limitedBy: z.enum(["minute", "day"]),
  retryAfterSeconds: z.number().int().min(1).max(86_400),
  remainingToday: z.number().int().min(0).max(1_000),
  resetAt: z.string().datetime({ offset: true }),
}).strict().superRefine((status, context) => {
  if (status.limitedBy === "minute" && status.remainingToday === 0) {
    context.addIssue({
      code: "custom",
      message: "A zero daily balance must be classified by the daily window.",
    });
  }
  if (status.limitedBy === "day" && status.remainingToday !== 0) {
    context.addIssue({
      code: "custom",
      message: "A daily limit must have no requests remaining today.",
    });
  }
});

const AIUsageStatusSchema = z.union([
  AvailableAIUsageStatusSchema,
  LimitedAIUsageStatusSchema,
]);

export type AIUsageStatus =
  | z.infer<typeof AvailableAIUsageStatusSchema>
  | z.infer<typeof LimitedAIUsageStatusSchema>;

export class AIUsageGateError extends Error {
  constructor() {
    super("YOVA could not verify the AI usage budget.");
    this.name = "AIUsageGateError";
  }
}

export async function claimAIRequest(supabase: SupabaseClient, action: AIUsageAction) {
  const limit = aiUsageLimitFor(action, publicPasswordAccountsAreOpen());
  const { data, error } = await supabase.rpc("claim_ai_request", {
    request_action: action,
    minute_limit: limit.minute,
    day_limit: limit.day,
  });
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageClaimSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  return parsed.data;
}

/**
 * Reads the durable usage windows without incrementing either one. The
 * mutating claim remains authoritative at generation time; this snapshot is
 * only for telling the learner about a known limit before setup.
 */
export async function readAIUsageStatus(
  supabase: SupabaseClient,
  action: AIUsageAction,
): Promise<AIUsageStatus> {
  const limit = aiUsageLimitFor(action, publicPasswordAccountsAreOpen());
  const { data, error } = await supabase.rpc("read_ai_usage_status", {
    request_action: action,
    minute_limit: limit.minute,
    day_limit: limit.day,
  });
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageStatusSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  if (parsed.data.resetAt === null) return parsed.data;
  return {
    ...parsed.data,
    resetAt: new Date(parsed.data.resetAt).toISOString(),
  };
}

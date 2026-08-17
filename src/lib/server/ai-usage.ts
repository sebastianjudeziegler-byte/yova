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

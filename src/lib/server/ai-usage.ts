import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type AIUsageAction = "plan_generation" | "session_generation" | "lesson_generation" | "answer_evaluation" | "tutor_message" | "teaching_visual";

const LIMITS: Record<AIUsageAction, { minute: number; day: number }> = {
  plan_generation: { minute: 5, day: 20 },
  session_generation: { minute: 8, day: 40 },
  lesson_generation: { minute: 12, day: 80 },
  answer_evaluation: { minute: 20, day: 120 },
  tutor_message: { minute: 15, day: 80 },
  teaching_visual: { minute: 2, day: 12 },
};

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
  const limit = LIMITS[action];
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

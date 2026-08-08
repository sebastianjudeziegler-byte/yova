import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GenerationObservationSchema,
  type GenerationObservation,
} from "@/lib/analytics/generation-observation";

/**
 * Records operational facts only. Learner goals, materials, questions,
 * answers, profile data, and provider response identifiers are intentionally
 * excluded from this contract.
 */
export async function recordGenerationObservation(
  supabase: SupabaseClient | null,
  userId: string | null | undefined,
  observation: GenerationObservation,
) {
  if (!supabase || !userId) return;

  const parsed = GenerationObservationSchema.safeParse(observation);
  if (!parsed.success) {
    if (process.env.NODE_ENV === "development") {
      console.warn("YOVA rejected an invalid generation telemetry event");
    }
    return;
  }
  const { error } = await supabase.from("product_events").insert({
    user_id: userId,
    event_name: "generation_observed",
    event_data: parsed.data,
  });

  if (error && process.env.NODE_ENV === "development") {
    console.warn("YOVA could not record generation telemetry", { code: error.code });
  }
}

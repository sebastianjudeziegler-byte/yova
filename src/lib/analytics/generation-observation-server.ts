import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
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

const GENERATION_OBSERVATION_DEADLINE_MS = 2_000;

/**
 * Keeps privacy-safe generation diagnostics alive after a Route Handler sends
 * its learner response. A detached promise can be frozen as soon as a
 * serverless response finishes; Next's `after` boundary gives the insert a
 * bounded delivery window without delaying or replacing that response.
 */
export function recordGenerationObservationAfterResponse(
  ...args: Parameters<typeof recordGenerationObservation>
) {
  try {
    after(async () => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          recordGenerationObservation(...args),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, GENERATION_OBSERVATION_DEADLINE_MS);
          }),
        ]);
      } catch {
        // Telemetry must never affect the learner response.
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });
  } catch {
    // Fail closed to no telemetry outside a live Next request context.
  }
}

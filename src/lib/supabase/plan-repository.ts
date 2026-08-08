import "server-only";
import type { LearningPlan } from "@/lib/domain";
import { isSamePersistedPlan } from "@/lib/plan-generation/persisted-plan";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class PlanPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPersistenceError";
  }
}

export async function persistPlanForAuthenticatedUser(
  plan: LearningPlan,
  request: PlanGenerationRequest,
): Promise<"browser" | "supabase"> {
  if (!isSupabaseConfigured()) return "browser";

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new PlanPersistenceError("The signed-in account could not be verified while saving the plan.");

  const generationInputs = {
    intent: request.intent,
    learningIntent: request.learningIntent,
    goal: request.goal,
    startingContext: request.startingContext ?? "",
    materialMode: request.materialMode,
    materials: request.materials.map(({ id, name, mimeType, sizeBytes, processingStatus }) => ({
      id,
      name,
      mimeType,
      sizeBytes,
      processingStatus,
    })),
    studyMode: request.studyMode,
    timeZone: request.timeZone,
    diagnosticResponses: request.diagnosticResponses,
    availability: request.availability,
    profileSummary: request.profileSummary,
  };

  const { error } = await supabase.rpc("save_generated_plan", {
    payload: {
      ...plan,
      generationInputs,
    },
  });

  if (error) {
    // The database transaction may have completed even if its response was lost.
    // Confirm the exact user-owned plan before reporting failure so a safe retry is
    // indistinguishable from the original successful activation.
    const { data: existingPlan, error: lookupError } = await supabase
      .from("plans")
      .select("id,learning_item_id,status")
      .eq("id", plan.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!lookupError && isSamePersistedPlan(existingPlan, plan)) return "supabase";
    throw new PlanPersistenceError("Supabase could not persist the generated plan.");
  }
  return "supabase";
}

import "server-only";
import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function persistPlanForAuthenticatedUser(
  plan: LearningPlan,
  request: PlanGenerationRequest,
): Promise<"browser" | "supabase"> {
  if (!isSupabaseConfigured()) return "browser";

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return "browser";

  const generationInputs = {
    intent: request.intent,
    goal: request.goal,
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
    diagnosticAnswers: request.diagnosticAnswers,
    availability: request.availability,
    profileSummary: request.profileSummary,
  };

  const { error } = await supabase.rpc("save_generated_plan", {
    payload: {
      ...plan,
      generationInputs,
    },
  });

  if (error) throw new Error("Supabase could not persist the generated plan.");
  return "supabase";
}

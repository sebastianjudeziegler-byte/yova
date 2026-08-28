import "server-only";
import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { resolveSessionArchitectureVersion } from "@/lib/session-generation/architecture";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class PlanPersistenceError extends Error {
  constructor(
    message: string,
    readonly code: "persistence_failed" | "material_staging_expired" = "persistence_failed",
  ) {
    super(message);
    this.name = "PlanPersistenceError";
  }
}

export async function persistPlanForAuthenticatedUser(
  plan: LearningPlan,
  request: PlanGenerationRequest,
  draftReceiptIssuedAt: string,
): Promise<"browser" | "supabase"> {
  if (!isSupabaseConfigured()) return "browser";

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new PlanPersistenceError("The signed-in account could not be verified while saving the plan.");

  const payload = buildPlanPersistencePayload(plan, request);
  let activationPermitId: string;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "mint_plan_activation_permit_v1",
      {
        payload,
        requested_user_id: user.id,
        draft_receipt_issued_at: draftReceiptIssuedAt,
      },
    );
    if (error || !isUuid(data)) {
      throw new PlanPersistenceError(
        "The server could not authorize this exact plan activation.",
      );
    }
    activationPermitId = data;
  } catch (error) {
    if (error instanceof PlanPersistenceError) throw error;
    throw new PlanPersistenceError(
      "The server could not authorize this exact plan activation.",
    );
  }

  const { error } = await supabase.rpc("save_generated_plan_with_routes", {
    payload,
    activation_permit_id: activationPermitId,
  });

  if (error) {
    // Do not infer authority from shallow plan rows after an ambiguous network
    // response. A retry remints the exact digest, and the database returns the
    // durable consumed permit outcome without repeating the mature writer.
    if (readSupabaseErrorMessage(error).includes("material_staging_expired")) {
      throw new PlanPersistenceError(
        "A pending source expired before the plan could be saved.",
        "material_staging_expired",
      );
    }
    throw new PlanPersistenceError("Supabase could not persist the generated plan.");
  }
  return "supabase";
}

function buildPlanPersistencePayload(
  plan: LearningPlan,
  request: PlanGenerationRequest,
) {
  const generationInputs = {
    intent: request.intent,
    learningIntent: request.learningIntent,
    sessionArchitectureVersion: resolveSessionArchitectureVersion(plan, plan.knowledgeMap),
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

  const payload = {
    ...plan,
    generationInputs,
  };
  return payload;
}

function readSupabaseErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : "";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

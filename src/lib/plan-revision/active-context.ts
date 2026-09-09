import "server-only";
import { z } from "zod";
import { RevisionPlanSchema } from "@/lib/plan-revision/revision-schema";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

const ActiveRevisionContextSchema = z.object({
  plan: RevisionPlanSchema,
  generationRequest: z.record(z.string(), z.unknown()),
  sessionFingerprints: z.record(z.string(), z.string()),
  protections: z.array(z.object({ sessionId: z.string().uuid(), savedWork: z.boolean(), pinnedTime: z.boolean(),
    editedFields: z.array(z.enum(["title", "objective", "method", "methodReason", "scheduledFor", "estimatedMinutes"])),
  })),
});

/** One owner-scoped transaction reads the plan, routes, saved work and their
 * database fingerprints. No posted active-plan snapshot can replace it. */
export async function loadActiveRevisionContext(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, planId: string) {
  const result = await supabase.rpc("read_plan_revision_context", { target_plan_id: planId });
  if (result.error || !result.data) throw new Error("YOVA could not load this saved plan safely. Nothing was changed.");
  const context = ActiveRevisionContextSchema.parse(result.data);
  if (context.plan.id !== planId || context.plan.status !== "active" || context.plan.creationIntent !== "plan" || !context.plan.knowledgeMap) throw new Error("This plan is no longer available for revision.");
  const plan = context.plan;
  const generationRequest = PlanGenerationRequestSchema.parse({
    ...context.generationRequest, intent: "plan", learningIntent: plan.learningIntent,
    goal: context.generationRequest.goal ?? plan.title, knowledgeMap: plan.knowledgeMap,
    materials: plan.materials, materialMode: plan.sourceMode === "user_materials" ? "upload" : "none",
    studyMode: plan.studyMode === "outside_yova" ? "outside" : "inside", deadline: plan.deadline,
    timeZone: plan.schedulePreferences?.timeZone ?? context.generationRequest.timeZone,
    availability: plan.schedulePreferences?.availability ?? context.generationRequest.availability,
    profileSummary: context.generationRequest.profileSummary ?? "No established behavioral preferences yet.",
  });
  return { ...context, generationRequest };
}

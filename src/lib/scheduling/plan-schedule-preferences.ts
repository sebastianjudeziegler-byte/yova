import { z } from "zod";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

const SchedulePreferencesSchema = z.object({
  intent: PlanGenerationRequestSchema.shape.intent,
  timeZone: PlanGenerationRequestSchema.shape.timeZone,
  availability: PlanGenerationRequestSchema.shape.availability,
});

export function readPlanSchedulePreferences(value: unknown) {
  const parsed = SchedulePreferencesSchema.safeParse(value);
  if (!parsed.success || parsed.data.intent === "study_now") return undefined;
  return { timeZone: parsed.data.timeZone, availability: parsed.data.availability };
}

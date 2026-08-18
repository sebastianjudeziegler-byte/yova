import { z } from "zod";
import { StudyProfileSubmissionSchema } from "@/lib/study-profile/schema";

export const StudyProfileResponseRequestSchema = StudyProfileSubmissionSchema.extend({
  visitorId: z.string().uuid(),
}).strict();

export const StudyProfileInterestRequestSchema = z.object({
  waitlist: z.literal(true).optional(),
  betaInterest: z.boolean().optional(),
}).strict().refine(
  ({ waitlist, betaInterest }) => waitlist === true || typeof betaInterest === "boolean",
  { message: "Choose an early-access or beta-interest update." },
);

export type StudyProfileResponseRequest = z.infer<typeof StudyProfileResponseRequestSchema>;
export type StudyProfileInterestRequest = z.infer<typeof StudyProfileInterestRequestSchema>;

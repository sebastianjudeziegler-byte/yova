import { z } from "zod";
import {
  StudyProfileAttributionSchema,
  StudyProfileEmailSchema,
  StudyProfileMetadataSchema,
  StudyProfileStudyGoalSchema,
  StudyProfileSubmissionSchema,
} from "@/lib/study-profile/schema";

export const StudyProfileResponseRequestSchema = StudyProfileSubmissionSchema.extend({
  visitorId: z.string().uuid(),
  marketingConsent: z.literal(false).default(false),
  metadata: StudyProfileMetadataSchema.extend({
    studyGoal: StudyProfileStudyGoalSchema,
    hardestPart: z.null().optional(),
  }).strict(),
}).strict();

export const StudyProfileInterestRequestSchema = z.object({
  waitlist: z.literal(true),
  source: z.enum(["email_gate", "report_cta"]).default("report_cta"),
}).strict();

export const StudyProfileLandingWaitlistRequestSchema = z.object({
  email: StudyProfileEmailSchema,
  visitorId: z.string().uuid(),
  consent: z.literal(true),
  attribution: StudyProfileAttributionSchema.optional(),
}).strict();

export type StudyProfileResponseRequest = z.infer<typeof StudyProfileResponseRequestSchema>;
export type StudyProfileInterestRequest = z.infer<typeof StudyProfileInterestRequestSchema>;
export type StudyProfileLandingWaitlistRequest = z.infer<
  typeof StudyProfileLandingWaitlistRequestSchema
>;

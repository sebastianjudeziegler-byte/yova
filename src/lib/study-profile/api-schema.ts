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
  ageConfirmed: z.literal(true),
  marketingConsent: z.literal(false).default(false),
  waitlistConsent: z.literal(true),
  metadata: StudyProfileMetadataSchema.extend({
    studyGoal: StudyProfileStudyGoalSchema,
    hardestPart: z.null().optional(),
  }).strict(),
}).strict();

export const StudyProfileInterestRequestSchema = z.object({
  waitlist: z.literal(true),
  ageConfirmed: z.literal(true),
  source: z.enum(["email_gate", "report_cta"]).default("report_cta"),
}).strict();

export const StudyProfileLandingWaitlistRequestSchema = z.object({
  email: StudyProfileEmailSchema,
  visitorId: z.string().uuid(),
  consent: z.literal(true),
  ageConfirmed: z.literal(true),
  attribution: StudyProfileAttributionSchema.optional(),
}).strict();

export const StudyProfileWaitlistConfirmationTokenSchema = z.string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const StudyProfileWaitlistConfirmationRequestSchema = z.object({
  token: StudyProfileWaitlistConfirmationTokenSchema,
}).strict();

export type StudyProfileResponseRequest = z.infer<typeof StudyProfileResponseRequestSchema>;
export type StudyProfileInterestRequest = z.infer<typeof StudyProfileInterestRequestSchema>;
export type StudyProfileLandingWaitlistRequest = z.infer<
  typeof StudyProfileLandingWaitlistRequestSchema
>;
export type StudyProfileWaitlistConfirmationRequest = z.infer<
  typeof StudyProfileWaitlistConfirmationRequestSchema
>;

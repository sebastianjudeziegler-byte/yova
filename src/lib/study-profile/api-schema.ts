import { z } from "zod";
import {
  StudyProfileMetadataSchema,
  StudyProfileSubmissionSchema,
} from "@/lib/study-profile/schema";

export const StudyProfileResponseRequestSchema = StudyProfileSubmissionSchema.extend({
  visitorId: z.string().uuid(),
  marketingConsent: z.literal(false).default(false),
  metadata: StudyProfileMetadataSchema.extend({
    hardestPart: z.null().optional(),
  }).strict(),
}).strict();

export const StudyProfileInterestRequestSchema = z.object({
  waitlist: z.literal(true),
}).strict();

export type StudyProfileResponseRequest = z.infer<typeof StudyProfileResponseRequestSchema>;
export type StudyProfileInterestRequest = z.infer<typeof StudyProfileInterestRequestSchema>;

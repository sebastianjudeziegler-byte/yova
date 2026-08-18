import { z } from "zod";
import {
  createStudyProfileAttributionValueSchema,
  isSensitiveStudyProfileAttributionValue,
} from "@/lib/study-profile/attribution-privacy";
import { STUDY_PROFILE_MODEL_VERSION } from "@/lib/study-profile/types";

export const STUDY_PROFILE_EVENT_NAMES = [
  "study_profile_page_viewed",
  "study_profile_started",
  "study_profile_question_answered",
  "study_profile_completed",
  "study_profile_email_submitted",
  "study_profile_report_viewed",
  "study_profile_waitlist_joined",
  "study_profile_beta_interest",
] as const;

export const StudyProfileEventNameSchema = z.enum(STUDY_PROFILE_EVENT_NAMES);
export const StudyProfileVisitorIdSchema = z.string().uuid();

const ReferrerOriginSchema = z.string()
  .trim()
  .url()
  .max(320)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:")
        && (url.pathname === "/" || url.pathname === "")
        && url.search === ""
        && url.hash === ""
        && url.username === ""
        && url.password === ""
      );
    } catch {
      return false;
    }
  }, "Referrer must contain only a safe HTTP(S) origin")
  .refine(
    (value) => !isSensitiveStudyProfileAttributionValue(value),
    "Referrer must not contain an email address or private report token.",
  );

/**
 * Campaign metadata is deliberately narrow. In particular, referrers retain
 * only their origin; paths, query strings, and fragments never enter events.
 */
export const StudyProfileAnalyticsAttributionSchema = z.object({
  source: createStudyProfileAttributionValueSchema(100, { requireNonempty: true }).optional().nullable(),
  referrer: ReferrerOriginSchema.optional().nullable(),
  utmSource: createStudyProfileAttributionValueSchema(100, { requireNonempty: true }).optional().nullable(),
  utmMedium: createStudyProfileAttributionValueSchema(100, { requireNonempty: true }).optional().nullable(),
  utmCampaign: createStudyProfileAttributionValueSchema(160, { requireNonempty: true }).optional().nullable(),
  utmContent: createStudyProfileAttributionValueSchema(160, { requireNonempty: true }).optional().nullable(),
  utmTerm: createStudyProfileAttributionValueSchema(160, { requireNonempty: true }).optional().nullable(),
}).strict();

const BaseEventShape = {
  visitorId: StudyProfileVisitorIdSchema,
  modelVersion: z.literal(STUDY_PROFILE_MODEL_VERSION),
  attribution: StudyProfileAnalyticsAttributionSchema.optional(),
} as const;

const EmptyContextSchema = z.object({}).strict();

/**
 * This is the complete public analytics payload. Every variant is strict so
 * an email address, report token, answer, free response, or arbitrary context
 * cannot accidentally be added to an event.
 */
export const StudyProfileAnalyticsEventSchema = z.discriminatedUnion("eventName", [
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_page_viewed"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_started"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_question_answered"),
    context: z.object({
      questionNumber: z.number().int().min(1).max(12),
    }).strict(),
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_completed"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_email_submitted"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_report_viewed"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_waitlist_joined"),
    context: EmptyContextSchema,
  }).strict(),
  z.object({
    ...BaseEventShape,
    eventName: z.literal("study_profile_beta_interest"),
    context: z.object({
      betaInterested: z.boolean(),
    }).strict(),
  }).strict(),
]);

// Name the request schema explicitly for route handlers while retaining the
// shorter export used by domain-level tests and persistence adapters.
export const StudyProfileAnalyticsEventRequestSchema = StudyProfileAnalyticsEventSchema;

export type StudyProfileEventName = z.infer<typeof StudyProfileEventNameSchema>;
export type StudyProfileVisitorId = z.infer<typeof StudyProfileVisitorIdSchema>;
export type StudyProfileAnalyticsAttribution = z.infer<
  typeof StudyProfileAnalyticsAttributionSchema
>;
export type StudyProfileAnalyticsEvent = z.infer<typeof StudyProfileAnalyticsEventSchema>;

export type StudyProfileEventProperties = {
  study_profile_page_viewed: Record<string, never>;
  study_profile_started: Record<string, never>;
  study_profile_question_answered: { questionNumber: number };
  study_profile_completed: Record<string, never>;
  study_profile_email_submitted: Record<string, never>;
  study_profile_report_viewed: Record<string, never>;
  study_profile_waitlist_joined: Record<string, never>;
  study_profile_beta_interest: { betaInterested: boolean };
};

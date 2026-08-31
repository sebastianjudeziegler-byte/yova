import { z } from "zod";
import {
  createStudyProfileAttributionValueSchema,
  isSensitiveStudyProfileAttributionValue,
} from "@/lib/study-profile/attribution-privacy";
import {
  STUDY_PROFILE_ANSWER_IDS,
  STUDY_PROFILE_CALIBRATION_DIRECTIONS,
  STUDY_PROFILE_CLASSIFICATIONS,
  STUDY_PROFILE_DIMENSIONS,
  STUDY_PROFILE_ENERGY_WINDOWS,
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_SCORING_REVISION,
  STUDY_PROFILE_SCHOOL_LEVELS,
  STUDY_PROFILE_STUDY_GOALS,
} from "@/lib/study-profile/types";

export const StudyProfileAnswerIdSchema = z.enum(STUDY_PROFILE_ANSWER_IDS);
export const StudyProfileDimensionSchema = z.enum(STUDY_PROFILE_DIMENSIONS);
export const StudyProfileClassificationSchema = z.enum(STUDY_PROFILE_CLASSIFICATIONS);
export const StudyProfileCalibrationDirectionSchema = z.enum(
  STUDY_PROFILE_CALIBRATION_DIRECTIONS,
);
export const StudyProfileEnergyWindowSchema = z.enum(STUDY_PROFILE_ENERGY_WINDOWS);
export const StudyProfileSchoolLevelSchema = z.enum(STUDY_PROFILE_SCHOOL_LEVELS);
export const StudyProfileStudyGoalSchema = z.enum(STUDY_PROFILE_STUDY_GOALS);

export const StudyProfileAnswersSchema = z.object({
  q1: StudyProfileAnswerIdSchema,
  q2: StudyProfileAnswerIdSchema,
  q3: StudyProfileAnswerIdSchema,
  q4: StudyProfileAnswerIdSchema,
  q5: StudyProfileAnswerIdSchema,
  q6: StudyProfileAnswerIdSchema,
  q7: StudyProfileAnswerIdSchema,
  q8: StudyProfileAnswerIdSchema,
  q9: StudyProfileAnswerIdSchema,
  q10: StudyProfileAnswerIdSchema,
  q11: StudyProfileAnswerIdSchema,
  q12: StudyProfileAnswerIdSchema,
}).strict();

export function sanitizeStudyProfileFreeResponse(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OptionalFreeResponseSchema = z.string()
  .max(600)
  .transform(sanitizeStudyProfileFreeResponse)
  .transform((value) => value || null)
  .nullable()
  .optional();

export const StudyProfileMetadataSchema = z.object({
  energyWindow: StudyProfileEnergyWindowSchema,
  schoolLevel: StudyProfileSchoolLevelSchema,
  studyGoal: StudyProfileStudyGoalSchema.optional().nullable(),
  hardestPart: OptionalFreeResponseSchema,
}).strict();

const StudyProfileReferrerSchema = z.string()
  .trim()
  .url()
  .max(2_000)
  .refine(
    (value) => !isSensitiveStudyProfileAttributionValue(value),
    "Referrer must not contain an email address or private report token.",
  );

export const StudyProfileAttributionSchema = z.object({
  source: createStudyProfileAttributionValueSchema(100).optional().nullable(),
  referrer: StudyProfileReferrerSchema.optional().nullable(),
  utmSource: createStudyProfileAttributionValueSchema(100).optional().nullable(),
  utmMedium: createStudyProfileAttributionValueSchema(100).optional().nullable(),
  utmCampaign: createStudyProfileAttributionValueSchema(160).optional().nullable(),
  utmContent: createStudyProfileAttributionValueSchema(160).optional().nullable(),
  utmTerm: createStudyProfileAttributionValueSchema(160).optional().nullable(),
}).strict();

export function normalizeStudyProfileEmail(email: string) {
  return email.trim().toLocaleLowerCase("en-US");
}

export const StudyProfileEmailSchema = z.string()
  .trim()
  .max(254)
  .email()
  .transform(normalizeStudyProfileEmail);

export const StudyProfileSubmissionSchema = z.object({
  email: StudyProfileEmailSchema,
  answers: StudyProfileAnswersSchema,
  metadata: StudyProfileMetadataSchema,
  marketingConsent: z.boolean().default(false),
  attribution: StudyProfileAttributionSchema.optional(),
}).strict();

export const StudyProfileReportTokenSchema = z.string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid report token");

// PostgreSQL timestamptz values are returned by PostgREST with an explicit
// offset (for example, `+00:00`), while newly created in-memory values use `Z`.
// Both are valid ISO datetimes and must survive a persisted report reload.
const StudyProfileTimestampSchema = z.string().datetime({ offset: true });

export const StudyProfileWaitlistUpdateSchema = z.object({
  reportToken: StudyProfileReportTokenSchema,
  waitlist: z.literal(true),
}).strict();

const DimensionScoreSchema = z.object({
  dimension: StudyProfileDimensionSchema,
  rawScore: z.number().int().min(0).max(6),
  meanSeverity: z.number().min(0).max(3).optional(),
  normalizedScore: z.number().min(0).max(100),
  classification: StudyProfileClassificationSchema,
  userFacingLabel: z.string().min(1).max(80),
  salienceScore: z.number().min(0),
}).strict();

const DimensionScoresSchema = z.object({
  starting_friction: DimensionScoreSchema,
  structure_need: DimensionScoreSchema,
  attention_variability: DimensionScoreSchema,
  calibration_risk: DimensionScoreSchema,
  mistake_sensitivity: DimensionScoreSchema,
  cognitive_stamina: DimensionScoreSchema,
}).strict();

const RawScoresSchema = z.object({
  starting_friction: z.number().int().min(0).max(6),
  structure_need: z.number().int().min(0).max(6),
  attention_variability: z.number().int().min(0).max(6),
  calibration_risk: z.number().int().min(0).max(6),
  mistake_sensitivity: z.number().int().min(0).max(6),
  cognitive_stamina: z.number().int().min(0).max(6),
}).strict();

const NormalizedScoresSchema = z.object({
  starting_friction: z.number().min(0).max(100),
  structure_need: z.number().min(0).max(100),
  attention_variability: z.number().min(0).max(100),
  calibration_risk: z.number().min(0).max(100),
  mistake_sensitivity: z.number().min(0).max(100),
  cognitive_stamina: z.number().min(0).max(100),
}).strict();

const ClassificationsSchema = z.object({
  starting_friction: StudyProfileClassificationSchema,
  structure_need: StudyProfileClassificationSchema,
  attention_variability: StudyProfileClassificationSchema,
  calibration_risk: StudyProfileClassificationSchema,
  mistake_sensitivity: StudyProfileClassificationSchema,
  cognitive_stamina: StudyProfileClassificationSchema,
}).strict();

export const StudyProfilePatternSchema = z.object({
  dimension: StudyProfileDimensionSchema,
  rawScore: z.number().int().min(0).max(6),
  classification: StudyProfileClassificationSchema,
  userFacingLabel: z.string().min(1).max(80),
  salienceScore: z.number().min(0),
}).strict();

export const StudyProfileSnapshotSchema = z.object({
  modelVersion: z.literal(STUDY_PROFILE_MODEL_VERSION),
  scoringRevision: z.literal(STUDY_PROFILE_SCORING_REVISION).optional(),
  scores: DimensionScoresSchema,
  rawScores: RawScoresSchema,
  normalizedScores: NormalizedScoresSchema,
  classifications: ClassificationsSchema,
  calibrationDirection: StudyProfileCalibrationDirectionSchema,
  primaryPattern: StudyProfilePatternSchema,
  secondaryPattern: StudyProfilePatternSchema,
  isBalanced: z.boolean(),
  lowSignal: z.boolean().optional(),
}).strict();

/**
 * Client-safe shape expected after a persistence adapter maps its database row.
 * Keeping the storage vocabulary here avoids coupling report generation to
 * Supabase or a particular table layout.
 */
export const StudyProfileStoredResponseSchema = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid().optional(),
  reportToken: StudyProfileReportTokenSchema,
  profileModelVersion: z.literal(STUDY_PROFILE_MODEL_VERSION),
  rawAnswers: StudyProfileAnswersSchema,
  snapshot: StudyProfileSnapshotSchema,
  metadata: StudyProfileMetadataSchema,
  createdAt: StudyProfileTimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.responseId && value.responseId !== value.id) {
    context.addIssue({
      code: "custom",
      path: ["responseId"],
      message: "responseId must match id.",
    });
  }
}).transform((value) => ({
  ...value,
  responseId: value.id,
}));

/**
 * The client only needs enough persisted context to render and reopen a
 * report. Raw answers and optional free text intentionally remain server-side.
 */
export const StudyProfilePublicStoredResponseSchema = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
  profileModelVersion: z.literal(STUDY_PROFILE_MODEL_VERSION),
  metadata: z.object({
    energyWindow: StudyProfileEnergyWindowSchema,
    schoolLevel: StudyProfileSchoolLevelSchema,
    studyGoal: StudyProfileStudyGoalSchema.optional().nullable(),
  }).strict(),
  createdAt: StudyProfileTimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.responseId !== value.id) {
    context.addIssue({
      code: "custom",
      path: ["responseId"],
      message: "responseId must match id.",
    });
  }
});

export function toStudyProfilePublicStoredResponse(
  value: StudyProfileStoredResponse,
) {
  return StudyProfilePublicStoredResponseSchema.parse({
    id: value.id,
    responseId: value.responseId,
    profileModelVersion: value.profileModelVersion,
    metadata: {
      energyWindow: value.metadata.energyWindow,
      schoolLevel: value.metadata.schoolLevel,
      ...(value.metadata.studyGoal ? { studyGoal: value.metadata.studyGoal } : {}),
    },
    createdAt: value.createdAt,
  });
}

export type StudyProfileSubmission = z.infer<typeof StudyProfileSubmissionSchema>;
export type StudyProfileStoredResponse = z.infer<typeof StudyProfileStoredResponseSchema>;
export type StudyProfilePublicStoredResponse = z.infer<
  typeof StudyProfilePublicStoredResponseSchema
>;
export type StudyProfileAttribution = z.infer<typeof StudyProfileAttributionSchema>;

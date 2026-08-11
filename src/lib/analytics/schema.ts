import { z } from "zod";

const SourceModeSchema = z.enum(["user_materials", "yova_generated"]);
const StudyModeSchema = z.enum(["inside_yova", "outside_yova"]);

export const ProductEventRequestSchema = z.discriminatedUnion("eventName", [
  z.object({
    eventName: z.literal("onboarding_started"),
    context: z.object({}).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("onboarding_completed"),
    context: z.object({
      answeredQuestionCount: z.number().int().min(0).max(10),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("alpha_entered"),
    context: z.object({}).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("plan_created"),
    context: z.object({
      intent: z.enum(["study_now", "build_plan"]),
      sourceMode: SourceModeSchema,
      studyMode: StudyModeSchema,
      learningApproach: z.enum(["learn", "study"]),
      sessionCount: z.number().int().min(1).max(60),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("session_started"),
    context: z.object({
      sourceMode: SourceModeSchema,
      studyMode: StudyModeSchema,
      learningApproach: z.enum(["learn", "study"]),
      resumed: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("session_generated"),
    context: z.object({
      mode: z.enum(["openai", "cache"]),
      latencyMs: z.number().int().min(0).max(180_000),
      attempts: z.number().int().min(0).max(3),
      promptCacheHit: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("session_completed"),
    context: z.object({
      plannedMinutes: z.number().int().min(1).max(360),
      actualMinutes: z.number().int().min(1).max(720),
      correctAnswers: z.number().int().min(0).max(100),
      totalAnswers: z.number().int().min(0).max(100),
      feedback: z.enum(["too_easy", "about_right", "too_difficult"]),
      adaptedNextSession: z.boolean(),
      calibrationPattern: z.enum(["insufficient", "possible_misconception", "underestimated_knowledge", "well_calibrated", "mixed"]),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("session_interrupted"),
    context: z.object({
      actualMinutes: z.number().int().min(1).max(720),
      completedSteps: z.number().int().min(0).max(20),
      totalSteps: z.number().int().min(1).max(20),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("session_repair_adapted"),
    context: z.object({
      repairMode: z.enum(["hint_first", "alternate_example", "direct_correction", "smaller_steps", "retry_independently"]),
      generationMode: z.enum(["openai", "preview", "fallback"]),
      confidenceSignal: z.enum(["none", "guessing", "somewhat_sure", "very_sure"]),
    }).strict(),
  }).strict(),
  z.object({
    eventName: z.literal("tutor_message_sent"),
    context: z.object({
      linkedToPlan: z.boolean(),
      surface: z.enum(["ask_yova", "guided_session"]),
    }).strict(),
  }).strict(),
]);

export type ProductEventRequest = z.infer<typeof ProductEventRequestSchema>;

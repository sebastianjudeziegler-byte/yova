import { z } from "zod";
import { SessionDeliveryPolicySchema } from "@/lib/personalization/session-delivery-policy";

export const ConcreteRepairModeSchema = z.enum([
  "hint_first",
  "alternate_example",
  "direct_correction",
  "smaller_steps",
  "retry_independently",
]);

export const RuntimeRepairActivitySchema = z.object({
  title: z.string().trim().min(3).max(180),
  prompt: z.string().trim().min(5).max(700),
  concept: z.string().trim().min(2).max(120),
  referenceAnswer: z.string().trim().min(1).max(700),
  rubric: z.string().trim().min(5).max(700),
});

export const RuntimeRepairRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  deliveryPolicy: SessionDeliveryPolicySchema,
  confidence: z.enum(["guessing", "somewhat_sure", "very_sure"]).nullable(),
  learnerAnswer: z.string().trim().min(1).max(3_000).nullable(),
  evaluation: z.object({
    feedback: z.string().trim().min(5).max(500),
    matchedIdeas: z.array(z.string().trim().min(2).max(180)).max(4),
    missingIdeas: z.array(z.string().trim().min(2).max(180)).max(3),
  }).nullable(),
  activity: RuntimeRepairActivitySchema,
});

export const RuntimeRepairDraftSchema = z.object({
  title: z.string().trim().min(3).max(140),
  supportHeading: z.string().trim().min(3).max(100),
  explanation: z.string().trim().min(15).max(520),
  steps: z.array(z.string().trim().min(5).max(220)).max(4),
  retryPrompt: z.string().trim().min(10).max(320),
  targetReminder: z.string().trim().min(10).max(220),
});

export const RuntimeRepairSupportSchema = RuntimeRepairDraftSchema.extend({
  mode: ConcreteRepairModeSchema,
  modeLabel: z.string().trim().min(3).max(80),
  personalizationReason: z.string().trim().min(10).max(300),
});

export const RuntimeRepairResponseSchema = z.object({
  repair: RuntimeRepairSupportSchema,
  generation: z.object({
    mode: z.enum(["openai", "preview", "fallback"]),
  }),
});

export type ConcreteRepairMode = z.infer<typeof ConcreteRepairModeSchema>;
export type RuntimeRepairRequest = z.infer<typeof RuntimeRepairRequestSchema>;
export type RuntimeRepairDraft = z.infer<typeof RuntimeRepairDraftSchema>;
export type RuntimeRepairSupport = z.infer<typeof RuntimeRepairSupportSchema>;
export type RuntimeRepairResponse = z.infer<typeof RuntimeRepairResponseSchema>;

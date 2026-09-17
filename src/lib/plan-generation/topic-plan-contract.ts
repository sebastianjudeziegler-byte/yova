import { z } from "zod";

/** Persisted, code-owned work contract shared by plan cards and session runtime. */
export const TopicWorkloadSchema = z.object({
  version: z.literal("topic_workload_v1"),
  topicSubtopics: z.array(z.object({ topicId: z.string().uuid(), subtopics: z.array(z.string().min(2).max(500)).max(12) })).min(1).max(4),
  questionCount: z.number().int().min(0).max(32),
  recallQuestionCount: z.number().int().min(0).max(32),
  transferQuestionCount: z.number().int().min(0).max(32),
  produceSteps: z.number().int().min(0).max(4),
  sourceReadMinutes: z.number().int().min(0).max(60),
  estimatedMinutes: z.number().int().min(8).max(60),
  ceilingMinutes: z.number().int().min(8).max(60),
  practicePlaceholder: z.boolean(),
  practiceRound: z.number().int().min(0).max(3),
  suggestedDate: z.boolean(),
  ruleIds: z.array(z.string().min(1).max(120)).max(40),
}).superRefine((work, context) => {
  if (work.recallQuestionCount + work.transferQuestionCount !== work.questionCount) context.addIssue({code:"custom",path:["questionCount"],message:"Question types must account for all planned questions."});
  if (work.estimatedMinutes > work.ceilingMinutes) context.addIssue({code:"custom",path:["estimatedMinutes"],message:"Planned work exceeds its profile ceiling."});
});
export type TopicWorkload = z.infer<typeof TopicWorkloadSchema>;
export const TopicPlanModelSchema = z.object({
  version: z.literal("topic_plan_v2"),
  learningGoal: z.string().min(10).max(600),
  ruleIds: z.array(z.string().min(1).max(120)).max(60),
  personalizationSentence: z.string().max(1600),
  scheduleMode: z.enum(["fixed", "movable", "learner_placed"]),
  collapsedQueue: z.boolean(),
  topicNotes: z.array(z.object({topicId:z.string().uuid(), note:z.string().max(600), learnBlockCount:z.number().int().min(0).max(3), topicWeight:z.number().positive()})).max(40),
  constraints: z.array(z.string().max(400)).max(40).default([]),
});
export type TopicPlanModel = z.infer<typeof TopicPlanModelSchema>;

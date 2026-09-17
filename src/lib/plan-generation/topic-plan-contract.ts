import { z } from "zod";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";

const WorkloadFieldsSchema = z.object({
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
});

function checkBudget(work: z.infer<typeof WorkloadFieldsSchema>, context: z.RefinementCtx) {
  if (work.recallQuestionCount + work.transferQuestionCount !== work.questionCount) context.addIssue({ code: "custom", path: ["questionCount"], message: "Question types must account for all planned questions." });
  if (work.estimatedMinutes > work.ceilingMinutes) context.addIssue({ code: "custom", path: ["estimatedMinutes"], message: "Planned work exceeds its profile ceiling." });
}

/** One execution unit; immediate Study Now may retain its existing bounded scope. */
export const SingleTopicWorkloadSchema = WorkloadFieldsSchema.strict().superRefine(checkBudget);
export type SingleTopicWorkload = z.infer<typeof SingleTopicWorkloadSchema>;
export const TopicWorkloadSegmentSchema = z.object({
  segmentId: z.string().min(1).max(80),
  learningMode: z.enum(["learn", "study"]),
  taskType: z.enum(LEARNING_TASK_TYPES),
  workload: SingleTopicWorkloadSchema.refine(work => work.topicSubtopics.length === 1, "Each segment executes one topic."),
}).strict();
export type TopicWorkloadSegment = z.infer<typeof TopicWorkloadSegmentSchema>;

/** A shared ceiling may contain at most two independently ready topic segments.
 * Larger totals are valid only as exact aggregates of those bounded segments. */
export const TopicWorkloadSchema = WorkloadFieldsSchema.extend({
  questionCount: z.number().int().min(0).max(64),
  recallQuestionCount: z.number().int().min(0).max(64),
  transferQuestionCount: z.number().int().min(0).max(64),
  segments: z.tuple([TopicWorkloadSegmentSchema, TopicWorkloadSegmentSchema]).optional(),
}).superRefine((work, context) => {
  checkBudget(work, context);
  if (!work.segments) {
    if (work.questionCount > 32) context.addIssue({ code: "custom", path: ["questionCount"], message: "A single execution unit cannot exceed 32 questions." });
    return;
  }
  const [first, second] = work.segments;
  const reject = (message: string) => context.addIssue({ code: "custom", path: ["segments"], message });
  if (first.segmentId === second.segmentId || first.workload.topicSubtopics[0]!.topicId === second.workload.topicSubtopics[0]!.topicId) reject("Segments must have distinct identities and topics.");
  if (first.learningMode !== second.learningMode || first.taskType !== second.taskType) reject("Segments must share their learning mode and task family.");
  if (JSON.stringify(work.topicSubtopics) !== JSON.stringify(work.segments.flatMap(segment => segment.workload.topicSubtopics))) reject("The parent scope must exactly match its segments.");
  for (const field of ["questionCount", "recallQuestionCount", "transferQuestionCount", "produceSteps", "sourceReadMinutes", "estimatedMinutes"] as const) {
    if (work[field] !== first.workload[field] + second.workload[field]) reject(`The parent ${field} must equal its segment total.`);
  }
  if (work.segments.some(segment => segment.workload.ceilingMinutes > work.ceilingMinutes || segment.workload.practiceRound !== work.practiceRound || segment.workload.practicePlaceholder !== work.practicePlaceholder || segment.workload.suggestedDate !== work.suggestedDate)) reject("Segment scheduling and ceilings must match their shared block.");
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

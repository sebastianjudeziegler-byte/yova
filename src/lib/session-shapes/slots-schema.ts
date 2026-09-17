import { z } from "zod";
import { PRACTICE_ROUND_KINDS } from "@/lib/practice/practice-rounds";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { KeyPointSchema, PracticeQuestionSchema } from "@/lib/practice/compose-practice";
import { SessionTipSchema, TipRequestSchema } from "@/lib/session-shapes/session-tips";

/**
 * The AI generation contract for the baseline session shapes
 * (docs/redesign/04-AI-SLOTS.md). Four bounded slots. The AI never authors a
 * session and never decides structure; these schemas are the whole surface.
 *
 * Shared by the API route and the browser client, so they contain no server
 * imports.
 */
export const SHAPE_SLOT_ACTIONS = ["direction", "learn_block", "compare", "practice"] as const;
export type ShapeSlotAction = (typeof SHAPE_SLOT_ACTIONS)[number];

/** What is known about the learner's material, for Slot 1. Never the material itself. */
export const SourceDescriptionSchema = z.object({
  /** e.g. "Unit 3 slides", "Chapter 4 PDF", "the video you added". */
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["slides", "notes", "document", "link", "video", "other"]),
  /** e.g. "pages 4–9"; null when the section cannot be located. */
  location: z.string().trim().min(1).max(120).nullable(),
}).strict();

export type SourceDescription = z.infer<typeof SourceDescriptionSchema>;

export const ShapeTopicSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().min(8).max(400),
  subtopics: z.array(z.string().trim().min(2).max(500)).max(12).default([]),
  taskType: z.enum(LEARNING_TASK_TYPES),
  /** The course/exam objective survives narrowing the session to one topic. */
  learningGoal: z.string().trim().min(1).max(1_200).optional(),
  relatedTopics: z.array(z.object({ id: z.string().uuid(), title: z.string().trim().min(2).max(140), subtopics: z.array(z.string().trim().min(2).max(500)).max(12) }).strict()).max(3).optional(),
}).strict();

/** Profile modifiers that shape wording. IDs only, never labels or prose. */
export const ShapeProfileModifiersSchema = z.object({
  instructionStyle: z.enum(["standard", "numbered_steps", "plain_restated"]),
  /** Question-type counts for a five-question round (route.questionMix); code scales and plans slots from it. */
  questionMix: z.object({
    recall: z.number().int().min(0).max(32),
    application: z.number().int().min(0).max(32),
    compare_contrast: z.number().int().min(0).max(32),
    prediction: z.number().int().min(0).max(32),
    misconception: z.number().int().min(0).max(32),
  }).strict(),
  produceStep: z.enum(["typed_explanation", "concept_map", "outline", "retrieval_questions", "worked_solution"]).nullable(),
  explanationFocus: z.enum(["concept", "worked_example"]).nullable(),
  questionCap: z.number().int().min(1).max(32),
  /** Questions a first round aims for: route.questionTarget (Brief 1.5 item 4). */
  questionTarget: z.number().int().min(1).max(32),
  workloadBounded: z.boolean().optional(),
}).strict();

/** Bounded excerpts of the learner's material for Slot 3 and Slot 4. */
export const SourceExcerptSchema = z.object({
  label: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(4_000),
}).strict();

export type SourceExcerpt = z.infer<typeof SourceExcerptSchema>;

const RequestBase = {
  requestId: z.string().uuid(),
  /** Second UUID so a lost receipt can be recovered without double billing. */
  recoveryKey: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  topic: ShapeTopicSchema,
  modifiers: ShapeProfileModifiersSchema,
  /** The hub tips this call writes, with the fired-rule reasons each may draw on (Brief 1.5 item 6). */
  tips: TipRequestSchema,
};

/** Tips written in this call, each on a reason it was offered. */
const ResponseTips = z.array(SessionTipSchema).max(5).default([]);

/** A concrete worked example: a title and its steps (Brief 1.5 item 5). */
export const WorkedExampleSchema = z.object({
  title: z.string().trim().min(8).max(160),
  steps: z.array(z.string().trim().min(8).max(300)).min(2).max(6),
}).strict();
export type WorkedExample = z.infer<typeof WorkedExampleSchema>;
export const PracticeProblemSchema = z.object({ prompt: z.string().trim().min(12).max(700), referenceSolution: z.string().trim().min(12).max(1_800) }).strict();

export const DirectionRequestSchema = z.object({
  ...RequestBase,
  action: z.literal("direction"),
  /** null only when the learner studies outside YOVA with no material added. */
  source: SourceDescriptionSchema.nullable(),
  /** Inside: point at material before producing in-app. Outside: directions, then practice (Brief 1.5 item 8). */
  purpose: z.enum(["study_inside", "study_outside"]).default("study_inside"),
  entry: z.enum(["study_full", "brief_review"]),
  /** The learner's material, when an example should be drawn from it. */
  excerpts: z.array(SourceExcerptSchema).max(8).default([]),
  /** Examples-first learners (Q5 concrete_example / Q10 examples_before_ready). */
  wantsExample: z.boolean().default(false),
}).strict();

export const LearnBlockRequestSchema = z.object({
  ...RequestBase,
  action: z.literal("learn_block"),
}).strict();

export const CompareRequestSchema = z.object({
  ...RequestBase,
  action: z.literal("compare"),
  /** What the learner produced, as plain text (a concept map is flattened). */
  produced: z.string().trim().min(1).max(6_000),
  /** A single optional correction check; the original remains separate. */
  revision: z.object({
    originalProduced: z.string().trim().min(1).max(6_000),
    originalComparison: z.object({
      feedback: z.string().trim().min(1).max(1_200),
      missing: z.array(z.string().max(240)).max(6),
      incorrect: z.array(z.string().max(240)).max(6),
    }).strict(),
  }).strict().optional(),
  mapItems: z.array(z.object({ id: z.string().min(1).max(40), kind: z.enum(["concept", "link"]), label: z.string().min(1).max(500) }).strict()).max(30).optional(),
  /** The source excerpts or, on the no-source path, the key points. */
  reference: z.object({
    excerpts: z.array(SourceExcerptSchema).max(8).default([]),
    keyPoints: z.array(KeyPointSchema).max(24).default([]),
    /** Generated task context is separate from server-authorized uploaded excerpts. */
    practiceProblem: PracticeProblemSchema.optional(),
  }).strict(),
}).strict();

export const PracticeRequestSchema = z.object({
  ...RequestBase,
  action: z.literal("practice"),
  round: z.number().int().min(1).max(6),
  /** Key points from an earlier learn block, when the topic has them; otherwise the topic is the source. */
  keyPoints: z.array(KeyPointSchema).max(24).default([]),
  outstandingKeyPointIds: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  excerpts: z.array(SourceExcerptSchema).max(8).default([]),
  /** A nonce so every attempt gets fresh questions rather than a cached bank. */
  attempt: z.string().uuid(),
  /** Which practice round this is (Brief 1.5 item 3); decided in code from the route and the round number. */
  roundKind: z.enum(PRACTICE_ROUND_KINDS).default("active_recall"),
  /** Error Repair only: each missed question, the answer chosen and the correct answer. */
  repairTargets: z.array(z.object({
    keyPointId: z.string().trim().min(1).max(40),
    question: z.string().trim().min(8).max(500),
    chosenAnswer: z.string().trim().min(1).max(240),
    correctAnswer: z.string().trim().min(1).max(240),
  }).strict()).max(8).default([]),
}).strict();

export const ShapeSlotRequestSchema = z.discriminatedUnion("action", [
  DirectionRequestSchema,
  LearnBlockRequestSchema,
  CompareRequestSchema,
  PracticeRequestSchema,
]);

export type DirectionRequest = z.infer<typeof DirectionRequestSchema>;
export type LearnBlockRequest = z.infer<typeof LearnBlockRequestSchema>;
export type CompareRequest = z.infer<typeof CompareRequestSchema>;
export type PracticeRequest = z.infer<typeof PracticeRequestSchema>;
export type ShapeSlotRequest = z.infer<typeof ShapeSlotRequestSchema>;

/** Slot 1 — two sentences: what to look at, how to approach it. */
export const DirectionResponseSchema = z.object({
  action: z.literal("direction"),
  whatToLookAt: z.string().trim().min(8).max(300),
  howToApproach: z.string().trim().min(8).max(300),
  origin: z.enum(["generated", "template"]),
  /** A worked example drawn only from the learner's material; null when none could be shown. */
  example: WorkedExampleSchema.nullable(),
  practiceProblem: PracticeProblemSchema.nullable().optional(),
  tips: ResponseTips,
}).strict();

/**
 * Slot 2 — one call, one shared context: the explanation, the key points
 * derived from it, and the practice questions derived from the key points.
 * Practice cannot test what the explanation did not cover.
 */
export const LearnBlockResponseSchema = z.object({
  action: z.literal("learn_block"),
  explanation: z.string().trim().min(200).max(6_000),
  keyPoints: z.array(KeyPointSchema).min(3).max(5),
  questions: z.array(PracticeQuestionSchema).min(1).max(32),
  /** The worked structure shown before producing, when the profile asks for one. */
  structure: z.array(z.string().trim().min(2).max(200)).min(2).max(8),
  /** The explanation's own concrete example, restated as steps (Brief 1.5 item 5). */
  example: WorkedExampleSchema,
  practiceProblem: PracticeProblemSchema.nullable().optional(),
  tips: ResponseTips,
}).strict();

/** Slot 3 — what is missing or wrong. Feedback, never a verdict. */
export const CompareResponseSchema = z.object({
  action: z.literal("compare"),
  feedback: z.string().trim().min(20).max(1_200),
  missing: z.array(z.string().trim().min(2).max(240)).max(6),
  incorrect: z.array(z.string().trim().min(2).max(240)).max(6),
  itemFeedback: z.array(z.object({ targetId: z.string().min(1).max(40), message: z.string().min(2).max(240) }).strict()).max(18).optional(),
  tips: ResponseTips,
}).strict();

/** Slot 4 — fresh questions per attempt, checked in code. */
export const PracticeResponseSchema = z.object({
  action: z.literal("practice"),
  keyPoints: z.array(KeyPointSchema).min(1).max(24),
  questions: z.array(PracticeQuestionSchema).min(1).max(32),
  tips: ResponseTips,
}).strict();

export const ShapeSlotResponseSchema = z.discriminatedUnion("action", [
  DirectionResponseSchema,
  LearnBlockResponseSchema,
  CompareResponseSchema,
  PracticeResponseSchema,
]);

export type DirectionResponse = z.infer<typeof DirectionResponseSchema>;
export type LearnBlockResponse = z.infer<typeof LearnBlockResponseSchema>;
export type CompareResponse = z.infer<typeof CompareResponseSchema>;
export type PracticeResponse = z.infer<typeof PracticeResponseSchema>;
export type ShapeSlotResponse = z.infer<typeof ShapeSlotResponseSchema>;

/** The honest error shown when a slot cannot be filled. Never fabricated content. */
export const SHAPE_SLOT_HONEST_ERROR = "YOVA couldn't build this. Try again, or add material for this topic.";

export const ShapeSlotErrorSchema = z.object({
  error: z.string().trim().min(1).max(400),
  code: z.enum(["provider_unavailable", "generation_failed", "unauthorized", "invalid_request", "rate_limited", "allowance_exhausted", "not_operational"]),
}).strict();
export type ShapeSlotError = z.infer<typeof ShapeSlotErrorSchema>;

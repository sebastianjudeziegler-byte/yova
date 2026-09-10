import { z } from "zod";
import { hasDistinctLearningChoices, learningContentKey } from "@/lib/session-generation/learning-notation";

export const BLOCK_ACTIVITY_KINDS = [
  "watch_source_section", "read_source_section", "ai_explanation", "flashcards", "quiz", "problems",
] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const localId = text(200);

export const BlockSourceSchema = z.object({
  id: localId, topicId: z.string().uuid(), materialId: z.string().uuid().nullable(),
  url: z.url().refine(value => /^https?:\/\//i.test(value), "Sources must use HTTP or HTTPS.").nullable(),
  kind: z.enum(["watch_source_section", "read_source_section"]),
  title: text(300), section: text(300), text: text(16_000),
}).strict().refine(source => source.materialId !== null || source.url !== null, "A source needs an authorized material or link.");

export const BlockQuestionSchema = z.object({
  id: localId, topicId: z.string().uuid(),
  format: z.enum(["multiple_choice", "short_answer", "flashcard", "problem"]),
  prompt: text(1_600), choices: z.array(text(500)).max(5),
  hints: z.array(text(700)).max(3), workedExample: text(2_500).nullable(),
  reflectBeforeCheck: z.boolean(),
}).strict().superRefine((question, context) => {
  if (question.format === "multiple_choice") {
    if (question.choices.length < 3 || !hasDistinctLearningChoices(question.choices)) {
      context.addIssue({ code: "custom", path: ["choices"], message: "A multiple-choice question needs at least three distinct choices." });
    }
  } else if (question.choices.length) {
    context.addIssue({ code: "custom", path: ["choices"], message: "Only multiple-choice questions carry answer choices." });
  }
});

export const BlockActivitySchema = z.object({
  id: localId, kind: z.enum(BLOCK_ACTIVITY_KINDS), topicId: z.string().uuid(),
  title: text(200), instructions: text(1_000),
  sourceId: localId.nullable(), questionIds: z.array(localId).max(12),
  estimatedMinutes: z.number().int().min(1).max(180),
  content: z.string().trim().max(12_000).default(""),
}).strict();

/** Public saved work only. This is neither a scoring receipt nor permission
 * to write evidence. The server owns reviewed content and checked results. */
export const WorkBlockSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), topicIds: z.array(z.string().uuid()).min(1).max(6),
  learningMode: z.enum(["learn", "study"]), objective: text(800), instructions: text(1_000),
  stoppingPoint: text(800), estimatedMinutes: z.number().int().min(5).max(180),
  sources: z.array(BlockSourceSchema).max(20),
  activities: z.array(BlockActivitySchema).min(1).max(20),
  questions: z.array(BlockQuestionSchema).min(1).max(12),
  personalization: z.object({
    profileReason: text(800), examplesFirst: z.boolean(), hintsAvailable: z.boolean(),
    shortFocus: z.boolean(), reflective: z.boolean(), setSize: z.number().int().min(1).max(12),
  }).strict(),
  semanticReview: z.object({
    policyVersion: z.literal("block_semantic_v1"), status: z.literal("passed"),
    reviewedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict().superRefine((block, context) => {
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  for (const values of [block.topicIds, block.sources.map(item => item.id), block.activities.map(item => item.id), block.questions.map(item => item.id)]) {
    if (new Set(values).size !== values.length) reject("Block identifiers must be distinct.");
  }
  for (const item of [...block.sources, ...block.activities, ...block.questions]) {
    if (!block.topicIds.includes(item.topicId)) reject("Every source, activity and question must bind to an assigned block topic.");
  }
  if (block.activities.reduce((sum, activity) => sum + Math.max(1, activity.questionIds.length), 0) > 24) reject("A block exceeds the saved-progress step limit.");
  const usedQuestions: string[] = [];
  for (const activity of block.activities) {
    const isSource = activity.kind === "read_source_section" || activity.kind === "watch_source_section";
    const isPractice = ["flashcards", "quiz", "problems"].includes(activity.kind);
    if (isSource) {
      const source = block.sources.find(item => item.id === activity.sourceId);
      if (!source || source.topicId !== activity.topicId || source.kind !== activity.kind) reject("A source activity must use its own topic's matching section.");
    } else if (activity.sourceId !== null) reject("Only a source activity can require a source step.");
    if (activity.kind === "ai_explanation" && !activity.content) reject("An AI explanation needs reviewed explanation content.");
    if (isPractice !== (activity.questionIds.length > 0)) reject("Every practice activity needs questions; source and explanation steps cannot collect practice evidence.");
    for (const id of activity.questionIds) {
      const question = block.questions.find(item => item.id === id);
      const formats = activity.kind === "flashcards" ? ["flashcard"] : activity.kind === "problems" ? ["problem"] : ["multiple_choice", "short_answer"];
      if (!question || question.topicId !== activity.topicId || !formats.includes(question.format)) reject("Practice questions must match their activity kind and topic.");
      usedQuestions.push(id);
    }
  }
  if (usedQuestions.length !== block.questions.length || new Set(usedQuestions).size !== block.questions.length) reject("Each saved question must appear exactly once in the block.");
  if (block.personalization.setSize !== block.questions.length) reject("The displayed set size must match the saved question set.");
  const prompts = block.questions.map(question => `${question.topicId}:${learningContentKey(question.prompt, true)}`);
  if (new Set(prompts).size !== prompts.length) reject("The block repeats an identical practice prompt.");
  for (const topicId of block.topicIds) {
    const activities = block.activities.filter(activity => activity.topicId === topicId);
    const sources = block.sources.filter(source => source.topicId === topicId);
    if (!activities.some(activity => activity.questionIds.length)) reject("Each active topic needs a practice check.");
    const teaching = activities.filter(activity => activity.kind === "ai_explanation" || activity.sourceId !== null);
    if (block.learningMode === "study") {
      if (teaching.length) reject("Practice-mode work must open with practice; sources and help remain optional.");
    } else if (sources.length) {
      if (activities[0]?.sourceId === null || activities.some(activity => activity.kind === "ai_explanation")) reject("A sourced learn topic must start with its source, without a default AI explanation.");
    } else if (activities[0]?.kind !== "ai_explanation") reject("An unsourced learn topic must start with an AI explanation.");
  }
});

export type WorkBlock = z.infer<typeof WorkBlockSchema>;
export type BlockQuestion = z.infer<typeof BlockQuestionSchema>;
export type BlockSource = z.infer<typeof BlockSourceSchema>;

/** Private answer keys never come from an attempt request. */
export const BlockAnswerKeySchema = z.object({
  questionId: localId, answer: text(2_000), requiredIdeas: z.array(text(600)).min(1).max(6),
  explanation: text(2_000), workedSolution: z.array(text(1_000)).max(8),
  sourceIds: z.array(localId).max(20),
}).strict();
export type BlockAnswerKey = z.infer<typeof BlockAnswerKeySchema>;

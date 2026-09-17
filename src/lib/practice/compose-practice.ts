import { z } from "zod";
import { BASE_MIX_SIZE, QUESTION_TYPES, type QuestionSlot } from "@/lib/practice/question-mix";

/**
 * Practice composition. See docs/redesign/04-AI-SLOTS.md "Practice
 * Composition" and Brief 1.5 items 1–2. Counts, question types, which key
 * points each question may draw on, and rounds are code; the model only writes
 * the question for each slot.
 */
export const KeyPointSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text: z.string().trim().min(8).max(400),
}).strict();

/** A question as the learner receives it: its type and key points come from the code-planned slot, never from the model. */
export const PracticeQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  slotId: z.string().trim().min(1).max(40),
  kind: z.enum(QUESTION_TYPES),
  keyPointIds: z.array(z.string().trim().min(1).max(40)).min(1).max(2),
  prompt: z.string().trim().min(8).max(500),
  choices: z.array(z.string().trim().min(1).max(240)).length(4),
  correctChoiceIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(8).max(500),
}).strict();

/** What the model writes for one slot. */
export const QuestionDraftSchema = z.object({
  slotId: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(8).max(500),
  choices: z.array(z.string().trim().min(1).max(240)).length(4),
  correctChoiceIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(8).max(500),
}).strict();

export type KeyPoint = z.infer<typeof KeyPointSchema>;
export type PracticeQuestion = z.infer<typeof PracticeQuestionSchema>;
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;

/**
 * Round 1 asks a five-question mix (the size the task-type table is written
 * for), within the route cap. Later rounds ask one question per missed key
 * point, within the cap: a retry checks each missed point to the round-1
 * standard and must not demand three questions from one or two points
 * (Brief 1.5 item 1: that mismatch returned 502 on the ordinary retry).
 */
export function roundQuestionCount({ round, keyPointCount, questionCap, baseSize = BASE_MIX_SIZE }: { round: number; keyPointCount: number; questionCap: number; baseSize?: number }) {
  if (round > 1) return Math.max(1, Math.min(questionCap, keyPointCount));
  return Math.max(1, Math.min(questionCap, Math.max(baseSize, keyPointCount)));
}

/** Key points a generated first round derives: three to five, never more than it has questions for. */
export function firstRoundKeyPointCount(questionCount: number) {
  return Math.min(5, Math.max(3, questionCount));
}

/**
 * The key points a round must cover. Round 1 covers everything; later rounds
 * only what was missed.
 */
export function keyPointsForRound(keyPoints: readonly KeyPoint[], round: number, outstandingKeyPointIds: readonly string[]): KeyPoint[] {
  if (round <= 1) return [...keyPoints];
  return keyPoints.filter((keyPoint) => outstandingKeyPointIds.includes(keyPoint.id));
}

/**
 * Deterministic binding of model drafts to code-planned slots: every slot
 * filled exactly once, nothing outside the plan, distinct choices, and every
 * slot's key points known. Type and key points are copied from the slot.
 * Returns the questions in slot (generation) order or a reason.
 */
export function composePracticeRound({ keyPoints, slots, drafts }: {
  keyPoints: readonly KeyPoint[];
  slots: readonly QuestionSlot[];
  drafts: readonly unknown[];
}): { ok: true; questions: PracticeQuestion[] } | { ok: false; reason: string } {
  if (slots.length === 0) return { ok: false, reason: "No question slots were planned." };
  const known = new Set(keyPoints.map((keyPoint) => keyPoint.id));
  if (slots.some((slot) => slot.keyPointIds.some((id) => !known.has(id)))) return { ok: false, reason: "A slot referenced a key point this round does not have." };
  const planned = new Map(slots.map((slot) => [slot.slotId, slot]));
  const filled = new Map<string, QuestionDraft>();
  for (const candidate of drafts) {
    const parsed = QuestionDraftSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, reason: `A question was malformed: ${parsed.error.issues[0]?.message ?? "unknown"}.` };
    if (!planned.has(parsed.data.slotId)) return { ok: false, reason: "A question filled a slot that was not planned." };
    if (filled.has(parsed.data.slotId)) return { ok: false, reason: "Two questions filled one slot." };
    if (new Set(parsed.data.choices.map(normalizeChoice)).size !== parsed.data.choices.length) return { ok: false, reason: "A question repeated a choice." };
    filled.set(parsed.data.slotId, parsed.data);
  }
  const missing = slots.filter((slot) => !filled.has(slot.slotId));
  if (missing.length) return { ok: false, reason: `Only ${filled.size} of ${slots.length} planned questions were written.` };
  return {
    ok: true,
    questions: slots.map((slot) => {
      const written = filled.get(slot.slotId)!;
      return { id: slot.slotId, slotId: slot.slotId, kind: slot.type, keyPointIds: [...slot.keyPointIds], prompt: written.prompt, choices: written.choices, correctChoiceIndex: written.correctChoiceIndex, explanation: written.explanation };
    }),
  };
}

function normalizeChoice(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

import { z } from "zod";
import {
  PRACTICE_QUESTION_MAXIMUM,
  PRACTICE_QUESTION_MINIMUM,
  type QuestionWeighting,
  type SessionRoute,
} from "@/lib/routing/session-route";

/**
 * Practice composition. See docs/redesign/04-AI-SLOTS.md "Practice
 * Composition". Counts, clamps, ordering and rounds are code; the model only
 * writes the questions.
 */
export const PRACTICE_QUESTION_KINDS = ["definition", "term", "relationship", "compare_contrast", "structure", "application"] as const;
export type PracticeQuestionKind = (typeof PRACTICE_QUESTION_KINDS)[number];

export const KeyPointSchema = z.object({
  id: z.string().trim().min(1).max(40),
  text: z.string().trim().min(8).max(400),
}).strict();

export const PracticeQuestionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  keyPointId: z.string().trim().min(1).max(40),
  kind: z.enum(PRACTICE_QUESTION_KINDS),
  prompt: z.string().trim().min(8).max(500),
  choices: z.array(z.string().trim().min(1).max(240)).length(4),
  correctChoiceIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(8).max(500),
}).strict();

export type KeyPoint = z.infer<typeof KeyPointSchema>;
export type PracticeQuestion = z.infer<typeof PracticeQuestionSchema>;

const TERM_KINDS: readonly PracticeQuestionKind[] = ["definition", "term"];
const RELATIONSHIP_KINDS: readonly PracticeQuestionKind[] = ["compare_contrast", "relationship", "structure"];

/** One question per key point, clamped 3–8, then the route's cap (Q9 shorter sections, short timer band). */
export function practiceQuestionCount(keyPointCount: number, route: Pick<SessionRoute, "questionCap" | "questionMinimum">) {
  const clamped = Math.min(PRACTICE_QUESTION_MAXIMUM, Math.max(PRACTICE_QUESTION_MINIMUM, keyPointCount));
  return Math.max(route.questionMinimum, Math.min(route.questionCap, clamped));
}

/** Stable ordering: the weighted kinds first, original order preserved within each group. */
export function orderQuestionsByWeighting(questions: readonly PracticeQuestion[], weighting: QuestionWeighting): PracticeQuestion[] {
  const first = weighting === "terms_first" ? TERM_KINDS : RELATIONSHIP_KINDS;
  const rank = (question: PracticeQuestion) => (first.includes(question.kind) ? 0 : 1);
  return questions
    .map((question, index) => ({ question, index }))
    .sort((a, b) => rank(a.question) - rank(b.question) || a.index - b.index)
    .map((entry) => entry.question);
}

/**
 * The key points a round must cover. Round 1 covers everything; later rounds
 * only what was missed. Returns the ordered subset to request questions for.
 */
export function keyPointsForRound(keyPoints: readonly KeyPoint[], round: number, outstandingKeyPointIds: readonly string[]): KeyPoint[] {
  if (round <= 1) return [...keyPoints];
  return keyPoints.filter((keyPoint) => outstandingKeyPointIds.includes(keyPoint.id));
}

/**
 * Deterministic validation of a generated question set against the key
 * points and the route: no question outside the key points, distinct choices,
 * a correct index that points at a choice, and the count inside the clamp.
 * Returns the ordered, trimmed set or a reason it cannot be used.
 */
export function composePracticeRound({ keyPoints, questions, route, round = 1, outstandingKeyPointIds = [] }: {
  keyPoints: readonly KeyPoint[];
  questions: readonly PracticeQuestion[];
  route: Pick<SessionRoute, "questionCap" | "questionMinimum" | "weighting">;
  round?: number;
  outstandingKeyPointIds?: readonly string[];
}): { ok: true; questions: PracticeQuestion[] } | { ok: false; reason: string } {
  const roundKeyPoints = keyPointsForRound(keyPoints, round, outstandingKeyPointIds);
  const allowed = new Set(roundKeyPoints.map((keyPoint) => keyPoint.id));
  const seenIds = new Set<string>();
  const usable: PracticeQuestion[] = [];
  for (const question of questions) {
    const parsed = PracticeQuestionSchema.safeParse(question);
    if (!parsed.success) return { ok: false, reason: `A question was malformed: ${parsed.error.issues[0]?.message ?? "unknown"}.` };
    if (!allowed.has(parsed.data.keyPointId)) return { ok: false, reason: "A question tested something outside this round's key points." };
    if (seenIds.has(parsed.data.id)) return { ok: false, reason: "Two questions shared an id." };
    if (new Set(parsed.data.choices.map(normalizeChoice)).size !== parsed.data.choices.length) return { ok: false, reason: "A question repeated a choice." };
    seenIds.add(parsed.data.id);
    usable.push(parsed.data);
  }
  const target = practiceQuestionCount(roundKeyPoints.length, route);
  // Prefer one question per key point before any second question on the same point.
  const perKeyPoint = new Map<string, PracticeQuestion[]>();
  for (const question of usable) perKeyPoint.set(question.keyPointId, [...(perKeyPoint.get(question.keyPointId) ?? []), question]);
  const firstPass = roundKeyPoints.flatMap((keyPoint) => perKeyPoint.get(keyPoint.id)?.slice(0, 1) ?? []);
  const secondPass = roundKeyPoints.flatMap((keyPoint) => perKeyPoint.get(keyPoint.id)?.slice(1) ?? []);
  const selected = [...firstPass, ...secondPass].slice(0, target);
  if (selected.length < Math.min(target, route.questionMinimum)) {
    return { ok: false, reason: `Only ${selected.length} usable questions were produced; at least ${Math.min(target, route.questionMinimum)} are needed.` };
  }
  return { ok: true, questions: orderQuestionsByWeighting(selected, route.weighting) };
}

function normalizeChoice(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

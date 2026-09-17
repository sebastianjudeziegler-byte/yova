/**
 * Topic difficulty (Brief 1.5 item 4): deterministic, from the knowledge map.
 * `difficulty = f(subtopicCount, prerequisiteDepth)`, where prerequisite depth
 * is the number of topics that must precede this one. Not a model rating, not
 * description length. Only the high band changes anything: more questions.
 * Never shown to the learner (founder decision).
 */
export const DIFFICULTY_BANDS = ["low", "medium", "high"] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

export const HIGH_BAND_QUESTION_COUNT = 8;
const MEDIUM_BAND_MINIMUM_SCORE = 3;
const HIGH_BAND_MINIMUM_SCORE = 6;

type PrerequisiteTopic = { id: string; prerequisiteTopicIds: readonly string[]; removed?: boolean };

/** Distinct topics that must precede `topicId`, transitively, ignoring removed topics. */
export function prerequisiteDepth(topicId: string, topics: readonly PrerequisiteTopic[]) {
  const byId = new Map(topics.filter((topic) => !topic.removed).map((topic) => [topic.id, topic]));
  const seen = new Set<string>();
  const pending = [...(byId.get(topicId)?.prerequisiteTopicIds ?? [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === topicId || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    pending.push(...byId.get(id)!.prerequisiteTopicIds);
  }
  return seen.size;
}

/** Score = subtopics + prerequisite depth: low ≤ 2, medium 3–5, high ≥ 6. */
export function difficultyBand({ subtopicCount, prerequisiteDepth: depth }: { subtopicCount: number; prerequisiteDepth: number }): DifficultyBand {
  const score = subtopicCount + depth;
  if (score >= HIGH_BAND_MINIMUM_SCORE) return "high";
  if (score >= MEDIUM_BAND_MINIMUM_SCORE) return "medium";
  return "low";
}

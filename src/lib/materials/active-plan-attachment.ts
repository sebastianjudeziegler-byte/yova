import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  type KnowledgeMapTopic,
  type MaterialUnderstanding,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";

export class MaterialPlanRebuildRequiredError extends Error {
  constructor(message = "This source changes the plan's topic map. Create a new plan from the material so YOVA can rebuild the remaining sessions safely.") {
    super(message);
    this.name = "MaterialPlanRebuildRequiredError";
  }
}

/**
 * Adds authoritative mapped chunk references to the existing topic identities
 * used by unfinished sessions. The function deliberately refuses to invent a
 * semantic match: a source that adds a new topic needs a plan rebuild instead
 * of being labelled attached while later sessions silently ignore it.
 */
export function reconcileMappedMaterialsIntoActivePlan(input: {
  knowledgeMap: PlanKnowledgeMap;
  understandings: MaterialUnderstanding[];
  unfinishedTopicIds: readonly string[];
}) {
  const knowledgeMap = PlanKnowledgeMapSchema.parse(input.knowledgeMap);
  const understandings = input.understandings.map((understanding) => (
    MaterialUnderstandingSchema.parse(understanding)
  ));
  const unfinishedTopicIds = new Set(input.unfinishedTopicIds);
  const referencesByTopicId = new Map<string, KnowledgeMapTopic["sourceReferences"]>();

  for (const understanding of understandings) {
    let mapsToUnfinishedScope = false;
    for (const materialTopic of understanding.topics) {
      if (materialTopic.sourceReferences.length === 0) {
        throw new MaterialPlanRebuildRequiredError(
          "YOVA mapped the source topic but could not bind it to a durable source section. Reprocess the material before changing this plan.",
        );
      }

      const alignedCandidates = knowledgeMap.topics
        .map((planTopic) => ({
          planTopic,
          score: topicAlignmentScore(planTopic, materialTopic),
        }))
        .filter((candidate) => candidate.score >= 0.58)
        .sort((left, right) => right.score - left.score);
      const candidates = alignedCandidates.filter(({ planTopic }) => unfinishedTopicIds.has(planTopic.id));
      // The source may repeat material the learner already completed. Keep the
      // completed topic byte-for-byte and reconcile only future session scope.
      if (candidates.length === 0 && alignedCandidates.length > 0) continue;
      const bestScore = candidates[0]?.score ?? 0;
      const bestMatches = candidates.filter((candidate) => candidate.score >= bestScore - 0.04);
      if (bestMatches.length === 0) throw new MaterialPlanRebuildRequiredError();

      for (const { planTopic } of bestMatches) {
        if (unfinishedTopicIds.has(planTopic.id)) mapsToUnfinishedScope = true;
        const current = referencesByTopicId.get(planTopic.id) ?? [];
        referencesByTopicId.set(
          planTopic.id,
          deduplicateReferences([...current, ...materialTopic.sourceReferences]),
        );
      }
    }
    if (!mapsToUnfinishedScope) {
      throw new MaterialPlanRebuildRequiredError(
        "One of these sources only matches work the plan has already completed. Create a new plan from it if it should change what comes next.",
      );
    }
  }

  return PlanKnowledgeMapSchema.parse({
    ...knowledgeMap,
    topics: knowledgeMap.topics.map((topic) => {
      const newReferences = referencesByTopicId.get(topic.id);
      if (!newReferences) return topic;
      return {
        ...topic,
        origin: "material" as const,
        sourceReferences: deduplicateReferences([
          ...topic.sourceReferences,
          ...newReferences,
        ]),
      };
    }),
  });
}

function topicAlignmentScore(left: KnowledgeMapTopic, right: KnowledgeMapTopic) {
  const leftTitle = normalizePhrase(left.title);
  const rightTitle = normalizePhrase(right.title);
  if (leftTitle === rightTitle) return 1;
  if (
    Math.min(leftTitle.length, rightTitle.length) >= 8
    && (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle))
  ) return 0.92;

  const leftTitleTokens = meaningfulTokens(left.title);
  const rightTitleTokens = meaningfulTokens(right.title);
  const titleScore = tokenCoverage(leftTitleTokens, rightTitleTokens);
  const leftContextTokens = meaningfulTokens([left.title, left.description, ...left.subtopics].join(" "));
  const rightContextTokens = meaningfulTokens([right.title, right.description, ...right.subtopics].join(" "));
  const contextScore = tokenCoverage(leftContextTokens, rightContextTokens);
  const sharedTitleTokens = intersection(leftTitleTokens, rightTitleTokens);
  const rareTitleBridge = sharedTitleTokens.some((token) => token.length >= 8)
    && Math.min(leftTitleTokens.size, rightTitleTokens.size) <= 3;

  return Math.max(
    titleScore * 0.82 + contextScore * 0.18,
    rareTitleBridge ? 0.62 + contextScore * 0.18 : 0,
    contextScore >= 0.66 && intersection(leftContextTokens, rightContextTokens).length >= 2
      ? 0.58 + contextScore * 0.2
      : 0,
  );
}

function normalizePhrase(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function meaningfulTokens(value: string) {
  return new Set(normalizePhrase(value)
    .split(/\s+/u)
    .map(normalizeToken)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function normalizeToken(token: string) {
  if (token.length > 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokenCoverage(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  const denominator = Math.min(left.size, right.size);
  if (denominator === 0) return 0;
  return intersection(left, right).length / denominator;
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return [...left].filter((token) => right.has(token));
}

function deduplicateReferences(references: KnowledgeMapTopic["sourceReferences"]) {
  return [...new Map(references.map((reference) => [reference.chunkId, reference])).values()].slice(0, 40);
}

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "being", "between", "build", "compare", "complete",
  "concept", "course", "describe", "explain", "from", "guide", "identify", "into", "learn",
  "lesson", "material", "overview", "plan", "practice", "review", "session", "should", "study",
  "that", "their", "these", "this", "through", "topic", "understand", "using", "what", "when",
  "where", "which", "with", "your",
]);

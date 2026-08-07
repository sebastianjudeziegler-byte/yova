export type SessionCompletionContract = {
  essentialIdeas: string[];
  evidenceMap: Array<{
    essentialIdea: string;
    activityConcept: string;
  }>;
  activities: Array<{
    type: "instruction" | "multiple_choice" | "free_response" | "reflection";
    concept: string | null;
    requiredForCompletion: boolean;
  }>;
};

type CompletionMappedDraft = {
  coverage: {
    evidenceMap: Array<{ essentialIdea: string; activityConcept: string }>;
  };
  activities: SessionCompletionContract["activities"];
};

/**
 * The model sometimes names the same checked idea at two levels of detail,
 * such as "term sheets" in the map and "investment terms" on the question.
 * Reconcile only a unique lexical match so harmless label drift does not make
 * YOVA discard an otherwise valid lesson.
 */
export function reconcileSessionCompletionMap<T extends CompletionMappedDraft>(draft: T): T {
  const requiredConcepts = unique(
    draft.activities
      .filter((activity) => (
        activity.requiredForCompletion
        && (activity.type === "multiple_choice" || activity.type === "free_response")
        && activity.concept
      ))
      .map((activity) => activity.concept?.trim() ?? ""),
  );

  return {
    ...draft,
    coverage: {
      ...draft.coverage,
      evidenceMap: draft.coverage.evidenceMap.map((mapping) => ({
        ...mapping,
        activityConcept: canonicalActivityConcept(mapping, requiredConcepts),
      })),
    },
  };
}

/**
 * Completion is about demonstrated content, not elapsed time or button clicks.
 * Every stated essential idea must point to a required knowledge check that the
 * learner will actually attempt before the session can finish.
 */
export function validateSessionCompletionContract(
  contract: SessionCompletionContract,
): string | null {
  const essentialIdeas = new Map(
    contract.essentialIdeas.map((idea) => [normalize(idea), idea.trim()]),
  );
  const requiredConcepts = new Set(
    contract.activities
      .filter((activity) => (
        activity.requiredForCompletion
        && (activity.type === "multiple_choice" || activity.type === "free_response")
        && activity.concept
      ))
      .map((activity) => normalize(activity.concept ?? "")),
  );
  const mappedIdeas = new Set<string>();

  for (const mapping of contract.evidenceMap) {
    const ideaKey = normalize(mapping.essentialIdea);
    if (!essentialIdeas.has(ideaKey)) {
      return `The completion map references “${mapping.essentialIdea},” which is not one of this session's essential ideas.`;
    }
    if (mappedIdeas.has(ideaKey)) {
      return `The essential idea “${essentialIdeas.get(ideaKey)}” appears more than once in the completion map.`;
    }
    mappedIdeas.add(ideaKey);

    if (!matchesRequiredConcept(mapping.activityConcept, requiredConcepts)) {
      return `The essential idea “${essentialIdeas.get(ideaKey)}” points to “${mapping.activityConcept},” but no required knowledge check uses that concept.`;
    }
  }

  const missingIdea = [...essentialIdeas.entries()].find(([key]) => !mappedIdeas.has(key));
  if (missingIdea) {
    return `The essential idea “${missingIdea[1]}” has no required knowledge check in the completion map.`;
  }

  return null;
}

function matchesRequiredConcept(value: string, requiredConcepts: Set<string>) {
  const mappedConcept = normalize(value);
  if (requiredConcepts.has(mappedConcept)) return true;

  const compatibleConcepts = [...requiredConcepts].filter((candidate) => (
    candidate.includes(mappedConcept) || mappedConcept.includes(candidate)
  ));
  return compatibleConcepts.length === 1;
}

function canonicalActivityConcept(
  mapping: { essentialIdea: string; activityConcept: string },
  requiredConcepts: string[],
) {
  const exact = requiredConcepts.find((concept) => normalize(concept) === normalize(mapping.activityConcept));
  if (exact) return exact;

  const containing = requiredConcepts.filter((concept) => {
    const candidate = normalize(concept);
    const mapped = normalize(mapping.activityConcept);
    return candidate.includes(mapped) || mapped.includes(candidate);
  });
  if (containing.length === 1) return containing[0];

  const sourceTokens = meaningfulTokens(`${mapping.activityConcept} ${mapping.essentialIdea}`);
  const ranked = requiredConcepts
    .map((concept) => ({
      concept,
      score: meaningfulTokens(concept).filter((token) => sourceTokens.includes(token)).length,
    }))
    .sort((left, right) => right.score - left.score);
  if (ranked[0]?.score && ranked[0].score > (ranked[1]?.score ?? 0)) return ranked[0].concept;
  return mapping.activityConcept;
}

function meaningfulTokens(value: string) {
  const ignored = new Set(["a", "an", "and", "are", "as", "at", "be", "for", "from", "idea", "in", "is", "of", "on", "or", "startup", "that", "the", "this", "to", "what", "when", "with"]);
  return unique(normalize(value).split(" ")
    .map((token) => token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2 && !ignored.has(token)));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

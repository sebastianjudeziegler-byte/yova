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

    if (!requiredConcepts.has(normalize(mapping.activityConcept))) {
      return `The essential idea “${essentialIdeas.get(ideaKey)}” points to “${mapping.activityConcept},” but no required knowledge check uses that concept.`;
    }
  }

  const missingIdea = [...essentialIdeas.entries()].find(([key]) => !mappedIdeas.has(key));
  if (missingIdea) {
    return `The essential idea “${missingIdea[1]}” has no required knowledge check in the completion map.`;
  }

  return null;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

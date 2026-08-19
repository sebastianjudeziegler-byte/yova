import type { LearningPlan, SessionCompletion } from "@/lib/domain";
import { completionCreatesTopicEvidence } from "@/lib/learning/session-completion-provenance";

type TopicStatus = "not_started" | "taught" | "evidenced" | "secure";

/**
 * Derives the browser-visible topic state without allowing an unguided,
 * self-reported completion to masquerade as teaching or evidence.
 */
export function displayedTopicStatus(
  topicId: string,
  storedStatus: TopicStatus,
  plan: LearningPlan,
  completions: SessionCompletion[],
): TopicStatus {
  const evidence = completions
    .filter(completionCreatesTopicEvidence)
    .flatMap((completion) => completion.conceptEvidence)
    .filter((item) => item.topicId === topicId);
  const secureAttempts = evidence.filter((item) => item.outcome === "secure").length;
  if (storedStatus === "secure" || secureAttempts >= 2) return "secure";
  if (storedStatus === "evidenced" || evidence.length > 0) return "evidenced";

  const topicWasTaught = plan.sessions.some((session) => {
    if (session.status !== "complete" || !session.topicIds?.includes(topicId)) return false;
    const matchingCompletions = completions.filter((completion) => (
      completion.planSessionId === session.id
    ));
    // A legacy completed session without an attempt in the browser snapshot
    // keeps its historical behavior. Explicit unguided provenance fails closed.
    return matchingCompletions.length === 0
      || matchingCompletions.some(completionCreatesTopicEvidence);
  });
  if (storedStatus === "taught" || topicWasTaught) return "taught";
  return "not_started";
}

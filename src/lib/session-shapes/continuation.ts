import type { LearningPlan, LearningPlanSession } from "@/lib/domain";

/** Attribute only the topic that produced a checked point. */
export function baselineOutcomeTopicId({ plan, session, sourceTopicId, interleavedTopicIds = [] }: {
  plan: Pick<LearningPlan, "knowledgeMap">;
  session: Pick<LearningPlanSession, "topicIds" | "workload">;
  sourceTopicId?: string;
  interleavedTopicIds?: readonly string[];
}): string | undefined {
  const topicIds = session.topicIds ?? [];
  const known = new Set(plan.knowledgeMap?.topics.map(topic => topic.id) ?? []);
  const executed = new Set([...(session.workload?.topicSubtopics.map(topic => topic.topicId) ?? topicIds), ...interleavedTopicIds]);
  if (sourceTopicId !== undefined) return known.has(sourceTopicId) && executed.has(sourceTopicId) ? sourceTopicId : undefined;
  const legacy = topicIds.length === 1 ? topicIds[0] : undefined;
  return legacy && known.has(legacy) && executed.has(legacy) ? legacy : undefined;
}

/** Offer the next queued work only: practice must be due, while a suggested
 * learning date may be advanced by the learner's explicit continuation choice. */
export function nextReadyBaselineSession(plan: LearningPlan, completedSessionId: string, now: Date) {
  const current = plan.sessions.find((session) => session.id === completedSessionId);
  if (!current) return null;
  const next = plan.sessions.filter((session) => session.sequence > current.sequence && (session.status === "ready" || session.status === "upcoming")).sort((left, right) => left.sequence - right.sequence)[0];
  if (!next) return null;
  const canLearnEarly = next.learningMode === "learn" && next.workload?.suggestedDate === true;
  if (Date.parse(next.scheduledFor) > now.getTime() && !canLearnEarly) return null;
  const completed = (id: string) => {
    const topic = plan.knowledgeMap?.topics.find((candidate) => candidate.id === id);
    if (topic && ["evidenced", "secure"].includes(topic.status)) return true;
    if (topic?.initialEvidence?.outcome === "demonstrated") return true;
    const learns = plan.sessions.filter((session) => session.topicIds?.includes(id) && (session.learningMode === "learn" || session.learningMode === "study"));
    return learns.length > 0 && learns.every((session) => session.status === "complete" || session.id === completedSessionId);
  };
  const prerequisitesReady = (next.topicIds ?? []).every((id) => {
    const topic = plan.knowledgeMap?.topics.find((candidate) => candidate.id === id);
    return !topic || topic.prerequisiteTopicIds.every(completed);
  });
  return prerequisitesReady ? next : null;
}

/** Completion notes name the assessment they refer to and never turn an unavailable check into a clean result. */
export function baselineObservedGap(result: {
  escalated: boolean;
  comparison: { missing: string[]; incorrect: string[] } | null;
  comparisonUnavailable?: boolean;
  revision?: { status: "checked" | "unchecked"; comparison: { missing: string[]; incorrect: string[] } | null };
}, roundCeiling: number) {
  if (result.escalated) return `Some practice points still need review after ${roundCeiling} rounds; passed points remain recorded.`;
  if (result.comparisonUnavailable) return "Comparison unavailable; submitted work was kept without assessment.";
  const comparison = result.revision?.status === "checked" ? result.revision.comparison : result.comparison;
  const gaps = [...(comparison?.missing ?? []), ...(comparison?.incorrect ?? [])].join("; ");
  if (result.revision?.status === "unchecked") return `Correction unchecked. Original comparison: ${gaps || "no gaps named"}.`.slice(0, 500);
  if (result.revision?.status === "checked") return `Correction feedback: ${gaps || "no remaining gaps named"}.`.slice(0, 500);
  return (gaps || "No remaining gap identified.").slice(0, 500);
}

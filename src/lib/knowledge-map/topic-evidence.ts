import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";

type PlacementEvidence = Extract<NonNullable<KnowledgeMapTopic["initialEvidence"]>, { source: "placement_check" }>;

/** A declaration changes the starting activity, never the measured record. */
export function learnerReportedCoverage(topic: KnowledgeMapTopic) {
  return topic.initialEvidence?.source === "learner_report";
}

/** Shared by placement summaries, route evidence, and measured gap readers.
 * The report has neither an observedAt timestamp nor a scored outcome. */
export function measuredPlacementEvidence(topic: Pick<KnowledgeMapTopic, "initialEvidence" | "placementEvidence">): PlacementEvidence | null {
  return topic.initialEvidence?.source === "placement_check"
    ? topic.initialEvidence
    : topic.placementEvidence ?? null;
}

export function withReportedCoverage(topic: KnowledgeMapTopic): KnowledgeMapTopic {
  if (learnerReportedCoverage(topic)) return topic;
  const measured = measuredPlacementEvidence(topic);
  return {
    ...topic,
    ...(measured ? { placementEvidence: measured } : {}),
    initialEvidence: { source: "learner_report", outcome: "covered_elsewhere", checked: false },
  };
}

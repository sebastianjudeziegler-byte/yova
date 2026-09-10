import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import type { AppliedMapDelta, MapDeltaOperation } from "@/lib/plan-revision/map-delta";
import { measuredPlacementEvidence } from "@/lib/knowledge-map/topic-evidence";

export type RevisionSessionProtection = Readonly<{
  sessionId: string;
  savedWork: boolean;
  pinnedTime: boolean;
  editedFields: readonly ("title" | "objective" | "method" | "methodReason" | "scheduledFor" | "estimatedMinutes")[];
}>;
export type RevisionDependency = Readonly<{ topicId: string; predecessorTopicId: string; reason: "prerequisite" | "chosen_order" }>;
export type RevisionScope = Readonly<{
  affectedSessionIds: readonly string[];
  newTopicIds: readonly string[];
  removedTopicIds: readonly string[];
  notBeforeByTopic: Readonly<Record<string, string>>;
  dependencies: readonly RevisionDependency[];
  protectedSessionIds: readonly string[];
  blockers: readonly { topicId: string; message: string }[];
}>;

const unfinished = (session: LearningPlanSession) => session.status === "ready" || session.status === "upcoming";
const endAt = (session: LearningPlanSession) => Date.parse(session.scheduledFor) + session.estimatedMinutes * 60_000;

/** Select future WORK, including overdue unstarted sessions. A pin protects
 * the selected time; completed/opened work protects the entire session. */
export function selectRevisionSessionScope({ plan, applied, operations, protections, now, fitsSchedule }: {
  plan: LearningPlan;
  applied: AppliedMapDelta;
  operations: readonly MapDeltaOperation[];
  protections: readonly RevisionSessionProtection[];
  now: Date;
  fitsSchedule: (session: LearningPlanSession) => boolean;
}): RevisionScope {
  const protection = new Map(protections.map(item => [item.sessionId, item]));
  const protectedIds = new Set(plan.sessions.filter(session => !unfinished(session) || Boolean(session.resource) || Boolean(session.reviewType || session.reviewConcept) || protection.get(session.id)?.savedWork).map(session => session.id));
  const ordered = [...plan.sessions].sort((a, b) => a.sequence - b.sequence);
  const future = ordered.filter(session => unfinished(session) && !protectedIds.has(session.id));
  const affected = new Set<string>();
  const changed = new Set(applied.changedTopicIds);
  const added = new Set(applied.addedTopicIds);
  const removed = new Set(applied.removedTopicIds);
  const notBefore = new Map<string, number>();
  const dependencies: RevisionDependency[] = [];
  const blockers: Array<{ topicId: string; message: string }> = [];
  const map = applied.request.knowledgeMap as PlanKnowledgeMap;
  const topics = new Map(map.topics.map(topic => [topic.id, topic]));

  for (const [index, operation] of operations.entries()) {
    if (!applied.lines.some(line => line.operationIndex === index)) continue;
    if (operation.op === "set_deadline" || operation.op === "set_availability") {
      for (const session of future) {
        if (fitsSchedule(session)) continue;
        if (protection.get(session.id)?.pinnedTime) {
          blockers.push({ topicId: session.topicIds?.[0] ?? "", message: `The fixed time for ${session.title} falls outside the new schedule. Keep the current schedule or explicitly move this block.` });
        } else affected.add(session.id);
      }
      for (const session of ordered.filter(item => unfinished(item) && protectedIds.has(item.id))) {
        if (!fitsSchedule(session)) blockers.push({ topicId: session.topicIds?.[0] ?? "", message: `${session.title} already has saved work and cannot move into this schedule.` });
      }
      continue;
    }
    if (operation.op === "add_topic") {
      const id = applied.lines.find(line => line.operationIndex === index)?.topicId;
      const position = id ? map.topics.findIndex(topic => topic.id === id) : -1;
      const precedingId = operation.after_topic_id ?? (position > 0 ? map.topics[position - 1]?.id : undefined);
      if (id && precedingId) dependencies.push({ topicId: id, predecessorTopicId: precedingId, reason: "chosen_order" });
      continue;
    }
    if (!changed.has(operation.topic_id)) continue;
    const sessions = future.filter(session => session.topicIds?.includes(operation.topic_id));
    if (operation.op === "remove_topic" || operation.op === "reorder") {
      for (const session of sessions) affected.add(session.id);
    } else if (sessions[0]) {
      affected.add(sessions[0].id);
    } else {
      // An opened session stays exact. If there is no later untouched work,
      // the declaration can add a separate bounded practice/source block.
      added.add(operation.topic_id);
    }
    if (operation.op === "reorder") dependencies.push({ topicId: operation.topic_id, predecessorTopicId: operation.after_topic_id, reason: "chosen_order" });
  }

  const rebuildingTopics = new Set([...added, ...future.filter(session => affected.has(session.id)).flatMap(session => session.topicIds ?? [])]);
  for (const id of rebuildingTopics) {
    if (removed.has(id)) continue;
    for (const predecessorId of topics.get(id)?.prerequisiteTopicIds ?? []) {
      dependencies.push({ topicId: id, predecessorTopicId: predecessorId, reason: "prerequisite" });
    }
  }
  const uniqueDependencies = [...new Map(dependencies.map(dependency => [`${dependency.topicId}:${dependency.predecessorTopicId}`, dependency])).values()];
  for (const dependency of uniqueDependencies) {
    const predecessor = topics.get(dependency.predecessorTopicId);
    if (dependency.reason === "prerequisite" && predecessor && (
      predecessor.status === "secure" || predecessor.status === "evidenced"
      || measuredPlacementEvidence(predecessor)?.outcome === "demonstrated"
    )) continue;
    // A rebuilt prerequisite supplies its NEW end time during topological
    // composition; never constrain the dependent using its obsolete slot.
    if (rebuildingTopics.has(dependency.predecessorTopicId) && !removed.has(dependency.predecessorTopicId)) continue;
    const first = ordered.find(session => session.status !== "skipped" && !affected.has(session.id) && session.topicIds?.includes(dependency.predecessorTopicId));
    if (!first) {
      blockers.push({ topicId: dependency.topicId, message: `${topics.get(dependency.topicId)?.title ?? "This topic"} needs an earlier block for ${predecessor?.title ?? "its prerequisite"}. Include that topic or adjust the order.` });
      continue;
    }
    notBefore.set(dependency.topicId, Math.max(now.getTime(), notBefore.get(dependency.topicId) ?? 0, endAt(first)));
  }
  return {
    affectedSessionIds: [...affected], newTopicIds: [...added], removedTopicIds: [...removed],
    notBeforeByTopic: Object.fromEntries([...notBefore].map(([id, timestamp]) => [id, new Date(timestamp).toISOString()])),
    dependencies: uniqueDependencies, protectedSessionIds: [...protectedIds], blockers,
  };
}

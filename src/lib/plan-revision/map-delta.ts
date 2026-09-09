import { z } from "zod";
import { makeUuid } from "@/lib/domain";
import { PlanGenerationRequestSchema, type PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { PlanKnowledgeMapSchema, type PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

const topicId = z.string().uuid();
const source = z.union([
  z.object({ material_id: z.string().uuid() }).strict(),
  z.object({ url: z.url().max(2048).refine(value => ["https:", "http:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS source link.") }).strict(),
]);

export const MapDeltaOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_topic"), title: z.string().trim().min(2).max(140), description: z.string().trim().min(8).max(400), after_topic_id: topicId.optional(), source_refs: z.array(source).max(5).optional() }).strict(),
  z.object({ op: z.literal("remove_topic"), topic_id: topicId }).strict(),
  z.object({ op: z.literal("mark_covered"), topic_id: topicId }).strict(),
  z.object({ op: z.literal("attach_source"), topic_id: topicId, material_id: z.string().uuid().optional(), url: z.url().max(2048).refine(value => ["https:", "http:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS source link.").optional() }).strict().refine(value => Boolean(value.material_id) !== Boolean(value.url), "Choose exactly one material or URL."),
  z.object({ op: z.literal("set_deadline"), iso: z.string().datetime({ offset: true }) }).strict(),
  z.object({ op: z.literal("set_availability"), availability: PlanGenerationRequestSchema.shape.availability }).strict(),
  z.object({ op: z.literal("reorder"), topic_id: topicId, after_topic_id: topicId }).strict(),
]);
export const MapDeltaSchema = z.object({ operations: z.array(MapDeltaOperationSchema).min(1).max(40) }).strict();
export type MapDelta = z.infer<typeof MapDeltaSchema>;
export type MapDeltaOperation = z.infer<typeof MapDeltaOperationSchema>;

export class MapDeltaError extends Error {
  constructor(readonly code: "unknown_topic" | "removed_topic" | "duplicate_topic" | "prerequisite_order" | "invalid_deadline" | "conflicting_operations", message: string) {
    super(message);
    this.name = "MapDeltaError";
  }
}

export type AppliedMapDelta = {
  request: PlanGenerationRequest;
  changedTopicIds: string[];
  addedTopicIds: string[];
  removedTopicIds: string[];
  scheduleChanged: boolean;
  lines: Array<{ id: string; operationIndex: number; topicId: string | null; description: string }>;
};

/** Only explicit map/calendar declarations cross this boundary. No operation
 * can supply a session, status, mastery score, or measured learning evidence. */
export function applyMapDelta({ request, delta: rawDelta, now, excluded = [] }: {
  request: PlanGenerationRequest;
  delta: MapDelta;
  now: Date;
  excluded?: readonly number[];
}): AppliedMapDelta {
  const delta = MapDeltaSchema.parse(rawDelta);
  const map = PlanKnowledgeMapSchema.parse(request.knowledgeMap);
  const currentIds = new Set(map.topics.map(topic => topic.id));
  // References belong to the map before the proposal, never client-proposed IDs.
  for (const operation of delta.operations) {
    for (const id of ["topic_id" in operation ? operation.topic_id : undefined, "after_topic_id" in operation ? operation.after_topic_id : undefined]) {
      if (id && !currentIds.has(id)) throw new MapDeltaError("unknown_topic", "That topic is not in this plan. Reload the map before changing it.");
    }
  }
  const topics = structuredClone(map.topics);
  const changed = new Set<string>();
  const added: string[] = [];
  const removed: string[] = [];
  const lines: AppliedMapDelta["lines"] = [];
  let deadline = request.deadline;
  let availability = request.availability;
  let scheduleChanged = false;
  const activeOperations = delta.operations.map((operation, index) => ({ operation, index })).filter(({ index }) => !excluded.includes(index));
  const removals = new Set(activeOperations.flatMap(({ operation }) => operation.op === "remove_topic" ? [operation.topic_id] : []));

  for (const { operation, index } of activeOperations) {
    const line = (description: string, id: string | null = "topic_id" in operation ? operation.topic_id : null) => lines.push({ id: `operation-${index}`, operationIndex: index, topicId: id, description });
    const topic = "topic_id" in operation ? topics.find(candidate => candidate.id === operation.topic_id)! : null;
    if (topic?.removed && operation.op !== "remove_topic") throw new MapDeltaError("removed_topic", "You removed this topic from future work. Undo that revision to restore it.");
    if (topic && removals.has(topic.id) && operation.op !== "remove_topic") throw new MapDeltaError("conflicting_operations", "Exclude either the removal or the other change to this topic.");
    switch (operation.op) {
      case "add_topic": {
        const titleKey = operation.title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
        if (topics.some(candidate => candidate.title.trim().toLocaleLowerCase().replace(/\s+/g, " ") === titleKey)) throw new MapDeltaError("duplicate_topic", "This topic is already in the map, including its saved history. Choose the existing topic.");
        const id = makeUuid();
        const next = { id, title: operation.title, description: operation.description, subtopics: [], prerequisiteTopicIds: [], status: "not_started" as const, initialEvidence: null, sourceReferences: [], origin: "ai_generated" as const, deferred: null, attachedSources: operation.source_refs ?? [] };
        const after = operation.after_topic_id ? topics.findIndex(candidate => candidate.id === operation.after_topic_id) + 1 : topics.length;
        topics.splice(after, 0, next);
        changed.add(id); added.push(id);
        line(`Add ${next.title}`, id);
        break;
      }
      case "remove_topic": {
        if (topic!.removed) break;
        const dependent = topics.find(candidate => !candidate.removed && !removals.has(candidate.id) && candidate.prerequisiteTopicIds.includes(topic!.id));
        if (dependent && topic!.status === "not_started" && topic!.initialEvidence?.outcome !== "demonstrated") throw new MapDeltaError("prerequisite_order", `${dependent.title} still needs ${topic!.title}. Exclude the removal or shorten the dependent scope too.`);
        topic!.removed = true;
        topic!.deferred = { reason: "You removed this topic from future sessions. Its previous work and evidence stay saved." };
        changed.add(topic!.id); removed.push(topic!.id);
        line(`Remove future work on ${topic!.title}`);
        break;
      }
      case "mark_covered": {
        if (topic!.initialEvidence?.source === "learner_report") break;
        if (topic!.initialEvidence?.source === "placement_check") topic!.placementEvidence = topic!.initialEvidence;
        topic!.initialEvidence = { source: "learner_report", outcome: "covered_elsewhere", checked: false };
        // The status and placement ledger remain measured facts. This is a
        // declaration about starting mode, never a scored check or mastery.
        changed.add(topic!.id);
        line(`Practice ${topic!.title}: you learned it elsewhere`);
        break;
      }
      case "attach_source": {
        const attachment = operation.material_id ? { material_id: operation.material_id } : { url: operation.url! };
        const previous = topic!.attachedSources ?? [];
        if (previous.some(candidate => JSON.stringify(candidate) === JSON.stringify(attachment))) break;
        topic!.attachedSources = [...previous, attachment];
        changed.add(topic!.id);
        line(`Attach a source to ${topic!.title}`);
        break;
      }
      case "set_deadline": {
        if (Date.parse(operation.iso) <= now.getTime()) throw new MapDeltaError("invalid_deadline", "Choose a deadline after the current time.");
        if (Date.parse(deadline ?? "") !== Date.parse(operation.iso)) {
          deadline = operation.iso; scheduleChanged = true; line("Change the deadline");
        }
        break;
      }
      case "set_availability": {
        if (JSON.stringify(availability) !== JSON.stringify(operation.availability)) {
          availability = operation.availability; scheduleChanged = true; line("Change available study time");
        }
        break;
      }
      case "reorder": {
        if (operation.topic_id === operation.after_topic_id) throw new MapDeltaError("prerequisite_order", "Choose a different preceding topic.");
        topics.splice(topics.findIndex(candidate => candidate.id === topic!.id), 1);
        const after = topics.findIndex(candidate => candidate.id === operation.after_topic_id);
        topics.splice(after + 1, 0, topic!);
        changed.add(topic!.id);
        line(`Move ${topic!.title} after ${topics[after]!.title}`);
        break;
      }
    }
  }
  const positions = new Map(topics.map((topic, index) => [topic.id, index]));
  for (const topic of topics.filter(candidate => !candidate.removed)) {
    if (topic.prerequisiteTopicIds.some(id => (positions.get(id) ?? -1) >= positions.get(topic.id)!)) throw new MapDeltaError("prerequisite_order", "This order places a topic before its prerequisite. Choose a later position.");
  }
  const knowledgeMap: PlanKnowledgeMap = { ...map, topics };
  return { request: { ...request, knowledgeMap, deadline, availability }, changedTopicIds: [...changed], addedTopicIds: added, removedTopicIds: removed, scheduleChanged, lines };
}

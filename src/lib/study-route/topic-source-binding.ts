import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { StudyRouteSourceRequirementsSchema, type StudyRoute } from "@/lib/study-route/schema";

export const TOPIC_SOURCE_BINDING_VERSION = "topic_source_binding_v1";

/** Attachments are append-only map declarations. The opaque reference names
 * the exact topic entry; opening it still resolves the authorized saved map. */
export function topicLinkSourceId(topicId: string, attachmentIndex: number) {
  return `topic-source:${topicId}:${attachmentIndex}`;
}

export function sourceIdsForTopics(topics: readonly KnowledgeMapTopic[]) {
  return [...new Set(topics.flatMap(topic => [
    ...topic.sourceReferences.filter(reference => reference.sectionRole === "content_source").map(reference => reference.materialId),
    ...(topic.attachedSources ?? []).map((source, index) => "material_id" in source
      ? source.material_id : topicLinkSourceId(topic.id, index)),
  ]))];
}

export function usesTopicSourceBinding(route: StudyRoute) {
  return route.provenance?.ruleTrace?.some(entry => entry.ruleId === TOPIC_SOURCE_BINDING_VERSION) ?? false;
}

export function topicScopedSourceRequirements(plan: LearningPlan, session: LearningPlanSession) {
  const topics = (session.topicIds ?? []).map(id => {
    const topic = plan.knowledgeMap?.topics.find(item => item.id === id);
    if (!topic) throw new Error("A session source must belong to an existing topic in this plan.");
    return topic;
  });
  const requiredSourceIds = sourceIdsForTopics(topics);
  const materialIds = requiredSourceIds.filter(id => !id.startsWith("topic-source:"));
  if (materialIds.some(id => !plan.materials?.some(material => material.id === id))) {
    throw new Error("A topic's required material is not attached to this plan.");
  }
  // A learner-attached URL is a user-provided source too. The separate
  // trusted_external_source contract means an outside-YOVA learning route;
  // attaching a link must not change the session's execution environment.
  const sourceType = requiredSourceIds.length ? "user_materials" : "yova_generated";
  return StudyRouteSourceRequirementsSchema.parse({
    sourceType, requiredSourceIds, groundingRequired: requiredSourceIds.length > 0,
    instructions: requiredSourceIds.length
      ? ["Use the sources attached to this session's topics; other topics' materials are not requirements."] : [],
  });
}

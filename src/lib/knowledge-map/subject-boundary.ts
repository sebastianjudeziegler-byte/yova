import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { resolveLearningTopic } from "@/lib/intake/interpret";

/**
 * A knowledge-map topic must name something that can be taught, practiced, or
 * produced. Deadline and progress fields are useful planning metadata, but a
 * provider must not promote them into the map's subject spine. Resolve those
 * fragments before either the plan prompt or durable plan sees them.
 */
export function resolveKnowledgeMapSubjectBoundary(
  map: PlanKnowledgeMap,
  goal: string,
): PlanKnowledgeMap {
  let changed = false;
  const topics = map.topics.map((topic) => {
    const title = resolveLearningTopic(topic.title, goal).slice(0, 140);
    if (title === topic.title) return topic;
    changed = true;
    const description = replaceTopicReference(topic.description, topic.title, title);
    return {
      ...topic,
      title,
      description: description === topic.description
        ? `The knowledge and performance needed for ${title}.`.slice(0, 400)
        : description.slice(0, 400),
      subtopics: topic.subtopics.map((subtopic) => (
        replaceTopicReference(subtopic, topic.title, title).slice(0, 500)
      )),
    };
  });

  return changed ? { ...map, topics } : map;
}

export function replaceTopicReference(
  value: string,
  originalTopic: string,
  resolvedTopic: string,
) {
  if (!originalTopic || originalTopic === resolvedTopic) return value;
  return value.replace(new RegExp(escapeRegExp(originalTopic), "gi"), resolvedTopic);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

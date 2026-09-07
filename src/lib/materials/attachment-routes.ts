import { makeUuid } from "@/lib/domain";
import { commitStudyRouteRevision, createSuccessorStudyRoute } from "@/lib/study-route/revisions";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

/** Changes source authority only; completed sessions keep their exact revision. */
export function sourceAttachmentSuccessor(previous: StudyRoute, materialIds: string[], now: string) {
  const requiredSourceIds = [...new Set(materialIds)].sort();
  if (previous.target.sourceRequirements.sourceType === "user_materials"
    && JSON.stringify([...previous.target.sourceRequirements.requiredSourceIds].sort()) === JSON.stringify(requiredSourceIds)) return previous;
  const successor = StudyRouteSchema.parse(createSuccessorStudyRoute({
    previous, routeRevisionId: makeUuid(), createdAt: now,
    changeReason: "You added learning materials. Future sessions can use these sources; completed work stays saved.",
    changes: {
      target: { ...previous.target, sourceRequirements: {
        sourceType: "user_materials", requiredSourceIds, groundingRequired: true,
        instructions: ["Use the attached material for topics mapped to it. Preserve the disclosed source of other topics."],
      } },
    },
  }));
  return StudyRouteSchema.parse(commitStudyRouteRevision(successor, now));
}

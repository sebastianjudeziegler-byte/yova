import type { LessonBrief } from "@/lib/session-generation/schema";
import { lessonIdeaCapacityForMinutes } from "@/lib/session-generation/lesson-brief";

type LessonContractActivity = {
  type: string;
  topicId?: string | null;
  methodPhase?: string;
  requiredForCompletion?: boolean;
  estimatedMinutes?: number;
  concept: string | null;
  correctAnswer: string | null;
  lessonBrief?: LessonBrief | null;
};
type LessonContractCoverage = {
  evidenceMap: Array<{ essentialIdea: string; activityConcept: string }>;
};

/**
 * The core recall check and its preceding lesson must teach the same facts.
 * Join by the saved evidence map AND topic, never a broad title or proximity.
 * Application/transfer solutions, pretests and optional repairs are excluded:
 * those answers are work for the learner, not statements of the core model.
 */
export function coreRecallKnowledgeForLesson(
  activities: readonly LessonContractActivity[],
  coverage: LessonContractCoverage | null | undefined,
  lessonIndex: number,
): string[] {
  const lesson = activities[lessonIndex];
  const brief = lesson?.lessonBrief;
  if (lesson?.type !== "instruction" || !brief || !coverage) return [];
  const knowledge = brief.essentialIdeas
    .slice(0, lessonIdeaCapacityForMinutes(lesson.estimatedMinutes ?? 1))
    .flatMap((idea) => {
      const mapping = coverage.evidenceMap.find((entry) => key(entry.essentialIdea) === key(idea));
      if (!mapping) return [];
      const check = activities.slice(lessonIndex + 1).find((activity) => (
        activity.type === "free_response"
        && activity.requiredForCompletion
        && (activity.methodPhase === "explain" || activity.methodPhase === "retrieve")
        && activity.topicId != null
        && brief.topicIds.includes(activity.topicId)
        && key(activity.concept ?? "") === key(mapping.activityConcept)
        && activity.correctAnswer?.trim()
      ));
      return check?.correctAnswer ? [check.correctAnswer.trim()] : [];
    });
  return [...new Set(knowledge)];
}

/** Kept in the reading itself, including reopened pre-fix lessons. */
export function includeCoreRecallKnowledge(content: string, knowledge: readonly string[] = []): string {
  if (!content.trim()) return content;
  const missing = knowledge.filter((statement) => !key(content).includes(key(statement)));
  if (missing.length === 0) return content;
  const model = `## The key relationship\n\n${missing.join("\n\n")}`;
  const heading = content.match(/^\s*# [^\n]+(?:\n|$)/);
  return heading
    ? `${heading[0].trim()}\n\n${model}\n\n${content.slice(heading[0].length).trim()}`.trim()
    : `${model}\n\n${content.trim()}`;
}

function key(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

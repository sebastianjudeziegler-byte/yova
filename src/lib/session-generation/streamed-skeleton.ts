import type { StreamedGeneratedSessionActivity } from "@/lib/session-generation/schema";

/**
 * Repairs the small set of phase/type mismatches that structured output cannot
 * express but the learning-method validator rejects. The learner-facing
 * action stays intact: reflection-shaped instructions become reflections,
 * while actual questions remain questions and become transfer checks.
 */
export function normalizeStreamedActivityPhaseTypes(
  activities: StreamedGeneratedSessionActivity[],
): StreamedGeneratedSessionActivity[] {
  return activities.map((activity) => {
    if (activity.methodPhase === "reflect" && activity.type === "instruction") {
      return {
        ...activity,
        type: "reflection" as const,
        topicId: null,
        methodPhase: "reflect" as const,
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
      };
    }
    if (activity.methodPhase === "reflect"
      && (activity.type === "multiple_choice" || activity.type === "free_response")) {
      return { ...activity, methodPhase: "transfer" as const };
    }
    if (activity.type === "reflection"
      && activity.methodPhase !== "reflect"
      && activity.methodPhase !== "schedule_return") {
      return { ...activity, methodPhase: "reflect" as const };
    }
    return activity;
  });
}

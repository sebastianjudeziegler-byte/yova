import {
  classifyLearningTask,
  type MethodRoutingInput,
} from "@/lib/learning/method-router";

/**
 * Builds the routing input for a guided session from one place.
 *
 * Three generators route sessions, and each assembled this field list inline.
 * When the learner's stated task type was made authoritative, only one of the
 * three received it, so a goal that said "Memorize" still arrived as conceptual
 * learning through the other two and was taught by self-explanation. Sharing
 * the construction is what stops that drift; the override travels with it.
 */

/** The parts of a generation context that routing actually reads. */
export type SessionRoutingContext = {
  learningGoal: {
    learningIntent: MethodRoutingInput["learningIntent"];
    title: string;
    topic: string;
    kind: string;
  };
  session: {
    learningMode: MethodRoutingInput["sessionLearningMode"];
    title: string;
    objective: string;
    method: string;
    methodReason: string;
  };
  learnerProfile: MethodRoutingInput["learnerProfile"];
  recentResults: MethodRoutingInput["recentResults"];
  recentInterruptions: readonly unknown[];
};

/**
 * The learner's own goal decides the task type whenever it is unambiguous.
 *
 * Classification weights the generated session title and objective above the
 * learner's words, so a model that writes "Learn the organelles" over a goal
 * that says "Memorize the organelles" silently converts the task and takes the
 * method with it. An ambiguous goal still gets read from the session, which is
 * the only signal available in that case.
 */
export function learnerStatedTaskType(goalTopic: string) {
  const stated = classifyLearningTask(goalTopic);
  return stated.confidence === "clear" ? stated.taskType : null;
}

export function sessionRoutingInput(
  context: SessionRoutingContext,
  overrides: Partial<MethodRoutingInput> = {},
): MethodRoutingInput {
  return {
    taskTypeOverride: learnerStatedTaskType(context.learningGoal.topic),
    learningIntent: context.learningGoal.learningIntent,
    sessionLearningMode: context.session.learningMode,
    goalTitle: context.learningGoal.title,
    goalTopic: context.learningGoal.topic,
    goalKind: context.learningGoal.kind,
    sessionTitle: context.session.title,
    sessionObjective: context.session.objective,
    plannedMethod: context.session.method,
    plannedMethodReason: context.session.methodReason,
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    interruptionCount: context.recentInterruptions.length,
    ...overrides,
  };
}

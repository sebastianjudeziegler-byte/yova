import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import {
  buildLearningScienceRoutingBrief,
  methodFitsSessionMode,
  methodIdFromText,
} from "@/lib/learning/method-router";
import { isActiveCompletionEvidence } from "@/lib/plan-generation/quality-gate";
import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

/**
 * The model proposes a lesson sequence, but it is not allowed to override
 * YOVA's task-to-method rules or treat passive exposure as completion.
 */
export function normalizeGeneratedPlanLearningContract(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): GeneratedPlanDraft {
  return {
    ...draft,
    sessions: draft.sessions.map((session) => {
      const routing = buildLearningScienceRoutingBrief({
        learningIntent: request.learningIntent,
        sessionLearningMode: session.learningMode,
        goalTitle: draft.title,
        goalTopic: draft.topic,
        goalKind: draft.kind,
        sessionTitle: session.title,
        sessionObjective: session.objective,
        plannedMethod: session.method,
        plannedMethodReason: session.methodReason,
        learnerProfile: null,
        recentResults: [],
        interruptionCount: 0,
      });
      const proposedMethodId = methodIdFromText(session.method);
      const proposedMethodFits = proposedMethodId
        ? getCoreLearningMethod(proposedMethodId).taskTypes.includes(routing.taskType)
          && methodFitsSessionMode(proposedMethodId, routing.taskType, session.learningMode)
        : false;
      const method = getCoreLearningMethod(
        proposedMethodFits && proposedMethodId
          ? proposedMethodId
          : routing.suggestedPrimaryMethodId,
      );
      const hasPassiveEvidence = session.completionEvidence.some((item) => !isActiveCompletionEvidence(item));

      return {
        ...session,
        method: method.name,
        methodReason: proposedMethodFits
          ? session.methodReason
          : `${method.why} YOVA selected it because this session is ${routing.taskType.replaceAll("_", " ")} work.`,
        completionEvidence: hasPassiveEvidence
          ? [completionEvidenceFor(routing.taskType, session.learningMode)]
          : session.completionEvidence,
      };
    }),
  };
}

function completionEvidenceFor(
  taskType: ReturnType<typeof buildLearningScienceRoutingBrief>["taskType"],
  learningMode: "learn" | "study",
) {
  if (taskType === "problem_solving") {
    return learningMode === "learn"
      ? "Solve one representative problem with reduced support and explain why each major step is used"
      : "Solve one representative problem without support and correct any exposed error";
  }
  if (taskType === "programming") {
    return learningMode === "learn"
      ? "Implement one comparable solution with reduced support and explain the key construct"
      : "Implement or debug one comparable solution without copying the model";
  }
  if (taskType === "writing_argumentation") {
    return "Draft one bounded section and match each claim to supporting evidence";
  }
  if (taskType === "memorization") {
    return "Recall each session target without notes and correct every exposed gap";
  }
  return learningMode === "learn"
    ? "Explain each session target in your own words after the model is hidden"
    : "Retrieve each session target without notes and apply one relationship in a new example";
}

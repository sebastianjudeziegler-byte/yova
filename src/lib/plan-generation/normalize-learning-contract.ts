import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import {
  buildLearningScienceRoutingBrief,
  classifyLearningTask,
} from "@/lib/learning/method-router";
import { isActiveCompletionEvidence } from "@/lib/plan-generation/quality-gate";
import type {
  GeneratedPlanDraft,
  PlanGenerationRequest,
  ProviderGeneratedPlanDraft,
} from "@/lib/plan-generation/schema";

/**
 * The model proposes a lesson sequence, but it is not allowed to override
 * YOVA's task-to-method rules or treat passive exposure as completion.
 */
export function normalizeGeneratedPlanLearningContract(
  draft: ProviderGeneratedPlanDraft,
  request: PlanGenerationRequest,
): GeneratedPlanDraft {
  const normalizedDraft = normalizeTentativePreferenceLanguage(draft);
  const originalTask = classifyLearningTask(request.goal);
  const taskTypeOverride = originalTask.confidence === "clear"
    ? originalTask.taskType
    : null;

  return {
    ...normalizedDraft,
    sessions: normalizedDraft.sessions.map((session) => {
      const routing = buildLearningScienceRoutingBrief({
        learningIntent: request.learningIntent,
        sessionLearningMode: session.learningMode,
        // The learner's original goal is authoritative. Generated titles are
        // presentation text and must not silently change an essay into a
        // generic conceptual task or a course into a single skill.
        goalTitle: `${request.goal}. ${normalizedDraft.title}`,
        goalTopic: `${request.startingContext ?? ""}. ${normalizedDraft.topic}`,
        goalKind: normalizedDraft.kind,
        sessionTitle: session.title,
        sessionObjective: session.objective,
        plannedMethod: "",
        plannedMethodReason: "",
        learnerProfile: null,
        recentResults: [],
        interruptionCount: 0,
        taskTypeOverride,
      });
      const method = getCoreLearningMethod(routing.suggestedPrimaryMethodId);
      const hasPassiveEvidence = session.completionEvidence.some((item) => !isActiveCompletionEvidence(item));

      return {
        ...session,
        method: method.name,
        methodReason: `${method.why} YOVA selected it because this session is ${routing.taskType.replaceAll("_", " ")} work.`,
        completionEvidence: hasPassiveEvidence
          ? [completionEvidenceFor(routing.taskType, session.learningMode)]
          : session.completionEvidence,
      };
    }),
  };
}

/**
 * Preferences can change delivery, but a generated sentence must not turn one
 * answer into a fixed claim about how somebody learns. These narrow rewrites
 * preserve the useful preference while medical or categorical claims still
 * fail the quality gate.
 */
function normalizeTentativePreferenceLanguage(
  draft: ProviderGeneratedPlanDraft,
): ProviderGeneratedPlanDraft {
  const rewrite = (value: string) => value
    .replace(/\byou learn best by\b/gi, "you currently prefer")
    .replace(/\byou learn best with\b/gi, "you currently prefer")
    .replace(/\bthe learner learns best by\b/gi, "the learner currently prefers")
    .replace(/\bthe learner learns best with\b/gi, "the learner currently prefers")
    .replace(/\blearns best\b/gi, "currently prefers learning")
    .replace(/\blearn best\b/gi, "currently prefer learning")
    // A provider can occasionally turn a tentative presentation preference
    // into a fixed "learning style" label even though the prompt forbids it.
    // These phrases carry no useful instructional information beyond the
    // preference, so normalize them deterministically before the strict gate.
    // Diagnosis claims remain untouched and therefore still fail closed.
    .replace(/\b(?:the learner's|your) learning style\b/gi, "the current study preference")
    .replace(/\blearning style\b/gi, "current study preference")
    .replace(/\bvisual learner\b/gi, "learner who currently prefers visual examples")
    .replace(/\bauditory learner\b/gi, "learner who currently prefers spoken explanations")
    .replace(/\bkinesthetic learner\b/gi, "learner who currently prefers hands-on examples")
    .replace(/\bbrain type\b/gi, "current study preference");

  return {
    ...draft,
    rationale: rewrite(draft.rationale),
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

/**
 * Accounts for every knowledge-map topic before the quality gate sees the plan.
 *
 * The gate requires each mapped topic to be either scheduled or explicitly
 * deferred, and rejects the whole plan when one is neither. That rejection is
 * expensive: generation retries, and on a second failure the learner waits the
 * better part of a minute only to receive a basic fallback draft instead of the
 * plan the model actually produced.
 *
 * Both failures it catches here are bookkeeping rather than bad teaching. A
 * topic the model simply forgot to mention becomes an explicit deferral, which
 * the plan screen already knows how to show and offer to add back. A topic
 * listed as both scheduled and deferred keeps its session, because scheduling
 * it is the stronger statement.
 *
 * Genuine structural errors are left to fail: a session covering no topic at
 * all, or a reference to a topic id that is not in the map, both mean the model
 * misunderstood the plan rather than mislaid an entry.
 */
export function accountForEveryKnowledgeMapTopic(
  draft: GeneratedPlanDraft,
  request: PlanGenerationRequest,
): GeneratedPlanDraft {
  const knowledgeMap = request.knowledgeMap;
  if (!knowledgeMap) return draft;

  const scheduledTopicIds = new Set(draft.sessions.flatMap((session) => session.topicIds ?? []));
  const deferred = (draft.deferredTopics ?? []).filter((topic) => !scheduledTopicIds.has(topic.topicId));
  const accountedTopicIds = new Set([...scheduledTopicIds, ...deferred.map((topic) => topic.topicId)]);
  const unaccounted = knowledgeMap.topics.filter((topic) => !accountedTopicIds.has(topic.id));

  if (unaccounted.length === 0 && deferred.length === (draft.deferredTopics ?? []).length) {
    return draft;
  }

  return {
    ...draft,
    deferredTopics: [
      ...deferred,
      ...unaccounted.map((topic) => ({
        topicId: topic.id,
        reason: "This topic falls outside the sessions that fit the current time budget. Extend the plan to include it.",
      })),
    ],
  };
}

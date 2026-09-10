import "server-only";
import { getCoreLearningMethod } from "@/lib/learning/method-catalog";
import { classifyLearningTask, methodIdFromText } from "@/lib/learning/method-router";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import { SessionGenerationFailure, type SessionGenerationContext, type SessionGenerationRuntime, type SessionGenerationStats } from "@/lib/openai/session-generator";
import type { GeneratedSessionActivity, GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { classifyProviderError } from "@/lib/openai/provider-error";
import { generateWorkBlock } from "./generate";
import { createBlockProvider } from "./provider";
import type { WorkBlock } from "./schema";

export async function generateProductionWorkBlock(context: SessionGenerationContext, runtime: SessionGenerationRuntime) {
  const startedAt = Date.now();
  const provider = runtime.blockProvider ?? createBlockProvider();
  const stats = (passed: boolean): SessionGenerationStats => ({
    elapsedMs: Date.now() - startedAt, attempts: 1, firstAttemptPassed: passed,
    failedValidator: passed ? null : "session_semantic_validation", repairAttempted: false, repairSucceeded: null,
    repairReason: "none", repairDetail: null, inputTokens: provider.usage?.().inputTokens ?? 0,
    outputTokens: provider.usage?.().outputTokens ?? 0, cachedInputTokens: provider.usage?.().cachedInputTokens ?? 0,
    cacheWriteTokens: 0, strategy: "block", stage: passed ? "complete" : "validation",
  });
  try {
    const generated = await generateWorkBlock(context, runtime, provider);
    const { block, answerKeys } = generated;
    const methodId = context.studyRoute?.approach.primaryMethodId ?? methodIdFromText(context.session.method) ?? "retrieval_practice";
    const method = getCoreLearningMethod(methodId);
    const taskType = context.studyRoute?.target.taskFamily ?? classifyLearningTask(context.knowledgeTopics.map(topic => `${topic.title} ${topic.description}`).join(" ")).taskType;
    const activities = block.activities.flatMap((activity): GeneratedSessionActivity[] => {
      const topic = context.knowledgeTopics.find(item => item.id === activity.topicId)!;
      if (activity.questionIds.length) return activity.questionIds.map(id => {
        const question = block.questions.find(item => item.id === id)!;
        const answer = answerKeys.find(item => item.questionId === id)!;
        return {
          type: question.format === "multiple_choice" ? "multiple_choice" : "free_response", topicId: topic.id, concept: topic.title,
          methodPhase: "retrieve", estimatedMinutes: Math.max(1, Math.floor(activity.estimatedMinutes / activity.questionIds.length)), requiredForCompletion: true,
          label: "Practice", title: activity.title, body: question.prompt, choices: question.choices,
          correctAnswer: answer.answer, feedback: answer.explanation, teaching: null,
        };
      });
      const isExplanation = activity.kind === "ai_explanation";
      return [{
        type: "instruction", topicId: null, concept: null, methodPhase: isExplanation ? "model" : "read_source",
        estimatedMinutes: activity.estimatedMinutes, requiredForCompletion: true, label: isExplanation ? "Explanation" : "Source",
        title: activity.title, body: activity.instructions, choices: [], correctAnswer: null, feedback: null,
        teaching: isExplanation ? { keyIdea: topic.description, explanation: activity.content, example: null, commonMistake: null } : null,
      }];
    });
    const ideas = answerKeys.slice(0, 4).map(key => key.requiredIdeas.join("; ").slice(0, 180));
    const draft: GeneratedSessionDraft & { block: WorkBlock } = {
      topicIds: block.topicIds, rationale: block.personalization.profileReason,
      coverage: {
        focus: block.objective.slice(0, 240), essentialIdeas: ideas,
        completionEvidence: (context.session.completionEvidence?.length ? context.session.completionEvidence : [block.objective]).slice(0, 3),
        evidenceMap: ideas.map((idea, index) => ({ essentialIdea: idea, activityConcept: context.knowledgeTopics.find(topic => topic.id === block.questions[index]!.topicId)!.title })),
        deferredContent: context.session.deferredContentTargets ?? [],
      },
      methodBriefing: {
        learningMode: context.session.learningMode, taskType, methodId, name: context.studyRoute?.approach.visibleMethodName ?? method.name,
        what: "Study the assigned content and use the selected method in a small practice check.", why: context.session.methodReason,
        how: ["Use the source or explanation assigned to this block.", "Attempt the practice, review feedback, then continue."],
        completion: block.stoppingPoint, personalization: [block.personalization.profileReason],
      },
      sourceGrounding: block.sources.length ? {
        mode: "materials_only", summary: "Practice is checked against the source sections assigned to this block.",
        sourceNames: [...new Set(block.sources.map(source => source.title))].slice(0, 5),
        anchors: block.sources.slice(0, 4).map(source => ({ chunkId: source.id.split(":").at(-1)!, sourceName: source.title, locationLabel: source.section.slice(0, 120), excerpt: source.text.slice(0, 240), usedFor: `Practice for ${context.knowledgeTopics.find(topic => topic.id === source.topicId)!.title}` })),
        supplements: [],
      } : null,
      activities, block,
    };
    return {
      draft, model: generated.model, responseId: provider.usage?.().responseId ?? block.id,
      blockAnswerKeys: answerKeys,
      routingContext: { taskType, knowledgeStage: context.session.learningMode === "learn" ? "novice" as const : "retrieval_ready" as const },
      supportPlan: {
        level: block.personalization.hintsAvailable ? "supported_start" as const : "independent_start" as const,
        title: block.personalization.hintsAvailable ? "Hints available" : "Try before checking",
        explanation: block.personalization.profileReason, evidenceLabel: "The practice check supplies learning evidence", concept: null,
      },
      deliveryPolicy: buildSessionDeliveryPolicy({ learnerProfile: context.learnerProfile, recentResults: context.recentResults, recentInterruptions: context.recentInterruptions, learningMode: context.session.learningMode, estimatedMinutes: context.session.estimatedMinutes }),
      deliveryInstructions: undefined, generationStats: stats(true),
    };
  } catch (cause) {
    const providerFailure = classifyProviderError(cause).category !== "unknown";
    throw new SessionGenerationFailure("YOVA could not prepare dependable practice for this block. Use the existing recovery options.", {
      ...stats(false), failedValidator: providerFailure ? "session_provider_request" : "session_semantic_validation",
      stage: providerFailure ? "provider" : "validation", cause: providerFailure ? "provider_request" : "semantic_validation",
    }, undefined, cause);
  }
}

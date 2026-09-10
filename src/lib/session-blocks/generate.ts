import "server-only";
import { randomUUID } from "node:crypto";
import type { SessionGenerationContext, SessionGenerationRuntime } from "@/lib/openai/session-generator";
import { lessonIdeaContainsDeferredRelationAnchor } from "@/lib/openai/streamed-teaching-generator";
import { planBlockContents } from "./plan";
import { BlockFillSchema, BlockReviewSchema, type BlockCallOptions, type BlockProvider } from "./provider-contract";
import { createBlockProvider } from "./provider";
import { BlockAnswerKeySchema, BlockQuestionSchema, WorkBlockSchema, type WorkBlock } from "./schema";

/** One preparation call, then one semantic review. The caller saves both the
 * immutable public block and its private answer key before delivering it. */
export async function generateWorkBlock(context: SessionGenerationContext, runtime: SessionGenerationRuntime, provider: BlockProvider = createBlockProvider()) {
  const plan = planBlockContents(context);
  const deadline = Math.min(runtime.deadlineAt ?? Date.now() + 85_000, Date.now() + 85_000) - (runtime.settlementReserveMs ?? 5_000);
  const callOptions = (maximum: number): BlockCallOptions => {
    const timeoutMs = Math.min(maximum, deadline - Date.now());
    if (timeoutMs < 1_000) throw new Error("Practice preparation is unavailable within this request's time limit.");
    return { timeoutMs, signal: runtime.signal };
  };
  const fill = BlockFillSchema.parse(await provider.generate({
    ...plan, context: {
      session: context.session, learningGoal: context.learningGoal,
      knowledgeTopics: context.knowledgeTopics.filter(topic => plan.topicIds.includes(topic.id)), learnerProfile: context.learnerProfile,
    },
  }, callOptions(50_000)));
  if (JSON.stringify(fill.questions.map(question => [question.id, question.topicId])) !== JSON.stringify(plan.slots.map(slot => [slot.id, slot.topicId]))
    || JSON.stringify(fill.explanations.map(item => item.topicId)) !== JSON.stringify(plan.explanationTopicIds)) {
    throw new Error("Practice preparation changed its fixed topic or question assignments.");
  }
  const answerKeys = fill.questions.map((question, index) => BlockAnswerKeySchema.parse({
    questionId: question.id, answer: question.answer, requiredIdeas: question.requiredIdeas,
    explanation: question.explanation, workedSolution: question.workedSolution, sourceIds: plan.slots[index]!.sourceIds,
  }));
  const questions = fill.questions.map((question, index) => {
    const slot = plan.slots[index]!;
    if (slot.format === "multiple_choice" && !question.choices.includes(question.answer)) throw new Error("A practice answer must match exactly one displayed choice.");
    if (slot.format === "problem" && question.workedSolution.length === 0) throw new Error("A problem needs a worked solution.");
    if (plan.personalization.examplesFirst && index === 0 && !question.workedExample) throw new Error("This learner's first practice question needs a worked example.");
    if (plan.personalization.hintsAvailable && question.hints.length === 0) throw new Error("This learner's practice needs the requested hint ladder.");
    return BlockQuestionSchema.parse({
      id: slot.id, topicId: slot.topicId, format: slot.format, prompt: question.prompt, choices: question.choices,
      hints: plan.personalization.hintsAvailable ? question.hints : [],
      workedExample: plan.personalization.examplesFirst && index === 0 ? question.workedExample : null,
      reflectBeforeCheck: plan.personalization.reflective,
    });
  });
  const activities: WorkBlock["activities"] = [];
  for (const topicId of plan.topicIds) {
    const topic = context.knowledgeTopics.find(item => item.id === topicId)!;
    const sources = plan.sources.filter(source => source.topicId === topicId);
    if (context.session.learningMode === "learn") {
      for (const source of sources) activities.push({
        id: `source-${activities.length + 1}`, kind: source.kind, topicId,
        title: `${source.kind === "watch_source_section" ? "Watch" : "Read"} ${source.section}`,
        instructions: `Study ${source.section} in ${source.title}, then check what you can use.`,
        sourceId: source.id, questionIds: [], estimatedMinutes: 1, content: "",
      });
      if (sources.length === 0) activities.push({
        id: `explanation-${activities.length + 1}`, kind: "ai_explanation", topicId, title: `Learn ${topic.title}`,
        instructions: "Read the explanation, then use it in the practice check.", sourceId: null, questionIds: [], estimatedMinutes: 1,
        content: fill.explanations.find(item => item.topicId === topicId)!.text,
      });
    }
    const topicSlots = plan.slots.filter(slot => slot.topicId === topicId);
    activities.push({
      id: `check-${activities.length + 1}`, kind: topicSlots[0]!.activityKind, topicId, title: `Practise ${topic.title}`,
      instructions: plan.personalization.reflective ? "Explain in your own words before checking. Review the feedback and continue when ready." : "Try each question, use the available support, then review the feedback and continue.",
      sourceId: null, questionIds: topicSlots.map(slot => slot.id), estimatedMinutes: 1, content: "",
    });
  }
  if (activities.length > context.session.estimatedMinutes) throw new Error("This source section needs a smaller block before practice can be prepared.");
  activities.forEach((activity, index) => {
    activity.estimatedMinutes = Math.floor(context.session.estimatedMinutes / activities.length)
      + (index < context.session.estimatedMinutes % activities.length ? 1 : 0);
  });
  const block = WorkBlockSchema.parse({
    version: 1, id: randomUUID(), topicIds: plan.topicIds, learningMode: context.session.learningMode,
    objective: context.session.objective, estimatedMinutes: context.session.estimatedMinutes,
    instructions: [plan.pathwayOrientation, context.session.learningMode === "learn"
      ? "Study the assigned section or explanation, then finish its practice check. Ask YOVA for help without restarting your work."
      : "Start with the practice check. The source and Ask YOVA are available for gaps."].filter(Boolean).join(" "),
    stoppingPoint: `${context.session.learningMode === "learn" && plan.sources.length ? "Finish the source section and " : ""}attempt each practice question, review its feedback, and continue without a forced repeat.`,
    sources: plan.sources, activities, questions, personalization: plan.personalization,
    semanticReview: { policyVersion: "block_semantic_v1", status: "passed", reviewedAt: new Date().toISOString() },
  });
  // Retain the existing deterministic deferred-relation protection on every
  // learner surface, including wrong choices, hints and examples. Topic IDs
  // alone cannot authorize deferred substance under an active heading.
  const deferredContent = context.session.deferredContentTargets ?? [];
  for (const topicId of plan.topicIds) {
    const topic = context.knowledgeTopics.find(item => item.id === topicId)!;
    const surface = JSON.stringify({
      activities: block.activities.filter(item => item.topicId === topicId),
      questions: block.questions.filter(item => item.topicId === topicId),
      answers: answerKeys.filter(key => block.questions.some(question => question.id === key.questionId && question.topicId === topicId)),
    });
    if (lessonIdeaContainsDeferredRelationAnchor({ idea: surface, assignedTarget: topic.title, deferredTargets: deferredContent, authoritativeAssignedSubjectReferences: [topic.description, ...topic.subtopics] })) {
      throw new Error("Practice preparation contains deferred-topic content.");
    }
  }
  const reviewCandidate = {
    version: block.version, id: block.id, topicIds: block.topicIds, learningMode: block.learningMode,
    objective: block.objective, estimatedMinutes: block.estimatedMinutes, instructions: block.instructions,
    stoppingPoint: block.stoppingPoint, sources: block.sources, activities: block.activities,
    questions: block.questions, personalization: block.personalization,
  };
  const review = BlockReviewSchema.parse(await provider.review({
    block: reviewCandidate, answerKeys, assignedTopics: context.knowledgeTopics.filter(topic => plan.topicIds.includes(topic.id)), deferredContent,
  }, callOptions(25_000)));
  if (review.verdict !== "pass") throw new Error("YOVA could not prepare dependable practice for this block. Use the existing recovery options.");
  return { block: { ...block, semanticReview: { ...block.semanticReview, reviewedAt: new Date().toISOString() } }, answerKeys, model: provider.model ?? "injected-test-provider" };
}

import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import { classifyLearningTask } from "@/lib/learning/method-router";
import { BlockSourceSchema, type BlockQuestion, type BlockSource, type WorkBlock } from "./schema";

export type BlockQuestionSlot = {
  id: string; topicId: string; format: BlockQuestion["format"];
  activityKind: "flashcards" | "quiz" | "problems";
  intent: "retrieve_term" | "solve_problem" | "support_argument" | "distinguish_explanations" | "predict_consequence";
  sourceIds: string[];
};

export type BlockContentPlan = {
  topicIds: string[]; sources: BlockSource[]; slots: BlockQuestionSlot[];
  explanationTopicIds: string[];
  personalization: WorkBlock["personalization"];
  pathwayOrientation: string | null;
};

/** Chooses contents inside the already assigned session. Never changes a map,
 * route, session method, calendar time, or plan revision. */
export function planBlockContents(context: SessionGenerationContext): BlockContentPlan {
  const topicIds = context.session.topicIds;
  if (!topicIds.length || new Set(topicIds).size !== topicIds.length) throw new Error("A block needs distinct assigned topics.");
  const topics = topicIds.map(id => {
    const topic = context.knowledgeTopics.find(item => item.id === id);
    if (!topic || topic.deferred) throw new Error("Practice must use an active topic assigned to this session.");
    return topic;
  });
  const signals = new Map(context.personalization?.canonicalProfile?.signals.map(item => [item.signalId, item.value]));
  const examplesFirst = signals.get("unfamiliar_entry") === "concrete_example";
  const hintsAvailable = signals.get("first_repair") === "hint_first";
  const shortFocus = ["shorter_blocks", "short_blocks_with_changes"].includes(signals.get("focus_pacing") ?? "");
  const reflective = signals.get("successful_approach") === "explain_from_memory";
  const sources = topics.flatMap(topic => {
    const references = topic.sourceReferences.filter(reference => reference.sectionRole === "content_source");
    const attachments = topic.attachedSources ?? [];
    const materialIds = new Set(attachments.flatMap(source => "material_id" in source ? [source.material_id] : []));
    const excerpts = context.materials.filter(material => material.role !== "scope_outline" && material.materialId && material.chunkId
      && (references.some(reference => reference.materialId === material.materialId && reference.chunkId === material.chunkId)
        || (materialIds.has(material.materialId) && !references.some(reference => reference.materialId === material.materialId))));
    if ((references.length || attachments.length) && !excerpts.length) {
      throw new Error("This topic's source section is not ready for practice. Open its existing recovery options.");
    }
    return excerpts.map(material => BlockSourceSchema.parse({
      id: `${topic.id}:${material.chunkId}`, topicId: topic.id, materialId: material.materialId,
      url: null, kind: "read_source_section", title: material.name,
      section: material.locationLabel ?? "Assigned section", text: material.text,
    }));
  });
  const desiredSetSize = shortFocus ? 2 : 3;
  const total = Math.max(desiredSetSize, topics.length);
  const slots = Array.from({ length: total }, (_, index): BlockQuestionSlot => {
    const topic = topics[index % topics.length]!;
    const task = context.studyRoute?.target.taskFamily ?? classifyLearningTask([topic.title, topic.description, ...topic.subtopics].join(" ")).taskType;
    const activityKind = task === "memorization" ? "flashcards" : task === "problem_solving" || task === "programming" ? "problems" : "quiz";
    const argument = task === "writing_argumentation";
    return {
      id: `practice-${index + 1}`, topicId: topic.id, activityKind,
      format: activityKind === "flashcards" ? "flashcard" : activityKind === "problems" ? "problem" : argument || reflective || index > 0 ? "short_answer" : "multiple_choice",
      intent: activityKind === "flashcards" ? "retrieve_term" : activityKind === "problems" ? "solve_problem" : argument ? "support_argument" : index === 0 ? "distinguish_explanations" : "predict_consequence",
      sourceIds: sources.filter(source => source.topicId === topic.id).map(source => source.id),
    };
  });
  const reasons = [
    ...(examplesFirst ? ["You prefer an example before the first question"] : []),
    ...(hintsAvailable ? ["you prefer hints before explanations"] : []),
    ...(shortFocus ? ["your short focus window keeps this set small"] : []),
    ...(reflective ? ["you prefer to explain in your own words before checking"] : []),
  ];
  return {
    topicIds, sources, slots,
    explanationTopicIds: context.session.learningMode === "learn" ? topics.filter(topic => !sources.some(source => source.topicId === topic.id)).map(topic => topic.id) : [],
    personalization: {
      examplesFirst, hintsAvailable, shortFocus, reflective, setSize: slots.length,
      profileReason: reasons.length ? `${reasons.join("; ")}. This check has ${slots.length} questions.` : `This check uses ${slots.length} questions to practise ${topics.map(topic => topic.title).join(" and ")}.`,
    },
    pathwayOrientation: /calculus/i.test(context.learningGoal.topic + " " + context.learningGoal.title)
      ? `This block begins with ${topics[0]!.title}, the topic already assigned in your plan. The wider calculus pathway continues in later blocks.` : null,
  };
}

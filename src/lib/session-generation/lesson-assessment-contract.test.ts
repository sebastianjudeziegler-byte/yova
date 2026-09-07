import { describe, expect, it } from "vitest";
import { coreRecallKnowledgeForLesson, includeCoreRecallKnowledge } from "./lesson-assessment-contract";

type Activity = Parameters<typeof coreRecallKnowledgeForLesson>[0][number];
const idea = "Glycolysis splits glucose into two pyruvate molecules and yields a net 2 ATP.";
const reference = "Glycolysis produces two pyruvate molecules, two NADH, and a net gain of 2 ATP per glucose.";
const topicId = "11111111-1111-4111-8111-111111111111";
const lesson: Activity = {
  type: "instruction", topicId, concept: null, correctAnswer: null, estimatedMinutes: 3,
  lessonBrief: {
    version: 1, topicIds: [topicId], essentialIdeas: [idea], sourceChunks: [], knowledgeSource: "model_knowledge",
    evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
    contentRequirements: { teachEveryEssentialIdea: true, includeConcreteExample: false, includeCommonMixup: true, preservePrerequisiteOrder: true },
  },
};
const check: Activity = {
  type: "free_response", topicId, concept: "Glycolysis products", correctAnswer: reference,
  requiredForCompletion: true, methodPhase: "explain",
};
const coverage = { evidenceMap: [{ essentialIdea: idea, activityConcept: "Glycolysis products" }] };

describe("the teaching and recall contract", () => {
  it("shows the complete core relationship before a learner answers the recall question", () => {
    const knowledge = coreRecallKnowledgeForLesson([lesson, check], coverage, 0);
    expect(includeCoreRecallKnowledge(`# Glycolysis\n\n${idea}`, knowledge)).toBe(
      `# Glycolysis\n\n## The key relationship\n\n${reference}\n\n${idea}`,
    );
  });

  it.each([
    { topicId: "different-topic" }, { concept: "Different concept" },
    { methodPhase: "transfer" }, { methodPhase: "independent_practice" },
    { methodPhase: "guided_practice" }, { methodPhase: "repair" },
    { requiredForCompletion: false }, { type: "multiple_choice" },
  ])("does not put an unrelated or application answer into the reading: %j", (change) => {
    const knowledge = coreRecallKnowledgeForLesson([lesson, { ...check, ...change }], coverage, 0);
    expect(includeCoreRecallKnowledge(`# Glycolysis\n\n${idea}`, knowledge)).not.toContain("NADH");
  });

  it("does not take an earlier pretest answer or an unmapped claim", () => {
    expect(coreRecallKnowledgeForLesson([check, lesson], coverage, 1)).toEqual([]);
    expect(coreRecallKnowledgeForLesson([lesson, check], { evidenceMap: [] }, 0)).toEqual([]);
  });

  it("keeps an existing complete explanation unchanged on reopen", () => {
    const content = `# Glycolysis\n\n${reference}`;
    expect(includeCoreRecallKnowledge(content, [reference])).toBe(content);
    expect(includeCoreRecallKnowledge(includeCoreRecallKnowledge(`# Glycolysis\n\n${idea}`, [reference]), [reference]))
      .toBe(includeCoreRecallKnowledge(`# Glycolysis\n\n${idea}`, [reference]));
  });

  it("does not manufacture a lesson before its stream starts", () => {
    expect(includeCoreRecallKnowledge("", [reference])).toBe("");
  });
});

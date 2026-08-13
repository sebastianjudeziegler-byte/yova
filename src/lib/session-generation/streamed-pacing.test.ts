import { describe, expect, it } from "vitest";
import type { StreamedGeneratedSessionActivity, StreamedGeneratedSessionDraft } from "@/lib/session-generation/schema";
import {
  allocateStreamedTeachingMinutes,
  interleaveStreamedTeachingCycles,
  streamedTeachingPacingContract,
  validateStreamedTeachingPacing,
} from "@/lib/session-generation/streamed-pacing";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

describe("streamed teaching pacing", () => {
  it("allocates a two-cycle lesson to the learner's exact 25-minute window", () => {
    const activities = [
      instruction("Teach energy coupling", "Energy coupling links exergonic and endergonic reactions."),
      question("Energy coupling", "explain"),
      instruction("Teach ATP hydrolysis", "ATP hydrolysis can drive cellular work through coupled reactions."),
      question("ATP hydrolysis", "transfer"),
    ];

    const allocated = allocateStreamedTeachingMinutes({ activities, availableMinutes: 25 });
    expect(allocated.reduce((sum, activity) => sum + activity.estimatedMinutes, 0)).toBe(25);
    expect(allocated.every((activity) => activity.estimatedMinutes >= 2)).toBe(true);
  });

  it("requires one teach-then-answer cycle per active idea within the activity limit", () => {
    expect(streamedTeachingPacingContract({ availableMinutes: 15, activeIdeaCount: 1 }).minimumTeachingBlocks).toBe(1);
    expect(streamedTeachingPacingContract({ availableMinutes: 25, activeIdeaCount: 2 }).minimumTeachingBlocks).toBe(2);
    expect(streamedTeachingPacingContract({ availableMinutes: 45, activeIdeaCount: 3 }).minimumTeachingBlocks).toBe(3);
    expect(streamedTeachingPacingContract({ availableMinutes: 60, activeIdeaCount: 4 }).minimumTeachingBlocks).toBe(4);
    expect(streamedTeachingPacingContract({ availableMinutes: 25, activeIdeaCount: 1 }).minimumActiveIdeas).toBe(2);
    expect(streamedTeachingPacingContract({ availableMinutes: 45, activeIdeaCount: 1 }).minimumActiveIdeas).toBe(3);
    expect(streamedTeachingPacingContract({ availableMinutes: 60, activeIdeaCount: 1 }).minimumActiveIdeas).toBe(4);
  });

  it.each([
    { minutes: 25, claimCount: 2 },
    { minutes: 45, claimCount: 3 },
    { minutes: 60, claimCount: 4 },
  ])("splits one broad target into distinct cycles for a $minutes-minute lesson", ({ minutes, claimCount }) => {
    const ideas = [
      "ATP hydrolysis releases free energy that can be coupled to cellular work.",
      "Phosphorylation changes a reactant so an energy-requiring reaction can proceed.",
      "Enzymes connect exergonic and endergonic steps without changing overall energy conservation.",
      "ATP regeneration links energy-releasing pathways to later energy-requiring processes.",
    ].slice(0, claimCount);
    const concepts = ["ATP hydrolysis", "Phosphorylation", "Enzyme coupling", "ATP regeneration"].slice(0, claimCount);
    const draft = sessionDraft([
      ...ideas.map((idea, index) => instruction(`Teach ${concepts[index]}`, idea)),
      ...concepts.map((concept) => question(concept, "explain")),
    ], ideas);

    const interleaved = interleaveStreamedTeachingCycles({ draft, availableMinutes: minutes });
    interleaved.activities = allocateStreamedTeachingMinutes({
      activities: interleaved.activities,
      availableMinutes: minutes,
    });

    const teachingIdeas = interleaved.activities.flatMap((activity) => (
      activity.type === "instruction" ? activity.lessonBrief?.essentialIdeas ?? [] : []
    ));
    expect(teachingIdeas).toEqual(ideas);
    expect(new Set(teachingIdeas).size).toBe(claimCount);
    expect(interleaved.activities.reduce((sum, activity) => sum + activity.estimatedMinutes, 0)).toBe(minutes);
    expect(validateStreamedTeachingPacing({ draft: interleaved, availableMinutes: minutes })).toBeNull();
  });

  it("rejects all-the-teaching-then-all-the-questions ordering", () => {
    const firstIdea = "Energy coupling links exergonic and endergonic reactions.";
    const secondIdea = "ATP hydrolysis can drive cellular work through coupled reactions.";
    const draft = sessionDraft([
      instruction("Teach energy coupling", firstIdea),
      instruction("Teach ATP hydrolysis", secondIdea),
      question("Energy coupling", "explain"),
      question("ATP hydrolysis", "transfer"),
    ], [firstIdea, secondIdea]);
    draft.activities = allocateStreamedTeachingMinutes({ activities: draft.activities, availableMinutes: 25 });

    expect(validateStreamedTeachingPacing({ draft, availableMinutes: 25 }))
      .toMatch(/Teaching block 1 must be followed by a required question/i);
  });

  it("deterministically pairs teaching blocks with their mapped questions", () => {
    const firstIdea = "Energy coupling links exergonic and endergonic reactions.";
    const secondIdea = "ATP hydrolysis can drive cellular work through coupled reactions.";
    const draft = sessionDraft([
      instruction("Teach energy coupling", firstIdea),
      instruction("Teach ATP hydrolysis", secondIdea),
      question("Energy coupling", "explain"),
      question("ATP hydrolysis", "transfer"),
    ], [firstIdea, secondIdea]);

    const interleaved = interleaveStreamedTeachingCycles({ draft, availableMinutes: 25 });
    expect(interleaved.activities.map((activity) => activity.type)).toEqual([
      "instruction",
      "free_response",
      "instruction",
      "free_response",
    ]);
    expect(interleaved.activities[0]?.lessonBrief?.essentialIdeas).toEqual([firstIdea]);
    expect(interleaved.activities[2]?.lessonBrief?.essentialIdeas).toEqual([secondIdea]);
  });

  it("builds four teach-then-answer cycles for a 60-minute lesson", () => {
    const ideas = [
      "Glycolysis splits glucose and captures a small amount of usable energy.",
      "Pyruvate oxidation links glycolysis to the citric acid cycle.",
      "The citric acid cycle transfers high-energy electrons to carriers.",
      "The electron transport chain uses those electrons to drive ATP synthesis.",
    ];
    const concepts = ["Glycolysis", "Pyruvate oxidation", "Citric acid cycle", "Electron transport chain"];
    const draft = sessionDraft([
      ...ideas.map((idea, index) => instruction(`Teach ${concepts[index]}`, idea)),
      ...concepts.map((concept, index) => question(concept, index === concepts.length - 1 ? "transfer" : "explain")),
    ], ideas);

    const interleaved = interleaveStreamedTeachingCycles({ draft, availableMinutes: 60 });
    interleaved.activities = allocateStreamedTeachingMinutes({
      activities: interleaved.activities,
      availableMinutes: 60,
    });

    expect(interleaved.activities.map((activity) => activity.type)).toEqual([
      "instruction", "free_response",
      "instruction", "free_response",
      "instruction", "free_response",
      "instruction", "free_response",
    ]);
    expect(interleaved.activities.reduce((sum, activity) => sum + activity.estimatedMinutes, 0)).toBe(60);
    expect(validateStreamedTeachingPacing({ draft: interleaved, availableMinutes: 60 })).toBeNull();
  });

  it("fits three active ideas into two interleaved blocks in a 25-minute window", () => {
    const ideas = [
      "Glycolysis splits glucose and captures a small amount of usable energy.",
      "Pyruvate oxidation links glycolysis to the citric acid cycle.",
      "The citric acid cycle transfers high-energy electrons to carriers.",
    ];
    const concepts = ["Glycolysis", "Pyruvate oxidation", "Citric acid cycle"];
    const draft = sessionDraft([
      ...ideas.map((idea, index) => instruction(`Teach ${concepts[index]}`, idea)),
      ...concepts.map((concept) => question(concept, "explain")),
    ], ideas);

    const interleaved = interleaveStreamedTeachingCycles({ draft, availableMinutes: 25 });
    interleaved.activities = allocateStreamedTeachingMinutes({
      activities: interleaved.activities,
      availableMinutes: 25,
    });

    expect(interleaved.activities.map((activity) => activity.type)).toEqual([
      "instruction", "free_response",
      "instruction", "free_response", "free_response",
    ]);
    expect(interleaved.activities[2]?.lessonBrief?.essentialIdeas).toEqual(ideas.slice(1));
    expect(interleaved.activities.reduce((sum, activity) => sum + activity.estimatedMinutes, 0)).toBe(25);
    expect(validateStreamedTeachingPacing({ draft: interleaved, availableMinutes: 25 })).toBeNull();
  });

  it("accepts interleaved streamed teaching and questions that use the full window", () => {
    const firstIdea = "Energy coupling links exergonic and endergonic reactions.";
    const secondIdea = "ATP hydrolysis can drive cellular work through coupled reactions.";
    const draft = sessionDraft([
      instruction("Teach energy coupling", firstIdea),
      question("Energy coupling", "explain"),
      instruction("Teach ATP hydrolysis", secondIdea),
      question("ATP hydrolysis", "transfer"),
    ], [firstIdea, secondIdea]);
    draft.activities = allocateStreamedTeachingMinutes({ activities: draft.activities, availableMinutes: 25 });

    expect(validateStreamedTeachingPacing({ draft, availableMinutes: 25 })).toBeNull();
  });

  it("splits a two-idea 15-minute lesson so interleaving cannot create an oversized first action", () => {
    const firstIdea = "Darkness changes the circadian signal that controls biological timing.";
    const secondIdea = "The pineal gland releases melatonin as a signal of biological night.";
    const draft = sessionDraft([
      instruction("Teach melatonin release", secondIdea),
      instruction("Teach darkness and timing", firstIdea),
      question("Darkness and circadian timing", "explain"),
      question("Pineal melatonin release", "explain"),
    ], [firstIdea, secondIdea]);
    draft.coverage.evidenceMap = [
      { essentialIdea: firstIdea, activityConcept: "Darkness and circadian timing" },
      { essentialIdea: secondIdea, activityConcept: "Pineal melatonin release" },
    ];

    const interleaved = interleaveStreamedTeachingCycles({
      draft,
      availableMinutes: 15,
      maximumFocusedActivities: 4,
      maximumFirstActionMinutes: 5,
    });
    interleaved.activities = allocateStreamedTeachingMinutes({
      activities: interleaved.activities,
      availableMinutes: 15,
      maximumFirstActionMinutes: 5,
    });

    expect(interleaved.activities.map((activity) => activity.type)).toEqual([
      "instruction", "free_response", "instruction", "free_response",
    ]);
    expect(interleaved.activities[0]?.lessonBrief?.essentialIdeas).toEqual([firstIdea]);
    expect(interleaved.activities[0]?.estimatedMinutes).toBeLessThanOrEqual(5);
    expect(interleaved.activities.reduce((sum, activity) => sum + activity.estimatedMinutes, 0)).toBe(15);
    expect(validateStreamedTeachingPacing({ draft: interleaved, availableMinutes: 15 })).toBeNull();
  });
});

function instruction(title: string, idea: string): StreamedGeneratedSessionActivity {
  return {
    topicId: TOPIC_ID,
    methodPhase: "model",
    estimatedMinutes: 5,
    requiredForCompletion: true,
    label: "Learn",
    title,
    body: "Read this focused explanation, then answer the question that follows.",
    teaching: null,
    lessonBrief: {
      version: 1,
      topicIds: [TOPIC_ID],
      essentialIdeas: [idea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge",
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true,
        includeConcreteExample: true,
        includeCommonMixup: true,
        preservePrerequisiteOrder: true,
      },
    },
    practiceIntent: null,
    misconceptionSummary: null,
    type: "instruction",
    concept: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
  };
}

function question(concept: string, methodPhase: "explain" | "transfer"): StreamedGeneratedSessionActivity {
  return {
    topicId: TOPIC_ID,
    methodPhase,
    estimatedMinutes: 4,
    requiredForCompletion: true,
    label: "Explain",
    title: `Explain ${concept}`,
    body: `Explain ${concept} from memory in your own words.`,
    teaching: null,
    lessonBrief: null,
    practiceIntent: "supported_recheck",
    misconceptionSummary: null,
    type: "free_response",
    concept,
    choices: [],
    correctAnswer: `${concept} has the relationship stated in the lesson model.`,
    feedback: `Compare your answer with the relationship taught for ${concept}.`,
  };
}

function sessionDraft(
  activities: StreamedGeneratedSessionActivity[],
  ideas: string[],
): StreamedGeneratedSessionDraft {
  const questionConcepts = activities.flatMap((activity) => (
    activity.type === "multiple_choice" || activity.type === "free_response"
      ? [activity.concept]
      : []
  ));
  return {
    topicIds: [TOPIC_ID],
    rationale: "Teach each active relationship and immediately require an answer from memory.",
    coverage: {
      focus: "Connect energy coupling with ATP hydrolysis.",
      essentialIdeas: ideas,
      completionEvidence: ideas.slice(0, 3).map((idea) => `Explain ${idea}`),
      evidenceMap: ideas.map((idea, index) => ({
        essentialIdea: idea,
        activityConcept: questionConcepts[index] ?? `Active idea ${index + 1}`,
      })),
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "self_explanation",
      name: "Self-explanation",
      what: "Study a connected model and explain each relationship from memory.",
      why: "Producing each relationship reveals whether it was understood.",
      how: ["Read one short model.", "Answer before reading the next model."],
      completion: "Explain both relationships without reopening the lesson.",
      personalization: ["The lesson is divided into short teaching and question cycles."],
    },
    sourceGrounding: null,
    activities,
  };
}

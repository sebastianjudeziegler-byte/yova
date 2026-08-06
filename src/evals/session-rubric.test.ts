import { describe, expect, it } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import { evaluateSessionDraft } from "@/evals/session-rubric";
import { GeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

const biologyCase = buildSessionEvaluationCases()[0];

const strongSession = GeneratedSessionDraftSchema.parse({
  rationale: "A short source-grounded explanation comes first, followed by two different retrieval attempts that expose gaps before review.",
  coverage: {
    focus: "Connect cellular respiration and photosynthesis, then retrieve the relationship.",
    essentialIdeas: ["Energy storage and release", "The location of glycolysis"],
    completionEvidence: ["Answer one location check and explain the energy relationship from memory"],
    deferredContent: [],
  },
  sourceGrounding: {
    mode: "materials_plus_ai",
    summary: "The learner's notes define the biology scope, while YOVA supplies only a concise connecting explanation.",
    sourceNames: ["biology-notes.txt"],
    anchors: [{
      sourceName: "biology-notes.txt",
      excerpt: "Cellular respiration converts glucose and oxygen into ATP.",
      usedFor: "This source statement anchors the session's explanation of cellular respiration.",
    }],
    supplements: [{
      topic: "Relationship between the two processes",
      reason: "The source lists both processes, while the session briefly models how to compare them.",
    }],
  },
  methodBriefing: {
    learningMode: "learn",
    taskType: "conceptual_learning",
    methodId: "retrieval_practice",
    name: "Retrieval practice",
    what: "Produce the biology relationship from memory before returning to the notes.",
    why: "The learner has an initial explanation and now needs objective evidence of which parts can be recalled independently.",
    how: ["Close the notes and attempt the prompt.", "Compare the answer and repair only the missing parts."],
    completion: "Both target ideas have been attempted from memory and each missing part is identified.",
    personalization: ["Keep the first attempt short and show one visible step at a time."],
  },
  activities: [
    {
      methodPhase: "model",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "Connect",
      title: "Build the energy picture",
      body: "Compare cellular respiration with photosynthesis using the inputs, outputs, locations, and energy transformations described in your notes.",
      teaching: {
        keyIdea: "Photosynthesis stores energy while cellular respiration releases usable energy.",
        explanation: "Photosynthesis uses light energy to build glucose, while cellular respiration breaks glucose down and transfers released energy into ATP that cells can use.",
        example: {
          setup: "Follow one unit of captured light energy through the two processes.",
          steps: [
            "Photosynthesis stores captured energy in the chemical bonds of glucose.",
            "Cellular respiration transfers part of that stored energy into ATP.",
          ],
          takeaway: "The processes transform energy in opposite, connected directions.",
        },
        commonMistake: null,
      },
      choices: [],
      correctAnswer: null,
      feedback: null,
    },
    {
      methodPhase: "retrieve",
      estimatedMinutes: 3,
      requiredForCompletion: true,
      type: "multiple_choice",
      concept: "Cellular respiration",
      label: "Check",
      title: "Locate glycolysis",
      body: "According to the notes, where does glycolysis occur?",
      teaching: null,
      choices: ["In the cytoplasm", "In the Calvin cycle", "In the nucleus"],
      correctAnswer: "In the cytoplasm",
      feedback: "Glycolysis occurs in the cytoplasm before later respiration stages continue in the mitochondria.",
    },
    {
      methodPhase: "repair",
      estimatedMinutes: 5,
      requiredForCompletion: true,
      type: "free_response",
      concept: "Photosynthesis and respiration",
      label: "Retrieve",
      title: "Explain the relationship",
      body: "Without looking, explain how photosynthesis and cellular respiration differ in their energy transformations.",
      teaching: null,
      choices: [],
      correctAnswer: "Photosynthesis stores light energy in glucose, while cellular respiration releases energy from glucose to produce ATP.",
      feedback: "A strong response contrasts storing light energy in glucose with releasing that chemical energy to produce ATP.",
    },
  ],
});

describe("session quality rubric", () => {
  it("passes a grounded session with support followed by retrieval", () => {
    const result = evaluateSessionDraft(
      strongSession,
      biologyCase.context,
      biologyCase.taskFamily,
      biologyCase.expectedSourceTerms,
    );

    expect(result.score).toBe(100);
    expect(result.requiredFailures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("rejects generic, unsupported personalization and weak task alignment", () => {
    const weakSession = GeneratedSessionDraftSchema.parse({
      rationale: "Because you are a visual learner, this session uses a generic diagram and then asks two unrelated questions.",
      coverage: {
        focus: "Look at a generic diagram and answer unrelated questions.",
        essentialIdeas: ["Generic diagram familiarity"],
        completionEvidence: ["Describe the generic activity"],
        deferredContent: [],
      },
      sourceGrounding: null,
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Generic visual review",
        what: "Look at a generic diagram and try to remember it for the next question.",
        why: "This was selected because you are a visual learner and therefore learn best from diagrams.",
        how: ["Look at the diagram for several minutes.", "Try to remember what it looked like."],
        completion: "The diagram has been viewed and the learner feels familiar with the content.",
        personalization: ["The session assumes a fixed visual learning style."],
      },
      activities: [
        {
          methodPhase: "model",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          type: "instruction",
          concept: null,
          label: "Read",
          title: "Look at a diagram",
          body: "Look at a generic diagram for several minutes and try to remember what you see.",
          teaching: {
            keyIdea: "A generic diagram is presented without source-specific teaching.",
            explanation: "This explanation intentionally remains generic so the evaluation can detect that it is not grounded in the learner's actual biology source.",
            example: null,
            commonMistake: null,
          },
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          methodPhase: "retrieve",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          type: "multiple_choice",
          concept: "Memory",
          label: "Check",
          title: "Choose an action",
          body: "Which action was suggested?",
          teaching: null,
          choices: ["Look at a diagram", "Take a walk", "Open a calendar"],
          correctAnswer: "Look at a diagram",
          feedback: "The instruction above told the learner to look at a generic diagram for several minutes.",
        },
        {
          methodPhase: "explain",
          estimatedMinutes: 5,
          requiredForCompletion: true,
          type: "free_response",
          concept: "Memory",
          label: "Reflect",
          title: "Describe the activity",
          body: "Describe what the activity asked you to do.",
          teaching: null,
          choices: [],
          correctAnswer: "The activity asked the learner to inspect and remember a generic diagram.",
          feedback: "A complete response should mention inspecting the diagram and trying to remember it.",
        },
      ],
    });

    const result = evaluateSessionDraft(
      weakSession,
      biologyCase.context,
      biologyCase.taskFamily,
      biologyCase.expectedSourceTerms,
    );

    expect(result.passed).toBe(false);
    expect(result.requiredFailures).toContain("Learner materials remain the factual anchor");
    expect(result.requiredFailures).toContain("No fixed brain, diagnosis, or learning-style claim");
  });
});

describe("session quality language safeguards", () => {
  it("does not mistake a diagnostic check for a medical diagnosis claim", () => {
    const result = evaluateSessionDraft(
      { ...strongSession, rationale: "A short diagnostic check showed which biology idea should be repaired before independent retrieval." },
      biologyCase.context,
      biologyCase.taskFamily,
      biologyCase.expectedSourceTerms,
    );

    expect(result.requiredFailures).not.toContain("No fixed brain, diagnosis, or learning-style claim");
  });
});

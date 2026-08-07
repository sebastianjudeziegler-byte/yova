import { describe, expect, it } from "vitest";
import { readSessionResourceFromStepData, toSessionResource } from "@/lib/session-generation/resource";
import { GeneratedSessionDraftSchema, type SessionGenerationResponse } from "@/lib/session-generation/schema";

const generatedSession: SessionGenerationResponse["session"] = {
  schemaVersion: 11,
  model: "gpt-test",
  generatedAt: "2026-08-05T18:00:00.000Z",
  rationale: "This sequence teaches the core idea before checking recall and application.",
  coverage: {
    focus: "Understand and retrieve the purpose of retrieval practice.",
    essentialIdeas: ["Retrieval happens before answer review"],
    completionEvidence: ["Explain the purpose of attempting an answer from memory"],
    evidenceMap: [{
      essentialIdea: "Retrieval happens before answer review",
      activityConcept: "Retrieval practice",
    }],
    deferredContent: [],
  },
  sourceGrounding: null,
  methodBriefing: {
    learningMode: "learn",
    taskType: "conceptual_learning",
    methodId: "retrieval_practice",
    name: "Retrieval practice",
    what: "Produce an answer from memory before looking at the explanation.",
    why: "This creates objective evidence of what is available without support before the learner reviews the idea.",
    how: ["Hide the explanation and attempt the answer.", "Compare, repair the gap, and retry it later."],
    completion: "The answer has been attempted from memory and every missing idea has been marked for review.",
    personalization: [],
  },
  supportPlan: {
    level: "fading",
    title: "Support reduced for Retrieval practice",
    explanation: "The prior guided check was secure, so this session removes some help before another independent attempt.",
    evidenceLabel: "1 completed check",
    concept: "Retrieval practice",
  },
  activities: [
    {
      methodPhase: "model",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      type: "instruction",
      concept: null,
      label: "Learn",
      title: "Build the idea",
      body: "Start with a concise explanation that connects the new idea to the learning goal.",
      teaching: {
        keyIdea: "Retrieval makes current knowledge visible before review.",
        explanation: "Trying to produce an answer first separates what is available from memory from what only feels familiar while it is visible.",
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
      concept: "Retrieval practice",
      label: "Check",
      title: "Choose the best description",
      body: "Which option best describes retrieval practice in this learning sequence?",
      teaching: null,
      choices: ["Recall before reviewing", "Copy notes repeatedly", "Only reread summaries"],
      correctAnswer: "Recall before reviewing",
      feedback: "Retrieval practice asks the learner to produce an answer before checking the source.",
    },
    {
      methodPhase: "repair",
      estimatedMinutes: 5,
      requiredForCompletion: true,
      type: "free_response",
      concept: "Retrieval practice",
      label: "Explain",
      title: "Teach it back",
      body: "Explain why recalling an answer before reviewing can reveal a useful learning gap.",
      teaching: null,
      choices: [],
      correctAnswer: "Trying first makes missing or uncertain knowledge visible before review.",
      feedback: "A strong response connects the retrieval attempt to identifying what needs repair.",
    },
  ],
};

describe("session resources", () => {
  it("turns a generated session into reusable plan content", () => {
    const resource = toSessionResource(generatedSession);
    expect(resource.origin).toBe("generated");
    expect(resource.generatedAt).toBe(generatedSession.generatedAt);
    expect(resource.methodBriefing?.methodId).toBe("retrieval_practice");
    expect(resource.supportPlan?.level).toBe("fading");
    expect(resource.activities).toHaveLength(3);
    expect(resource.activities[1].correctAnswer).toBe("Recall before reviewing");
  });

  it("reads valid cached content from database step data", () => {
    expect(readSessionResourceFromStepData({ generatedSession })?.activities[2].type).toBe("free_response");
  });

  it("ignores missing or unsafe cached content", () => {
    expect(readSessionResourceFromStepData(null)).toBeUndefined();
    expect(readSessionResourceFromStepData({ generatedSession: { rationale: "too small" } })).toBeUndefined();
  });

  it("rejects a teaching-first session that hides the lesson inside an instruction paragraph", () => {
    const invalidSession = {
      ...generatedSession,
      activities: [
        {
          ...generatedSession.activities[0],
          methodPhase: "orient",
          teaching: null,
          body: "Read the lesson text placed in this generic instruction field before continuing.",
        },
        ...generatedSession.activities.slice(1),
      ],
    };

    const result = GeneratedSessionDraftSchema.safeParse(invalidSession);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "activities.0.teaching")).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { TutorProposedActionSchema, TutorRequestSchema } from "@/lib/tutor/schema";

const sessionContext = {
  activityTitle: "Explain why the product rule has two terms",
  activityType: "free_response" as const,
  activityInstruction: "Explain the structure without copying the formula alone.",
  concept: "Product rule meaning",
  methodPhase: "independent_practice",
  teachingSummary: null,
  choices: [],
  referenceAnswer: "Either factor can change, so each term differentiates one factor while holding the other fixed.",
  feedback: "A strong answer connects each term to one changing factor.",
  answerState: "not_attempted" as const,
  selectedChoice: null,
  helpIntent: "give_hint" as const,
};

describe("tutor session context", () => {
  it("accepts bounded context for the exact guided-session activity", () => {
    const parsed = TutorRequestSchema.parse({
      question: "Give me one hint without revealing the answer.",
      planId: "10000000-0000-4000-8000-000000000001",
      threadId: null,
      history: [],
      sessionContext,
    });

    expect(parsed.sessionContext?.concept).toBe("Product rule meaning");
    expect(parsed.sessionContext?.helpIntent).toBe("give_hint");
    expect(parsed.sessionContext?.selectedChoice).toBeNull();
  });

  it("supports an ephemeral lesson conversation without changing thread chat", () => {
    const parsed = TutorRequestSchema.parse({
      question: "How is this related to entropy?",
      planId: "10000000-0000-4000-8000-000000000001",
      persistenceMode: "ephemeral",
      history: [],
      sessionContext: {
        ...sessionContext,
        planSessionId: "30000000-0000-4000-8000-000000000001",
        activityIndex: 0,
        activityType: "instruction",
      },
    });

    expect(parsed.persistenceMode).toBe("ephemeral");
    expect(parsed.sessionContext?.activityIndex).toBe(0);
  });

  it("does not accept an unbounded or ambiguous session-help payload", () => {
    const result = TutorRequestSchema.safeParse({
      question: "Help me",
      history: [],
      sessionContext: {
        activityTitle: "Current step",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("tutor plan actions", () => {
  it("accepts a learner-approved plan direction change", () => {
    const action = TutorProposedActionSchema.parse({
      id: "20000000-0000-4000-8000-000000000001",
      type: "redirect_plan",
      planId: "10000000-0000-4000-8000-000000000001",
      direction: "Keep the remaining plan conceptual and do not use calculations.",
      title: "Rebuild the unfinished plan",
      explanation: "Completed work stays unchanged. Only unfinished sessions will be redirected.",
    });

    expect(action.type).toBe("redirect_plan");
  });
});

import { describe, expect, it } from "vitest";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

function request(goal: string, judgment: {
  band: "focused_skill" | "unit_or_exam" | "broad_course";
  label: string;
  minimumSessions: number;
  recommendedSessions: number;
  maximumSessions: number;
  minimumTeachingSessions: number;
}) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal,
    startingContext: "I am starting from ground zero.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: null,
    timeZone: "America/Los_Angeles",
    diagnosticResponses: [{
      question: "Where are you starting?",
      answer: "Completely new",
      evaluation: "self_report",
    }],
    availability: [{ day: "Monday", window: "Evening", minutes: 25 }],
    profileSummary: "The learner wants explicit steps and concise explanations before practice.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        ...judgment,
        explanation: "The model classified this request from its goal, starting context, deadline, and mapped prerequisite structure.",
      },
      topics: [{
        id: TOPIC_ID,
        title: "Mapped starting topic",
        description: "A concrete topic selected from the learner's requested scope.",
        subtopics: [],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
      }],
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
}

describe("plan scope contract", () => {
  it("keeps a named skill bounded", () => {
    const scope = inferPlanScopeContract(request("Learn the product rule from scratch.", {
      band: "focused_skill", label: "Focused skill", minimumSessions: 2, recommendedSessions: 4, maximumSessions: 6, minimumTeachingSessions: 1,
    }));
    expect(scope.band).toBe("focused_skill");
    expect(scope.recommendedSessions).toBe(4);
    expect(scope.maximumSessions).toBe(6);
  });

  it("expands a whole subject into a broad pathway", () => {
    const scope = inferPlanScopeContract(request("Learn all of calculus from the beginning.", {
      band: "broad_course", label: "Broad course", minimumSessions: 10, recommendedSessions: 12, maximumSessions: 14, minimumTeachingSessions: 4,
    }));
    expect(scope.band).toBe("broad_course");
    expect(scope.minimumSessions).toBe(10);
    expect(scope.recommendedSessions).toBe(12);
    expect(scope.minimumTeachingSessions).toBe(4);
  });

  it("treats an exam or multi-topic goal as unit sized", () => {
    const scope = inferPlanScopeContract(request("Prepare for my biology test on respiration, photosynthesis, and enzymes.", {
      band: "unit_or_exam", label: "Unit or exam", minimumSessions: 4, recommendedSessions: 7, maximumSessions: 10, minimumTeachingSessions: 2,
    }));
    expect(scope.band).toBe("unit_or_exam");
    expect(scope.recommendedSessions).toBe(7);
  });
});

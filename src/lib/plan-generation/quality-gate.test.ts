import { describe, expect, it } from "vitest";
import { validateGeneratedPlanQuality } from "@/lib/plan-generation/quality-gate";
import {
  GeneratedPlanDraftSchema,
  PlanGenerationRequestSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(overrides: Partial<PlanGenerationRequest> = {}) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan",
    learningIntent: "learn",
    goal: "Understand cellular respiration and then practice explaining it without notes.",
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline: "2026-08-14T23:00:00.000Z",
    timeZone: "UTC",
    diagnosticResponses: [{
      question: "What can you do already?",
      answer: "I recognize the terms but cannot explain the process.",
      evaluation: "self_report",
    }],
    availability: [
      { day: "Monday", window: "Evening", minutes: 25 },
      { day: "Wednesday", window: "Evening", minutes: 20 },
    ],
    profileSummary: "The learner wants concise explanations and one visible step at a time.",
    ...overrides,
  });
}

function makeDraft(overrides: Partial<GeneratedPlanDraft> = {}) {
  return GeneratedPlanDraftSchema.parse({
    title: "Cellular respiration",
    topic: "How cells transform glucose into usable ATP",
    kind: "topic",
    deadline: "2026-08-14T23:00:00.000Z",
    rationale: "Build the causal model first, then remove the explanation and check whether the learner can reconstruct it.",
    deferredTopics: [],
    sessions: [
      {
        title: "Build the respiration model",
        objective: "Explain how glycolysis, the Krebs cycle, and electron transport contribute to ATP production.",
        method: "Self-explanation",
        methodReason: "A connected explanation is needed before unsupported retrieval can produce useful evidence.",
        scheduledFor: "2026-08-10T18:00:00.000Z",
        estimatedMinutes: 25,
        amountLabel: "One connected model and one explanation check",
        learningMode: "learn",
        topicIds: [TOPIC_ID],
        contentTargets: ["The relationship between the three stages", "How ATP production changes across the stages"],
        completionEvidence: ["Explain the relationship between all three stages in your own words"],
      },
      {
        title: "Retrieve and apply the model",
        objective: "Reconstruct the process without notes and apply it to a change in oxygen availability.",
        method: "Retrieval practice",
        methodReason: "An unsupported attempt now checks whether the causal model remains available without the explanation.",
        scheduledFor: "2026-08-12T18:00:00.000Z",
        estimatedMinutes: 20,
        amountLabel: "One retrieval and one application",
        learningMode: "study",
        topicIds: [TOPIC_ID],
        contentTargets: ["The complete respiration sequence", "Effects of limited oxygen"],
        completionEvidence: ["Recall the sequence without notes", "Apply the model to one unfamiliar scenario"],
      },
    ],
    ...overrides,
  });
}

describe("generated plan quality gate", () => {
  it("accepts a bounded plan that progresses from teaching to independent evidence", () => {
    expect(validateGeneratedPlanQuality(makeDraft(), makeRequest())).toBeNull();
  });

  it("rejects a session that exceeds the learner's available window", () => {
    const draft = makeDraft();
    draft.sessions[1].estimatedMinutes = 25;

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/only made 20 minutes available/i);
  });

  it("rejects multiple sessions that exceed the day's total available time", () => {
    const draft = makeDraft();
    draft.sessions[1].scheduledFor = draft.sessions[0].scheduledFor;

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/45 planned minutes.*25 total minutes available/i);
  });

  it("rejects a method that does not fit the actual learning task", () => {
    const draft = makeDraft();
    draft.sessions[0].method = "Scaffolded coding";

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/does not fit.*conceptual learning/i);
  });

  it("rejects passive completion rules that treat exposure as learning", () => {
    const draft = makeDraft();
    draft.sessions[0].completionEvidence = ["Spend 25 minutes reading the explanation"];

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/produces or attempts/i);
  });

  it("rejects more content targets than a short session can teach coherently", () => {
    const draft = makeDraft();
    draft.sessions[0].contentTargets = [
      "Glycolysis",
      "The Krebs cycle",
      "Electron transport",
      "Fermentation",
    ];

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/contains 4 content targets; its limit is 3/i);
  });

  it("rejects teaching plans that never transition into practice", () => {
    const draft = makeDraft();
    draft.sessions[1].learningMode = "learn";

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/move from teaching/i);
  });

  it("rejects fixed learning-style claims", () => {
    const draft = makeDraft({ rationale: "You are a visual learner, so diagrams are how your brain learns best." });

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/unsupported fixed learning-style/i);
  });

  it("rejects raw Markdown and dash typography that would look broken in the interface", () => {
    const draft = makeDraft();
    draft.sessions[0].title = "Build the model — then test it with **active recall**";

    expect(validateGeneratedPlanQuality(draft, makeRequest())).toMatch(/clean interface text/i);
  });

  it("requires exactly one correctly sized session for study now", () => {
    const request = makeRequest({
      intent: "study_now",
      learningIntent: "study",
      deadline: null,
      availability: [{ day: "Monday", window: "Now", minutes: 15 }],
    });

    expect(validateGeneratedPlanQuality(makeDraft(), request)).toMatch(/exactly one focused session/i);
  });
});

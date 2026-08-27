import { describe, expect, it } from "vitest";
import { normalizeGeneratedPlanLearningContract } from "@/lib/plan-generation/normalize-learning-contract";
import {
  PlanGenerationRequestSchema,
  ProviderGeneratedPlanDraftSchema,
} from "@/lib/plan-generation/schema";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

const request = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn calculus from the beginning, including limits, derivatives, and integrals.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [],
  availability: [{ day: "Monday", window: "Evening", minutes: 30 }],
  profileSummary: "The learner wants an overall map and one complete example before trying a problem.",
});

const draft = ProviderGeneratedPlanDraftSchema.parse({
  title: "Calculus Foundations",
  topic: "Limits, derivatives, and integrals",
  kind: "course",
  deadline: null,
  rationale: "Build the prerequisites and then move toward independent mathematical use.",
  deferredTopics: [],
  sessions: [{
    title: "Build the derivative model",
    objective: "Understand the derivative as an instantaneous rate and calculate one derivative.",
    scheduledFor: "2026-08-10T19:00:00.000-07:00",
    estimatedMinutes: 30,
    amountLabel: "One derivative model and one example",
    learningMode: "learn",
    topicIds: [TOPIC_ID],
    contentTargets: ["The derivative as an instantaneous rate"],
    completionEvidence: ["Review the worked example and spend time checking the steps"],
  }],
});

describe("generated plan learning contract", () => {
  it("adds a task-compatible method in code and replaces passive completion with active evidence", () => {
    const normalized = normalizeGeneratedPlanLearningContract(draft, request);

    expect(normalized.sessions[0].method).toBe("Worked Examples");
    expect(normalized.sessions[0].methodReason).toMatch(/problem solving/i);
    expect(normalized.sessions[0].completionEvidence[0]).toMatch(/^Solve /);
  });

  it("strips an attempted provider method before deterministic routing", () => {
    const attemptedMethod = ProviderGeneratedPlanDraftSchema.parse({
      ...draft,
      sessions: draft.sessions.map((session) => ({
        ...session,
        method: "Scaffolded coding",
        methodReason: "The provider tried to choose this method.",
        completionEvidence: ["Solve one representative derivative problem independently"],
      })),
    });

    expect(attemptedMethod.sessions[0]).not.toHaveProperty("method");
    expect(attemptedMethod.sessions[0]).not.toHaveProperty("methodReason");
    const normalized = normalizeGeneratedPlanLearningContract(attemptedMethod, request);

    expect(normalized.sessions[0].method).toBe("Worked Examples");
    expect(normalized.sessions[0].methodReason).toMatch(/YOVA selected it.*problem solving/i);
  });

  it("keeps a reported preference without turning it into a fixed learning claim", () => {
    const personalizedDraft = ProviderGeneratedPlanDraftSchema.parse({
      ...draft,
      rationale: "You learn best with one complete example before practice.",
    });

    const normalized = normalizeGeneratedPlanLearningContract(personalizedDraft, request);

    expect(normalized.rationale).toBe("you currently prefer one complete example before practice.");
    expect(normalized.sessions[0].methodReason).not.toMatch(/learns? best|learning style/i);
    expect(normalized.sessions[0].methodReason).toMatch(/problem solving/i);
  });

  it("normalizes a provider-invented learning-style label in its remaining prose", () => {
    const personalizedDraft = ProviderGeneratedPlanDraftSchema.parse({
      ...draft,
      rationale: "The learner's learning style favors diagrams, and the learner learns best when one example comes first.",
    });

    const normalized = normalizeGeneratedPlanLearningContract(personalizedDraft, request);

    expect(normalized.rationale).toBe("the current study preference favors diagrams, and the learner currently prefers learning when one example comes first.");
    expect(JSON.stringify(normalized)).not.toMatch(/learning style|visual learner/i);
  });

  it("uses the learner's original writing goal when a generated title becomes vague", () => {
    const writingRequest = PlanGenerationRequestSchema.parse({
      ...request,
      goal: "Plan and draft a comparative history essay using evidence from my notes.",
      studyMode: "outside",
    });
    const vagueDraft = ProviderGeneratedPlanDraftSchema.parse({
      ...draft,
      title: "History project",
      topic: "Organizing the work",
      sessions: draft.sessions.map((session) => ({
        ...session,
        title: "Build the first section",
        objective: "Organize the first section clearly.",
        completionEvidence: ["Draft one bounded section and match each claim to evidence"],
      })),
    });

    const normalized = normalizeGeneratedPlanLearningContract(vagueDraft, writingRequest);

    expect(normalized.sessions[0].method).toBe("Outline from Memory");
    expect(normalized.sessions[0].methodReason).toMatch(/writing argumentation/i);
  });
});

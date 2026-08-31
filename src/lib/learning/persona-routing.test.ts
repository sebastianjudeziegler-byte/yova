import { describe, expect, it } from "vitest";
import { buildLearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  LEARNER_PERSONAS,
  personaRoutingInput,
  type LearnerPersona,
} from "@/lib/learning/persona-fixtures";

function routeFor(persona: LearnerPersona, overrides = {}) {
  return buildLearningScienceRoutingBrief(personaRoutingInput(persona, overrides));
}

function persona(id: string) {
  const found = LEARNER_PERSONAS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown persona fixture: ${id}`);
  return found;
}

describe("routing the same goal for different learners", () => {
  it("does not give every learner the same method", () => {
    const methods = new Set(
      LEARNER_PERSONAS.map((candidate) => routeFor(candidate).suggestedPrimaryMethodId),
    );

    // The guarantee this whole file exists to protect: learner state reaches
    // the method decision. If personalization is ever disconnected, every
    // persona collapses onto one method and this fails.
    expect(methods.size).toBeGreaterThan(1);
  });

  it("keeps every chosen method valid for the task and knowledge stage", () => {
    for (const candidate of LEARNER_PERSONAS) {
      const route = routeFor(candidate);
      expect(route.allowedMethodIds).toContain(route.suggestedPrimaryMethodId);
    }
  });

  it("keeps example support in delivery without replacing the attempt-first problem method", () => {
    const problemSolving = {
      goalTitle: "Calculus derivatives test",
      goalTopic: "Differentiating products and composite functions",
      sessionTitle: "Practice the product rule",
      sessionObjective: "Solve product rule problems accurately",
    };

    const route = routeFor(persona("example_led"), problemSolving);
    expect(route.suggestedPrimaryMethodId).toBe("practice_problems");
    expect(route.deliveryModifiers.join(" ")).toMatch(/concrete example/i);
  });

  it("moves a learner who forgets quickly toward retrieval", () => {
    const route = routeFor(persona("forgets_quickly"));
    expect(["retrieval_practice", "spaced_retrieval"]).toContain(route.suggestedPrimaryMethodId);
  });

  it("chooses interleaving for a learner who confuses similar ideas when the task allows it", () => {
    const cumulativeExam = {
      taskTypeOverride: "mixed_assessment" as const,
      goalTitle: "Cumulative biology exam",
      goalTopic: "Mixed review across respiration, photosynthesis, and transport",
      sessionTitle: "Mixed review",
      sessionObjective: "Tell the similar processes apart under exam conditions",
    };

    expect(routeFor(persona("confuses_similar"), cumulativeExam).suggestedPrimaryMethodId)
      .toBe("interleaved_practice");
    // The same task without that preference keeps the catalog default.
    expect(routeFor(persona("blank_slate"), cumulativeExam).suggestedPrimaryMethodId)
      .not.toBe("interleaved_practice");
  });

  it("will not add interleaving to a conceptual task where it is not eligible", () => {
    // Preference must never widen the candidate set, only order it.
    const route = routeFor(persona("confuses_similar"), {
      taskTypeOverride: "conceptual_learning" as const,
    });

    expect(route.allowedMethodIds).not.toContain("interleaved_practice");
  });

  it("does not let profile or history replace the sole eligible Practice-first method", () => {
    const problemSolving = {
      goalTitle: "Calculus derivatives test",
      goalTopic: "Differentiating products and composite functions",
      sessionTitle: "Practice the product rule",
      sessionObjective: "Solve product rule problems accurately",
    };

    const statedOnly = routeFor(persona("example_led"), problemSolving);
    const contradicted = routeFor(persona("examples_not_working"), problemSolving);

    expect(statedOnly.suggestedPrimaryMethodId).toBe("practice_problems");
    expect(contradicted.suggestedPrimaryMethodId).toBe("practice_problems");
  });

  it("does not claim learner state changed a method when Practice has one eligible choice", () => {
    const route = routeFor(persona("example_led"), {
      goalTitle: "Calculus derivatives test",
      goalTopic: "Differentiating products and composite functions",
      sessionTitle: "Practice the product rule",
      sessionObjective: "Solve product rule problems accurately",
    });

    expect(route.suggestedPrimaryMethodId).toBe("practice_problems");
    expect(route.methodFit?.learnerFacingReason).toBeNull();
    expect(route.decisionBasis.join(" ")).not.toContain("Learner fit");
    expect(route.deliveryModifiers.join(" ")).toMatch(/concrete example/i);
  });

  it("says nothing about learner fit when the learner has told YOVA nothing", () => {
    const route = routeFor(persona("blank_slate"));

    expect(route.methodFit?.learnerFacingReason).toBeNull();
    expect(route.decisionBasis.join(" ")).not.toContain("Learner fit");
  });

  it("routes each persona identically on repeated runs", () => {
    for (const candidate of LEARNER_PERSONAS) {
      expect(routeFor(candidate).suggestedPrimaryMethodId)
        .toBe(routeFor(candidate).suggestedPrimaryMethodId);
    }
  });
});

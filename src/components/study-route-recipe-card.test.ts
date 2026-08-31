import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import { StudyRouteRecipeCard, agencyModeCopy } from "./study-route-recipe-card";

describe("study route recipe card", () => {
  it("renders the route-owned mode, phases, time, reason, and alternatives", () => {
    const route = StudyRouteSchema.parse({
      identity: {
        routeLineageId: "11111111-1111-4111-8111-111111111111",
        routeRevisionId: "22222222-2222-4222-8222-222222222222",
        revisionNumber: 1,
        schemaVersion: 1,
        lifecycleStatus: "committed",
        planId: "33333333-3333-4333-8333-333333333333",
        sessionId: "44444444-4444-4444-8444-444444444444",
        createdAt: "2026-08-30T10:00:00.000Z",
        committedAt: "2026-08-30T10:01:00.000Z",
      },
      target: {
        taskFamily: "conceptual_learning",
        desiredOutcome: "Explain the mechanism independently.",
        targetStates: [{
          targetId: "55555555-5555-4555-8555-555555555555",
          stage: "novice",
          uncertainty: "high",
          evidenceRefs: [],
        }],
        sourceRequirements: {
          sourceType: "yova_generated",
          requiredSourceIds: [],
          groundingRequired: false,
          instructions: [],
        },
      },
      approach: {
        mode: "learn",
        executionEnvironment: "inside_yova",
        primaryMethodId: "self_explanation",
        visibleMethodName: CORE_METHOD_CATALOG.self_explanation.name,
        confidenceLevel: "medium",
      },
      timing: {
        activeMinutes: 25,
        elapsedMinutes: 25,
        durationSource: "router_default",
      },
      execution: {
        orderedPhases: [
          { phaseId: "model", methodPhase: "model", activeMinutes: 7, targetIds: ["55555555-5555-4555-8555-555555555555"] },
          { phaseId: "explain", methodPhase: "explain", activeMinutes: 7, targetIds: ["55555555-5555-4555-8555-555555555555"] },
          { phaseId: "repair", methodPhase: "repair", activeMinutes: 6, targetIds: ["55555555-5555-4555-8555-555555555555"] },
          { phaseId: "reexplain", methodPhase: "reexplain", activeMinutes: 5, targetIds: ["55555555-5555-4555-8555-555555555555"] },
        ],
        difficultyTier: "foundational",
        initialSupport: "supported_start",
        activityLimit: 6,
        completionEvidence: [{
          evidenceId: "independent-explanation",
          targetIds: ["55555555-5555-4555-8555-555555555555"],
          kind: "explanation",
          description: "Explain the mechanism without looking at the model.",
          requiresIndependentAttempt: true,
        }],
        deferredTargets: [],
      },
      agency: {
        controlMode: "help_me_choose",
        selectedBy: "yova",
        alternatives: [],
      },
      explanation: {
        shortReason: "A model followed by explanation and repair fits this new concept.",
        taskRequirements: ["A new causal model must be established before independent explanation."],
        learnerDeclarations: ["You told YOVA that a concrete example helps you start unfamiliar material."],
        observations: ["YOVA has not observed a comparable completed session yet."],
        uncertainties: ["YOVA is still unsure how much support you will need after the first attempt."],
      },
      provenance: {
        routerVersion: "router-v1",
        profileVersion: "profile-v1",
        evidenceRefs: [],
        ruleTrace: [{
          ruleId: "task-stage-baseline",
          result: "selected",
          reason: "A novice conceptual target needs a teaching-first route.",
          evidenceRefs: [],
        }],
      },
    });
    const html = renderToStaticMarkup(createElement(StudyRouteRecipeCard, { route }));

    expect(html).toContain("Help Me Choose");
    expect(html).toContain("See the complete recipe");
    expect(html).toContain("Feynman Technique");
    expect(html).toContain("25 minutes total");
    expect(html).toContain("Model");
    expect(html).toContain("Reexplain");
    expect(html).toContain("Why this recipe");
    expect(html).toContain("What the task requires");
    expect(html).toContain("What you told YOVA");
    expect(html).toContain("What YOVA observed");
    expect(html).toContain("What YOVA is still unsure about");
  });

  it("uses the three exact learner-facing agency labels", () => {
    expect(agencyModeCopy("yova_decides").label).toBe("YOVA Decides");
    expect(agencyModeCopy("help_me_choose").label).toBe("Help Me Choose");
    expect(agencyModeCopy("ill_customize").label).toBe("I’ll Customize");
  });
});

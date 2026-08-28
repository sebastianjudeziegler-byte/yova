import { describe, expect, it } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import type { ConceptSignal } from "@/lib/learning/concept-evidence";
import { buildConceptReviewSchedule } from "@/lib/learning/concept-review-scheduler";
import { buildLearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  LEARNER_PERSONAS,
  personaRoutingInput,
} from "@/lib/learning/persona-fixtures";
import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import { recommendStudySchedule } from "@/lib/personalization/study-schedule";
import {
  buildOutsideYovaFallbackLesson,
  canUseBuiltInSessionFallback,
} from "@/lib/session-generation/built-in-fallback";

function persona(id: string) {
  const found = LEARNER_PERSONAS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown Milestone 0 persona: ${id}`);
  return found;
}

function conceptSignal(overrides: Partial<ConceptSignal>): ConceptSignal {
  return {
    concept: "Product rule",
    attempts: 1,
    secureAttempts: 0,
    needsReviewAttempts: 1,
    lastOutcome: "needs_review",
    lastObservedAt: "2026-08-20T09:00:00.000Z",
    status: "needs_review",
    ...overrides,
  };
}

describe("Milestone 0 frozen evaluation corpus", () => {
  it("keeps representative plan cases for source, placement, duration, task, and execution mode", () => {
    const cases = buildPlanEvaluationCases(new Date("2026-08-23T12:00:00.000Z"));
    const ids = cases.map((candidate) => candidate.id);

    expect(ids).toEqual(expect.arrayContaining([
      "biology_source_grounded",
      "calculus_mixed_placement_25",
      "product_rule_narrow_15",
      "history_writing_outside",
      "javascript_coding",
    ]));

    const mixedPlacement = cases.find((candidate) => candidate.id === "calculus_mixed_placement_25");
    expect(mixedPlacement?.request.knowledgeMap?.placementCheck).toMatchObject({
      status: "completed",
    });
    expect(mixedPlacement?.request.knowledgeMap?.placementCheck.demonstratedTopicIds.length).toBeGreaterThan(0);
    expect(mixedPlacement?.request.knowledgeMap?.placementCheck.gapTopicIds.length).toBeGreaterThan(0);

    expect(cases.find((candidate) => candidate.id === "history_writing_outside")?.request.studyMode)
      .toBe("outside");
  });

  it("keeps representative session cases for beginner, reviewer, mixed-target, repair, outside, and degraded-source work", () => {
    const ids = buildSessionEvaluationCases().map((candidate) => candidate.id);

    expect(ids).toEqual(expect.arrayContaining([
      "biology_initial_teaching",
      "bioenergetics_multi_target_study",
      "calculus_initial_teaching_15_min",
      "calculus_targeted_repair",
      "calculus_delayed_retrieval_self_contained",
      "history_writing_outside",
      "javascript_scaffold_fading",
      "thin_biology_outline_support",
    ]));
  });
});

describe("Milestone 0 current personalization characterization", () => {
  it("lets profile evidence change an uncommitted method without treating plan prose as a commitment", () => {
    const sharedTask = {
      taskTypeOverride: "mixed_assessment" as const,
      goalTitle: "Cumulative biology exam",
      goalTopic: "Respiration, photosynthesis, and membrane transport",
      sessionTitle: "Mixed process review",
      sessionObjective: "Distinguish similar biological processes under exam conditions",
    };
    const blankRoute = buildLearningScienceRoutingBrief(personaRoutingInput(
      persona("blank_slate"),
      sharedTask,
    ));
    const learnerFitRoute = buildLearningScienceRoutingBrief(personaRoutingInput(
      persona("confuses_similar"),
      sharedTask,
    ));

    expect(blankRoute.suggestedPrimaryMethodId).not.toBe(learnerFitRoute.suggestedPrimaryMethodId);
    expect(learnerFitRoute.suggestedPrimaryMethodId).toBe("interleaved_practice");

    const pinnedRoute = buildLearningScienceRoutingBrief(personaRoutingInput(
      persona("confuses_similar"),
      {
        ...sharedTask,
        plannedMethod: "Retrieval practice",
        plannedMethodReason: "The active plan already committed to retrieval practice.",
      },
    ));

    expect(pinnedRoute.methodFit?.selectedMethodId).toBe("interleaved_practice");
    expect(pinnedRoute.suggestedPrimaryMethodId).toBe("interleaved_practice");
    expect(pinnedRoute.decisionBasis.join(" ")).toContain("instead of treating prose as a commitment");
  });

  it("changes delivery for two profiles while holding the learning job and duration fixed", () => {
    const shared = {
      recentResults: [],
      recentInterruptions: [],
      learningMode: "learn" as const,
      estimatedMinutes: 25,
    };
    const exampleLed = buildSessionDeliveryPolicy({
      ...shared,
      learnerProfile: {
        processingPreference: "A concrete example before the rule",
        memoryChallenge: "I understand it but cannot apply it",
        supportPreference: "Show me a different example",
        workspacePreference: "Show one step at a time",
      },
    });
    const contrastLed = buildSessionDeliveryPolicy({
      ...shared,
      learnerProfile: {
        processingPreference: "Comparing similar ideas side by side",
        memoryChallenge: "I confuse similar ideas",
        supportPreference: "Explain the mistake directly",
        workspacePreference: "Keep the full path visible",
      },
    });

    expect(exampleLed).toMatchObject({
      presentation: { mode: "example_first" },
      repair: { mode: "alternate_example" },
      workspace: { mode: "one_step" },
    });
    expect(contrastLed).toMatchObject({
      presentation: { mode: "compare_first" },
      repair: { mode: "direct_correction" },
      workspace: { mode: "full_path" },
    });
    expect(exampleLed.pacing.maximumActivities).toBe(contrastLed.pacing.maximumActivities);
  });

  it("currently derives the starting schedule from declared text and fixed duration levels", () => {
    const declared = recommendStudySchedule(
      "What study-session length usually feels realistic? 10 to 15 minutes "
      + "When do you usually have the most usable energy? Morning",
    );
    const unknown = recommendStudySchedule("No established behavioral preferences yet.");

    expect(declared).toMatchObject({ window: "Morning", minutes: 15 });
    expect(unknown).toMatchObject({ window: "Anytime", minutes: 25 });
    expect([15, 25, 45, 60]).toContain(declared.minutes);
  });

  it("keeps review timing attached to each observed concept instead of merging concepts", () => {
    const schedule = buildConceptReviewSchedule([
      conceptSignal({
        topicId: "11111111-1111-4111-8111-111111111111",
        concept: "Product rule",
      }),
      conceptSignal({
        topicId: "22222222-2222-4222-8222-222222222222",
        concept: "Chain rule",
        attempts: 1,
        secureAttempts: 1,
        needsReviewAttempts: 0,
        lastOutcome: "secure",
        status: "early_signal",
      }),
    ], new Date("2026-08-21T12:00:00.000Z"));

    expect(schedule).toHaveLength(2);
    expect(schedule).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topicId: "11111111-1111-4111-8111-111111111111",
        concept: "Product rule",
        reviewType: "repair_and_retrieve",
        intervalDays: 1,
      }),
      expect.objectContaining({
        topicId: "22222222-2222-4222-8222-222222222222",
        concept: "Chain rule",
        reviewType: "verify",
        intervalDays: 2,
      }),
    ]));
  });

  it("keeps a ten-minute outside workflow bounded and treats material-backed outage recovery conservatively", () => {
    const outside = buildOutsideYovaFallbackLesson({
      topic: "Comparative history evidence",
      objective: "Build one evidence-based comparison from the textbook and notes.",
      method: "Retrieval-based outlining",
      learningMode: "study",
      availableMinutes: 10,
    });

    expect(outside).not.toBeNull();
    expect(outside?.activities).toHaveLength(3);
    expect(outside?.activities.reduce(
      (total, activity) => total + (activity.estimatedMinutes ?? 0),
      0,
    )).toBe(10);
    expect(outside?.activities.every((activity) => !activity.teaching)).toBe(true);

    const outage = {
      planStatus: "active",
      responseStatus: 503,
      adjustment: null,
    };
    expect(canUseBuiltInSessionFallback({ ...outage, sourceMode: "yova_generated" })).toBe(true);
    expect(canUseBuiltInSessionFallback({ ...outage, sourceMode: "user_materials" })).toBe(false);
  });
});

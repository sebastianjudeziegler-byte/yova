import { describe, expect, it } from "vitest";
import type { SessionLearningMode } from "@/lib/domain";
import {
  CORE_METHOD_IDS,
  LEARNING_TASK_TYPES,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import { KNOWLEDGE_STAGES, type KnowledgeStage } from "@/lib/learning/method-eligibility";
import {
  BLURTING_MAX_ACTIVE_MINUTES,
  BLURTING_ORDERED_PHASES,
  BLURTING_RUNTIME_FORMAT,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  METHOD_RECIPE_POLICY_VERSION,
  selectMethodRecipe,
  type MethodRecipePolicyInput,
} from "@/lib/learning/method-recipes";

function eligibleInput(
  overrides: Partial<MethodRecipePolicyInput> = {},
): MethodRecipePolicyInput {
  return {
    blurtingEnabled: true,
    learningMode: "study",
    primaryMethodId: "retrieval_practice",
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    isReview: false,
    activeMinutes: 10,
    activeTargetCount: 3,
    comparisonSourceAvailable: true,
    ...overrides,
  };
}

describe("method recipe policy", () => {
  it("selects the exact Blurting recipe without creating a new core method", () => {
    const decision = selectMethodRecipe(eligibleInput());

    expect(decision).toEqual({
      kind: "recipe",
      policyVersion: "method_recipe_v1",
      recipeId: "blurting_v1",
      primaryMethodId: "retrieval_practice",
      visibleMethodName: "Blurting",
      visibleSupportingTechniqueId: "blurting_v1",
      orderedPhases: ["retrieve", "repair", "transfer"],
      runtimeFormat: "broad_recall_v1",
      reason: expect.stringMatching(/ordinary Practice retrieval.*comparison source/i),
    });
    expect(CORE_METHOD_IDS).not.toContain("blurting_v1");
    expect(METHOD_RECIPE_POLICY_VERSION).toBe("method_recipe_v1");
    expect(BLURTING_SUPPORTING_TECHNIQUE_ID).toBe("blurting_v1");
    expect(BLURTING_VISIBLE_METHOD_NAME).toBe("Blurting");
    expect(BLURTING_RUNTIME_FORMAT).toBe("broad_recall_v1");
    expect(BLURTING_MAX_ACTIVE_MINUTES).toBe(60);
    expect(BLURTING_ORDERED_PHASES).toEqual(["retrieve", "repair", "transfer"]);
  });

  it("is disabled when the server caller omits or denies rollout authority", () => {
    const omitted = eligibleInput();
    delete (omitted as { blurtingEnabled?: boolean }).blurtingEnabled;

    expect(selectMethodRecipe(omitted)).toMatchObject({
      kind: "baseline",
      recipeId: null,
      primaryMethodId: "retrieval_practice",
      reason: expect.stringMatching(/rollout is disabled/i),
    });
    expect(selectMethodRecipe(eligibleInput({ blurtingEnabled: false }))).toMatchObject({
      kind: "baseline",
      recipeId: null,
      reason: expect.stringMatching(/rollout is disabled/i),
    });
  });

  it("matches only the frozen mode, primary method, task, and stage matrix", () => {
    const learningModes: readonly SessionLearningMode[] = ["learn", "study"];

    for (const learningMode of learningModes) {
      for (const primaryMethodId of CORE_METHOD_IDS) {
        for (const taskType of LEARNING_TASK_TYPES) {
          for (const knowledgeStage of KNOWLEDGE_STAGES) {
            const decision = selectMethodRecipe(eligibleInput({
              learningMode,
              primaryMethodId,
              taskType,
              knowledgeStage,
            }));
            const expected = isEligibleMatrixCell({
              learningMode,
              primaryMethodId,
              taskType,
              knowledgeStage,
            }) ? "recipe" : "baseline";

            expect([
              learningMode,
              primaryMethodId,
              taskType,
              knowledgeStage,
              decision.kind,
            ]).toEqual([
              learningMode,
              primaryMethodId,
              taskType,
              knowledgeStage,
              expected,
            ]);
          }
        }
      }
    }
  });

  it.each([
    [9, "baseline"],
    [10, "recipe"],
    [11, "recipe"],
    [60, "recipe"],
    [61, "baseline"],
  ] as const)("applies the ten-to-sixty-minute boundary at %i minutes", (activeMinutes, expected) => {
    expect(selectMethodRecipe(eligibleInput({ activeMinutes })).kind).toBe(expected);
  });

  it("keeps rollout denial authoritative above the recipe duration boundary", () => {
    expect(selectMethodRecipe(eligibleInput({
      blurtingEnabled: false,
      activeMinutes: 61,
    }))).toMatchObject({
      kind: "baseline",
      recipeId: null,
      reason: expect.stringMatching(/rollout is disabled/i),
    });
  });

  it.each([
    [0, "baseline"],
    [1, "recipe"],
    [3, "recipe"],
    [4, "baseline"],
  ] as const)("applies the one-to-three-target boundary at %i targets", (activeTargetCount, expected) => {
    expect(selectMethodRecipe(eligibleInput({ activeTargetCount })).kind).toBe(expected);
  });

  it.each([
    [{ isReview: true }, /scheduled reviews retain their separate recipe/i],
    [{ comparisonSourceAvailable: false }, /repair requires a comparison source/i],
  ] as const)("retains the baseline outside an ordinary source-backed session", (overrides, reason) => {
    expect(selectMethodRecipe(eligibleInput(overrides))).toMatchObject({
      kind: "baseline",
      recipeId: null,
      reason: expect.stringMatching(reason),
    });
  });

  it("is deterministic, deeply frozen, and does not mutate its input", () => {
    const input = eligibleInput({ activeMinutes: 25, activeTargetCount: 2 });
    const snapshot = structuredClone(input);
    const first = selectMethodRecipe(input);
    const second = selectMethodRecipe(input);
    const baseline = selectMethodRecipe({ ...input, comparisonSourceAvailable: false });

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(first.kind).toBe("recipe");
    if (first.kind === "recipe") {
      expect(Object.isFrozen(first.orderedPhases)).toBe(true);
    }
  });
});

function isEligibleMatrixCell({
  learningMode,
  primaryMethodId,
  taskType,
  knowledgeStage,
}: {
  learningMode: SessionLearningMode;
  primaryMethodId: CoreMethodId;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
}) {
  return learningMode === "study"
    && primaryMethodId === "retrieval_practice"
    && (taskType === "conceptual_learning" || taskType === "reading_to_quiz")
    && (knowledgeStage === "developing" || knowledgeStage === "retrieval_ready");
}

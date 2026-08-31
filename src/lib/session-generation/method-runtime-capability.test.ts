import { describe, expect, it } from "vitest";
import { CORE_METHOD_IDS, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import {
  eligibleMethodIdsFor,
  KNOWLEDGE_STAGES,
} from "@/lib/learning/method-eligibility";
import {
  methodRuntimeCapabilityFor,
  METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
} from "@/lib/session-generation/method-runtime-capability";

describe("method runtime capability", () => {
  it("has a supported, deterministic primary path for every eligible route", () => {
    for (const taskType of LEARNING_TASK_TYPES) {
      for (const knowledgeStage of KNOWLEDGE_STAGES) {
        for (const learningMode of ["learn", "study"] as const) {
          const eligible = eligibleMethodIdsFor({ taskType, knowledgeStage, learningMode });
          for (const methodId of eligible) {
            for (const executionEnvironment of ["inside_yova", "outside_yova"] as const) {
              const input = {
                methodId,
                taskType,
                knowledgeStage,
                learningMode,
                executionEnvironment,
              };
              const first = methodRuntimeCapabilityFor(input);
              const second = methodRuntimeCapabilityFor(input);

              expect(first).toEqual(second);
              expect(first).toMatchObject({
                policyVersion: METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
                status: "supported",
                methodId,
                builtInFallback: "exact_recipe_validation_required",
              });
              expect(first.primaryGenerationPath).not.toBe("none");
              expect(Object.isFrozen(first)).toBe(true);
              expect(Object.isFrozen(first.delivery)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("does not let engineering capability widen pedagogical eligibility", () => {
    const capability = methodRuntimeCapabilityFor({
      methodId: "interleaved_practice",
      taskType: "problem_solving",
      knowledgeStage: "novice",
      learningMode: "learn",
      executionEnvironment: "inside_yova",
    });

    expect(capability).toMatchObject({
      status: "ineligible",
      primaryGenerationPath: "none",
      boundedRecovery: "none",
    });
  });

  it("distinguishes streamed, reliable-eligible, and full generation paths", () => {
    expect(methodRuntimeCapabilityFor({
      methodId: "self_explanation",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      learningMode: "learn",
      executionEnvironment: "inside_yova",
    }).primaryGenerationPath).toBe("streamed");

    expect(methodRuntimeCapabilityFor({
      methodId: "retrieval_practice",
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    }).primaryGenerationPath).toBe("reliable_or_full");

    expect(methodRuntimeCapabilityFor({
      methodId: "practice_problems",
      taskType: "problem_solving",
      knowledgeStage: "novice",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    }).primaryGenerationPath).toBe("reliable_or_full");

    expect(methodRuntimeCapabilityFor({
      methodId: "spaced_retrieval",
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    }).primaryGenerationPath).toBe("full");

    expect(methodRuntimeCapabilityFor({
      methodId: "self_explanation",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      learningMode: "learn",
      executionEnvironment: "outside_yova",
    }).primaryGenerationPath).toBe("full");
  });

  it("separates dedicated interaction runtimes from validated generic phases", () => {
    const dedicated = [
      "retrieval_practice",
      "spaced_retrieval",
      "worked_example_fading",
      "practice_test_error_repair",
    ] as const;
    for (const methodId of dedicated) {
      const taskType = methodId === "worked_example_fading"
        ? "problem_solving" as const
        : "memorization" as const;
      const knowledgeStage = methodId === "practice_test_error_repair"
        ? "retrieval_ready" as const
        : methodId === "worked_example_fading"
          ? "novice" as const
          : "developing" as const;
      const learningMode = methodId === "worked_example_fading" ? "learn" as const : "study" as const;
      expect(methodRuntimeCapabilityFor({
        methodId,
        taskType,
        knowledgeStage,
        learningMode,
        executionEnvironment: "inside_yova",
      }).delivery.kind).toBe("dedicated_runtime");
    }

    expect(methodRuntimeCapabilityFor({
      methodId: "retrieval_based_outlining",
      taskType: "writing_argumentation",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    }).delivery).toEqual({
      kind: "validated_phase_contract",
      runtimeKind: null,
    });
  });

  it("marks bounded recovery as conditional and never promises a built-in substitute", () => {
    const boundedStudy = methodRuntimeCapabilityFor({
      methodId: "spaced_retrieval",
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    });
    const fullOnly = methodRuntimeCapabilityFor({
      methodId: "interleaved_practice",
      taskType: "problem_solving",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "inside_yova",
    });
    const outsideStudy = methodRuntimeCapabilityFor({
      methodId: "spaced_retrieval",
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      executionEnvironment: "outside_yova",
    });

    expect(boundedStudy.boundedRecovery).toBe("candidate");
    expect(fullOnly.boundedRecovery).toBe("none");
    expect(outsideStudy.boundedRecovery).toBe("none");
    expect(CORE_METHOD_IDS).toHaveLength(12);
  });
});

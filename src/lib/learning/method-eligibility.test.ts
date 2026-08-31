import { describe, expect, it } from "vitest";
import { CORE_METHOD_CATALOG, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import {
  eligibleMethodIdsFor,
  isMethodEligibleFor,
  KNOWLEDGE_STAGES,
  METHOD_ELIGIBILITY_POLICY_VERSION,
  methodFitsSessionMode,
} from "@/lib/learning/method-eligibility";

describe("canonical method eligibility", () => {
  it("returns a non-empty deterministic valid set for every task, stage, and mode", () => {
    for (const taskType of LEARNING_TASK_TYPES) {
      for (const knowledgeStage of KNOWLEDGE_STAGES) {
        for (const learningMode of ["learn", "study"] as const) {
          const first = eligibleMethodIdsFor({ taskType, knowledgeStage, learningMode });
          const second = eligibleMethodIdsFor({ taskType, knowledgeStage, learningMode });

          expect(first.length, `${taskType}/${knowledgeStage}/${learningMode}`).toBeGreaterThan(0);
          expect(first).toEqual(second);
          expect(new Set(first).size).toBe(first.length);
          expect(first.every((methodId) => (
            CORE_METHOD_CATALOG[methodId].taskTypes.includes(taskType)
            && methodFitsSessionMode(methodId, taskType, learningMode)
          ))).toBe(true);
        }
      }
    }
  });

  it("does not let broad task validity bypass the knowledge-stage boundary", () => {
    expect(CORE_METHOD_CATALOG.interleaved_practice.taskTypes).toContain("problem_solving");
    expect(isMethodEligibleFor({
      methodId: "interleaved_practice",
      taskType: "problem_solving",
      knowledgeStage: "novice",
      learningMode: "study",
    })).toBe(false);
    expect(eligibleMethodIdsFor({
      taskType: "problem_solving",
      knowledgeStage: "novice",
      learningMode: "study",
    })).toEqual(["worked_example_fading", "self_explanation"]);
  });

  it("keeps first instruction on teaching-capable methods", () => {
    expect(eligibleMethodIdsFor({
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      learningMode: "learn",
    })).toEqual(["self_explanation", "concept_mapping", "pretesting", "read_recall_review"]);
    expect(eligibleMethodIdsFor({
      taskType: "memorization",
      knowledgeStage: "novice",
      learningMode: "learn",
    })).toEqual(["retrieval_practice"]);
    expect(eligibleMethodIdsFor({
      taskType: "problem_solving",
      knowledgeStage: "retrieval_ready",
      learningMode: "learn",
    })).toEqual(["worked_example_fading", "pretesting", "self_explanation"]);
  });

  it("keeps new recipes inside their honest Learn or Practice boundary", () => {
    expect(methodFitsSessionMode("pretesting", "conceptual_learning", "learn")).toBe(true);
    expect(methodFitsSessionMode("pretesting", "conceptual_learning", "study")).toBe(false);
    expect(methodFitsSessionMode("practice_problems", "problem_solving", "study")).toBe(true);
    expect(methodFitsSessionMode("practice_problems", "problem_solving", "learn")).toBe(false);
  });

  it("exposes a stable version for route provenance", () => {
    expect(METHOD_ELIGIBILITY_POLICY_VERSION).toBe("method_eligibility_v2");
  });
});

import { describe, expect, it } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { isSamePersistedPlan } from "@/lib/plan-generation/persisted-plan";

const plan = {
  id: "7e9ebf11-61b6-40cf-8519-b0870288d115",
  learningItemId: "9e528f4c-c207-41a4-824b-e9d34a042f62",
  status: "active",
} as LearningPlan;

describe("persisted plan identity", () => {
  it("recognizes a retry of the same activated plan", () => {
    expect(isSamePersistedPlan({
      id: plan.id,
      learning_item_id: plan.learningItemId,
      status: "active",
    }, plan)).toBe(true);
  });

  it("does not mistake another plan or lifecycle state for a completed retry", () => {
    expect(isSamePersistedPlan({
      id: plan.id,
      learning_item_id: "2ccf4102-6fe2-4545-a225-2f67b22ec3b9",
      status: "active",
    }, plan)).toBe(false);
    expect(isSamePersistedPlan({
      id: plan.id,
      learning_item_id: plan.learningItemId,
      status: "draft",
    }, plan)).toBe(false);
    expect(isSamePersistedPlan(null, plan)).toBe(false);
  });
});

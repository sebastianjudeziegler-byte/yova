import { describe, expect, it } from "vitest";
import {
  PLAN_SCHEDULE_CAPACITY_GUIDANCE,
  planScheduleCapacityGuidance,
} from "@/lib/plan-generation/capacity-guidance";
import { PlanScheduleCapacityError } from "@/lib/plan-generation/schedule-plan";

describe("plan schedule capacity guidance", () => {
  it("classifies the deterministic fallback error and gives actionable recovery", () => {
    expect(planScheduleCapacityGuidance(new PlanScheduleCapacityError()))
      .toBe(PLAN_SCHEDULE_CAPACITY_GUIDANCE);
    expect(PLAN_SCHEDULE_CAPACITY_GUIDANCE).toMatch(/another study day/i);
    expect(PLAN_SCHEDULE_CAPACITY_GUIDANCE).toMatch(/longer sessions/i);
    expect(PLAN_SCHEDULE_CAPACITY_GUIDANCE).toMatch(/target date later/i);
  });

  it("classifies the API envelope without trusting server copy", () => {
    expect(planScheduleCapacityGuidance({
      code: "schedule_capacity",
      error: "Untrusted or outdated server wording",
    })).toBe(PLAN_SCHEDULE_CAPACITY_GUIDANCE);
  });

  it("leaves unrelated generation failures on the generic recovery path", () => {
    expect(planScheduleCapacityGuidance(new Error("provider unavailable"))).toBeNull();
    expect(planScheduleCapacityGuidance({ code: "goal_needs_detail" })).toBeNull();
  });
});

import { PlanScheduleCapacityError } from "@/lib/plan-generation/schedule-plan";

export const PLAN_SCHEDULE_CAPACITY_CODE = "schedule_capacity";

export const PLAN_SCHEDULE_CAPACITY_GUIDANCE =
  "Add another study day, choose longer sessions, or move the target date later. Then continue and generate the plan again.";

/**
 * Capacity is an expected scheduling outcome, whether it comes from the API or
 * from the deterministic browser fallback. Keep one classifier for both paths
 * so an unavailable provider cannot turn a useful scheduling prompt into an
 * uncaught client exception.
 */
export function planScheduleCapacityGuidance(value: unknown) {
  if (value instanceof PlanScheduleCapacityError) {
    return PLAN_SCHEDULE_CAPACITY_GUIDANCE;
  }
  if (value instanceof Error && value.name === "PlanScheduleCapacityError") {
    return PLAN_SCHEDULE_CAPACITY_GUIDANCE;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, unknown>).code === PLAN_SCHEDULE_CAPACITY_CODE
    ? PLAN_SCHEDULE_CAPACITY_GUIDANCE
    : null;
}

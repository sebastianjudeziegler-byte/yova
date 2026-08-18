import type { DeadlineMilestone } from "@/lib/domain";

type PlanWithStatus = { status: unknown };
type PlanWithLearningItem = { learningItemId: string; status: unknown };
type MilestoneWithPlanLink = Pick<DeadlineMilestone, "linkedLearningItemId">;
type TutorThreadWithPlanLink = { learningItemId: string | null };

/** Plans that may drive current-work surfaces such as Home and Agenda. */
export function isOperationalPlanStatus(status: unknown): status is "active" {
  return status === "active";
}

/** Plans whose learning context remains available to the tutor and archive-like surfaces. */
export function isAvailablePlanStatus(status: unknown): status is "active" | "completed" {
  return status === "active" || status === "completed";
}

export function filterOperationalPlans<T extends PlanWithStatus>(plans: readonly T[]): T[] {
  return plans.filter((plan) => isOperationalPlanStatus(plan.status));
}

export function filterAvailablePlans<T extends PlanWithStatus>(plans: readonly T[]): T[] {
  return plans.filter((plan) => isAvailablePlanStatus(plan.status));
}

export function availableLearningItemIds(plans: readonly PlanWithLearningItem[]) {
  return new Set(
    filterAvailablePlans(plans).map((plan) => plan.learningItemId),
  );
}

/**
 * Standalone deadlines stay visible. A plan-linked milestone is current work only
 * while its linked plan is operational; missing/deleted links fail closed.
 */
export function filterAgendaMilestones<T extends MilestoneWithPlanLink>(
  milestones: readonly T[],
  plans: readonly PlanWithLearningItem[],
): T[] {
  const operationalLearningItemIds = new Set(
    filterOperationalPlans(plans).map((plan) => plan.learningItemId),
  );

  return milestones.filter((milestone) => (
    milestone.linkedLearningItemId === null
    || operationalLearningItemIds.has(milestone.linkedLearningItemId)
  ));
}

/** General tutor threads survive; plan-linked threads require available context. */
export function filterTutorThreads<T extends TutorThreadWithPlanLink>(
  threads: readonly T[],
  availableItemIds: ReadonlySet<string>,
): T[] {
  return threads.filter((thread) => (
    thread.learningItemId === null
    || availableItemIds.has(thread.learningItemId)
  ));
}

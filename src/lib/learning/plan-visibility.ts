import type { DeadlineMilestone } from "@/lib/domain";

type PlanWithStatus = { status: unknown };
type PlanWithLearningItem = { learningItemId: string; status: unknown };
type PlanWithSessions = {
  status: unknown;
  sessions: readonly { status: unknown }[];
};
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

/**
 * Legacy rows can contain a completed plan with runnable sessions after an old
 * split/start race. Keep the persisted lifecycle value intact, but do not
 * present that row as proof that the unfinished sessions were completed.
 */
export function canPresentPlanAsCompleted(plan: PlanWithSessions) {
  return plan.status === "completed"
    && !plan.sessions.some((session) => session.status === "ready" || session.status === "upcoming");
}

/**
 * Current work includes active plans plus a narrow legacy-recovery case: old
 * clients could persist a completed lifecycle value while runnable sessions
 * remained. Treat only that contradictory completed row as operational so the
 * learner can finish it; genuinely completed and archived plans stay closed.
 */
export function isOperationalPlan(plan: PlanWithSessions) {
  return isOperationalPlanStatus(plan.status)
    || (plan.status === "completed" && !canPresentPlanAsCompleted(plan));
}

export function filterOperationalPlans<T extends PlanWithSessions>(plans: readonly T[]): T[] {
  return plans.filter(isOperationalPlan);
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
  plans: readonly (PlanWithLearningItem & PlanWithSessions)[],
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

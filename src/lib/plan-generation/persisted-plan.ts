import type { LearningPlan } from "@/lib/domain";

export type PersistedPlanIdentity = {
  id: string;
  learning_item_id: string;
  status: string;
};

export function isSamePersistedPlan(
  existing: PersistedPlanIdentity | null,
  plan: LearningPlan,
) {
  return existing?.id === plan.id
    && existing.learning_item_id === plan.learningItemId
    && existing.status === plan.status;
}

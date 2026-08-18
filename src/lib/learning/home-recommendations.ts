import type { LearningPlan } from "@/lib/domain";
import { filterOperationalPlans } from "@/lib/learning/plan-visibility";

const URGENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1_000;

export function rankPlansForHome(plans: LearningPlan[], now = new Date()) {
  const nowMs = now.getTime();
  return filterOperationalPlans(plans)
    .flatMap((plan) => {
      const session = plan.sessions.find((item) => item.status === "ready");
      return session ? [{ plan, session }] : [];
    })
    .sort((left, right) => {
      const leftScheduled = timestamp(left.session.scheduledFor);
      const rightScheduled = timestamp(right.session.scheduledFor);
      const leftOverdue = leftScheduled <= nowMs;
      const rightOverdue = rightScheduled <= nowMs;
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

      const leftDeadline = left.plan.deadline ? timestamp(left.plan.deadline) : Number.POSITIVE_INFINITY;
      const rightDeadline = right.plan.deadline ? timestamp(right.plan.deadline) : Number.POSITIVE_INFINITY;
      const leftUrgent = leftDeadline - nowMs <= URGENT_WINDOW_MS;
      const rightUrgent = rightDeadline - nowMs <= URGENT_WINDOW_MS;
      if (leftUrgent !== rightUrgent) return leftUrgent ? -1 : 1;
      if (leftUrgent && leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      if (leftScheduled !== rightScheduled) return leftScheduled - rightScheduled;
      return left.plan.createdAt.localeCompare(right.plan.createdAt);
    })
    .map(({ plan }) => plan);
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

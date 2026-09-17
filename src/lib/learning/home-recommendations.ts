import { onboardingAnswerId, type OnboardingAnswers } from "@/lib/onboarding/answers";
import type { LearningPlan } from "@/lib/domain";
import { filterOperationalPlans } from "@/lib/learning/plan-visibility";

export function rankPlansForHome(plans: LearningPlan[], now = new Date(), answers?: OnboardingAnswers) {
  const nowMs = now.getTime();
  return filterOperationalPlans(plans)
    .flatMap((plan) => {
      const session = plan.sessions.find((item) => item.status === "ready");
      return session ? [{ plan, session }] : [];
    })
    .sort((left, right) => {
      const leftScheduled = timestamp(left.session.scheduledFor);
      const rightScheduled = timestamp(right.session.scheduledFor);
      const leftOverdue = left.session.learningMode === "study" && left.session.workload?.suggestedDate !== false && leftScheduled <= nowMs;
      const rightOverdue = right.session.learningMode === "study" && right.session.workload?.suggestedDate !== false && rightScheduled <= nowMs;
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

      const leftDeadline = left.plan.deadline ? timestamp(left.plan.deadline) : Number.POSITIVE_INFINITY;
      const rightDeadline = right.plan.deadline ? timestamp(right.plan.deadline) : Number.POSITIVE_INFINITY;
      if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
      const peak=answers ? onboardingAnswerId(answers,"energy_window") : null;
      if(peak && peak!=="varies") {
        const score=({plan,session}:typeof left)=>{
          const zone=plan.schedulePreferences?.timeZone ?? "UTC";
          const day=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
          if(day(new Date(session.scheduledFor))!==day(now))return 0;
          const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",hourCycle:"h23"}).format(now));
          const current=hour<12?"morning":hour<17?"afternoon":hour<22?"evening":"late_night";
          return (current===peak)===(session.learningMode==="learn") ? 1 : 0;
        };
        const difference=score(right)-score(left);if(difference)return difference;
      }
      if (leftScheduled !== rightScheduled) return leftScheduled - rightScheduled;
      return left.plan.createdAt.localeCompare(right.plan.createdAt);
    })
    .map(({ plan }) => plan);
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

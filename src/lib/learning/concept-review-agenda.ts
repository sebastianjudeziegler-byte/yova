import {
  makeUuid,
  type LearningPlan,
  type LearningPlanSession,
  type SessionCompletion,
} from "@/lib/domain";
import { summarizeConceptEvidence } from "@/lib/learning/concept-evidence";
import {
  buildConceptReviewSchedule,
  type ConceptReviewDirective,
} from "@/lib/learning/concept-review-scheduler";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";

export type ConceptReviewAgendaItem = ConceptReviewDirective & {
  planId: string;
  planTitle: string;
  planStatus: LearningPlan["status"];
  action: "start_next_session" | "activate_review" | "scheduled";
};

export function buildConceptReviewAgenda(
  plans: LearningPlan[],
  completions: SessionCompletion[],
  now: Date = new Date(),
): ConceptReviewAgendaItem[] {
  return plans
    .filter((plan) => plan.status === "active" || plan.status === "completed")
    .flatMap((plan) => {
      const signals = summarizeConceptEvidence(
        completions.filter((completion) => completion.planId === plan.id),
      );
      return buildConceptReviewSchedule(signals, now).map((directive) => ({
        ...directive,
        planId: plan.id,
        planTitle: plan.title,
        planStatus: plan.status,
        action: directive.timing === "upcoming"
          ? "scheduled" as const
          : plan.status === "completed"
            ? "activate_review" as const
            : "start_next_session" as const,
      }));
    })
    .sort((left, right) => {
      const timing = { due: 0, upcoming: 1 };
      const priority = { high: 0, medium: 1, low: 2 };
      return timing[left.timing] - timing[right.timing]
        || priority[left.priority] - priority[right.priority]
        || left.dueAt.localeCompare(right.dueAt);
    });
}

export function buildConceptReviewSession(
  plan: LearningPlan,
  directive: ConceptReviewDirective,
  now: Date = new Date(),
): LearningPlanSession {
  const sequence = Math.max(0, ...plan.sessions.map((session) => session.sequence)) + 1;
  const estimatedMinutes = directive.reviewType === "repair_and_retrieve" ? 10 : 5;
  const method = directive.reviewType === "repair_and_retrieve"
    ? "Spaced retrieval and error repair"
    : directive.reviewType === "maintenance_transfer"
      ? "Brief transfer check"
      : "Independent retrieval verification";
  const explanation = `${directive.reason} YOVA reopened this goal for one bounded ${estimatedMinutes}-minute check.`;

  return {
    id: makeUuid(),
    sequence,
    title: directive.reviewType === "repair_and_retrieve"
      ? `Retrieve and repair ${directive.concept}`
      : directive.reviewType === "maintenance_transfer"
        ? `Transfer ${directive.concept}`
        : `Verify ${directive.concept}`,
    objective: directive.instruction,
    method,
    methodReason: explanation,
    scheduledFor: now.toISOString(),
    estimatedMinutes,
    amountLabel: `${directive.timingLabel} · about ${estimatedMinutes} min`,
    learningMode: "study",
    status: "ready",
    adaptationNote: createSessionAdaptationNote(explanation, now.toISOString()),
    reviewConcept: directive.concept,
    reviewType: directive.reviewType,
  };
}

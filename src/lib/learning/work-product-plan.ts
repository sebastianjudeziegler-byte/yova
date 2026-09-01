import { isWorkProductGoal } from "@/lib/learning/learning-intent";

export const WORK_PRODUCT_KINDS = [
  "writing",
  "speech",
  "presentation",
] as const;

export type WorkProductKind = (typeof WORK_PRODUCT_KINDS)[number];

export type WorkProductPlanCopy = {
  kind: WorkProductKind;
  sessionModeLabel: string;
  startingApproach: string;
  confirmationApproach: string;
  loadingDescription: string;
  loadingStep: string;
  topicMapState: string;
  topicMapContract: string;
  sessionLoadContract: string;
};

const COPY: Record<WorkProductKind, WorkProductPlanCopy> = {
  writing: {
    kind: "writing",
    sessionModeLabel: "DRAFT AND REFINE",
    startingApproach: "Draft the work, match it to the requirements, and revise it",
    confirmationApproach: "Draft and refine the required work in a clear sequence.",
    loadingDescription: "Sequencing the draft, evidence, and revision work.",
    loadingStep: "Sequencing drafting and revision",
    topicMapState: "Draft and review",
    topicMapContract: "Every included part must be drafted or reviewed, and anything left out is shown plainly.",
    sessionLoadContract: "Each target needs a concrete drafting, evidence, or revision action before it counts as covered.",
  },
  speech: {
    kind: "speech",
    sessionModeLabel: "REHEARSE AND REFINE",
    startingApproach: "Build the speech, rehearse it, and refine the delivery",
    confirmationApproach: "Build, rehearse, and refine the speech in a clear sequence.",
    loadingDescription: "Sequencing the outline, rehearsal, and delivery work.",
    loadingStep: "Sequencing rehearsal and refinement",
    topicMapState: "Build and rehearse",
    topicMapContract: "Every included part must be built or rehearsed, and anything left out is shown plainly.",
    sessionLoadContract: "Each target needs a concrete outlining, rehearsal, or delivery action before it counts as covered.",
  },
  presentation: {
    kind: "presentation",
    sessionModeLabel: "BUILD AND REHEARSE",
    startingApproach: "Build the presentation, rehearse it, and refine the delivery",
    confirmationApproach: "Build, rehearse, and refine the presentation in a clear sequence.",
    loadingDescription: "Sequencing the content, slides, rehearsal, and revision work.",
    loadingStep: "Sequencing building and rehearsal",
    topicMapState: "Build and rehearse",
    topicMapContract: "Every included part must be built or rehearsed, and anything left out is shown plainly.",
    sessionLoadContract: "Each target needs a concrete building, rehearsal, or revision action before it counts as covered.",
  },
};

/**
 * Classifies only the work-product families whose learner-facing plan flow is
 * intentionally artifact-led. The broader work-product detector also knows
 * about projects and portfolios, but those keep the ordinary placement flow
 * until their completion contract has an equally specific presentation.
 */
export function workProductKindForPlan(value: string): WorkProductKind | null {
  if (!isWorkProductGoal(value)) return null;
  if (/\b(?:speech|talk|debate)\b/i.test(value)) return "speech";
  if (/\b(?:presentation|slide deck|slides|speaker notes)\b/i.test(value)) return "presentation";
  if (/\b(?:essay|paper|report|written response|script)\b/i.test(value)) return "writing";
  return null;
}

export function workProductPlanCopy(value: string): WorkProductPlanCopy | null {
  const kind = workProductKindForPlan(value);
  return kind ? COPY[kind] : null;
}

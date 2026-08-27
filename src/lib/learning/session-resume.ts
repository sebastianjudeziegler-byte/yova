import { z } from "zod";
import type {
  SessionAdjustmentSnapshot,
  SessionEvidenceSnapshot,
  SessionInterruption,
  SessionPendingRepair,
} from "@/lib/domain";
import { ConceptEvidenceListSchema } from "@/lib/learning/concept-evidence";
import { ConfidenceEvidenceListSchema } from "@/lib/learning/confidence-calibration";
import {
  sessionActivityProgressHasRequiredRouteIdentity,
  readSessionActivityProgress,
  sessionActivityProgressIsResumable,
} from "@/lib/learning/session-activity-progress";
import type { GuidedSessionStep } from "@/lib/learning/session-evidence";
import { RuntimeRepairSupportSchema } from "@/lib/session-repair/schema";

export const SessionEvidenceSnapshotSchema = z.object({
  correctAnswers: z.number().int().min(0).max(24),
  totalAnswers: z.number().int().min(0).max(24),
  conceptEvidence: ConceptEvidenceListSchema,
  confidenceEvidence: ConfidenceEvidenceListSchema,
  observedGap: z.string().trim().min(1).max(1_000),
  completedImmediateRepairs: z.number().int().min(0).max(4),
}).refine((snapshot) => snapshot.correctAnswers <= snapshot.totalAnswers);

export const SessionPendingRepairSchema = z.object({
  concept: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(180),
  body: z.string().trim().min(10).max(700),
  correctAnswer: z.string().trim().min(1).max(700),
  feedback: z.string().trim().min(1).max(900).nullable(),
  repairSupport: RuntimeRepairSupportSchema.optional(),
});

export const SessionAdjustmentSnapshotSchema: z.ZodType<SessionAdjustmentSnapshot> = z.object({
  familiarity: z.enum(["as_planned", "already_know", "need_teaching", "challenge_me"]),
  availableMinutes: z.number().int().min(10).max(90).nullable(),
  knownTargets: z.array(z.string().trim().min(2).max(180)).max(4),
  note: z.string().trim().max(500),
}).strict();

export function resumableSessionProgress(
  planSessionId: string,
  interruptions: SessionInterruption[],
) {
  return interruptions
    .filter((interruption) => {
      const activityProgress = readSessionActivityProgress(interruption.activityProgress);
      return interruption.planSessionId === planSessionId
        && sessionActivityProgressHasRequiredRouteIdentity(
          activityProgress,
          interruption.routeRevisionId,
        )
        && (
          interruption.completedSteps >= 1
          || (
            interruption.completedSteps === 0
            && sessionActivityProgressIsResumable(activityProgress)
          )
        )
        && interruption.completedSteps < interruption.totalSteps;
    })
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt))[0] ?? null;
}

export function readSessionEvidenceSnapshot(value: unknown): SessionEvidenceSnapshot | undefined {
  const parsed = SessionEvidenceSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readSessionPendingRepair(value: unknown): SessionPendingRepair | undefined {
  const parsed = SessionPendingRepairSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readSessionAdjustmentSnapshot(value: unknown): SessionAdjustmentSnapshot | undefined {
  const parsed = SessionAdjustmentSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function resumedSessionAdjustment({
  interruption,
  plannedSessionMinutes,
  inMemoryAdjustment,
}: {
  interruption: SessionInterruption;
  plannedSessionMinutes: number;
  inMemoryAdjustment?: SessionAdjustmentSnapshot | null;
}): SessionAdjustmentSnapshot | null {
  if (interruption.sessionAdjustment) return interruption.sessionAdjustment;
  if (inMemoryAdjustment !== undefined) return inMemoryAdjustment;
  if (
    interruption.plannedMinutes !== plannedSessionMinutes
    && interruption.plannedMinutes >= 10
    && interruption.plannedMinutes <= 90
  ) {
    return {
      familiarity: "as_planned",
      availableMinutes: interruption.plannedMinutes,
      knownTargets: [],
      note: "",
    };
  }
  return null;
}

export function restoreInterruptedLesson(
  steps: GuidedSessionStep[],
  interruption: SessionInterruption | null,
) {
  if (!interruption) return { steps, step: 0 };

  const pendingRepair = interruption.pendingRepair;
  const resumeStep = Math.min(
    interruption.resumeStep ?? interruption.completedSteps,
    pendingRepair ? steps.length : Math.max(0, steps.length - 1),
  );
  if (!pendingRepair) return { steps, step: resumeStep };

  const repairStep: GuidedSessionStep = {
    methodPhase: "repair",
    estimatedMinutes: 2,
    requiredForCompletion: true,
    type: "free_response",
    concept: pendingRepair.concept,
    label: "REPAIR CHECK",
    title: pendingRepair.title,
    body: pendingRepair.body,
    question: null,
    correctAnswer: pendingRepair.correctAnswer,
    feedback: pendingRepair.feedback,
    evidenceRole: "immediate_repair",
    ...(pendingRepair.repairSupport ? { repairSupport: pendingRepair.repairSupport } : {}),
  };

  return {
    steps: [...steps.slice(0, resumeStep), repairStep, ...steps.slice(resumeStep)],
    step: resumeStep,
  };
}

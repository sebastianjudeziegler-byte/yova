import { z } from "zod";
import { ConceptEvidenceListSchema } from "@/lib/learning/concept-evidence";
import { ConfidenceEvidenceListSchema } from "@/lib/learning/confidence-calibration";
import { normalizeSessionCompletionProvenance } from "@/lib/learning/session-completion-provenance";
import { SessionActivityProgressSchema } from "@/lib/learning/session-activity-progress";
import {
  SessionAdjustmentSnapshotSchema,
  SessionEvidenceSnapshotSchema,
  SessionPendingRepairSchema,
} from "@/lib/learning/session-resume";
import { DeadlineMilestoneSchema } from "@/lib/milestones/schema";
import { LearningPlanSchema } from "@/lib/plan-generation/schema";

export const ACCOUNT_EXPORT_BUCKET = "account-exports";
export const ACCOUNT_EXPORT_DEVICE_MAX_BYTES = 2 * 1024 * 1024;
export const ACCOUNT_EXPORT_FINAL_MAX_BYTES = 25 * 1024 * 1024;
export const ACCOUNT_EXPORT_MAX_LOGICAL_RECORDS = 25_000;
export const ACCOUNT_EXPORT_DOWNLOAD_TTL_SECONDS = 5 * 60;
export const ACCOUNT_EXPORT_HEADER = "X-Yova-Data-Export";
export const ACCOUNT_EXPORT_HEADER_VALUE = "account-data";

const PreviewAccountExportSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().max(80),
  createdAt: z.string().datetime({ offset: true }),
  identityMode: z.enum(["preview", "supabase"]).optional(),
  emailVerified: z.boolean().optional(),
});

const SessionCompletionExportSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(1).max(360),
  correctAnswers: z.number().int().min(0),
  totalAnswers: z.number().int().min(0),
  feedback: z.enum(["too_easy", "about_right", "too_difficult"]),
  observedGap: z.string().min(1).max(2_000),
  completionMode: z.enum(["guided", "unguided_practice"]).default("guided"),
  conceptEvidence: ConceptEvidenceListSchema.default([]),
  confidenceEvidence: ConfidenceEvidenceListSchema.default([]),
}).transform(normalizeSessionCompletionProvenance);

const SessionInterruptionExportSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  interruptedAt: z.string().datetime({ offset: true }),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(1).max(360),
  completedSteps: z.number().int().min(0).max(24),
  totalSteps: z.number().int().min(1).max(24),
  resumeStep: z.number().int().min(0).max(24).optional(),
  evidence: SessionEvidenceSnapshotSchema.optional(),
  pendingRepair: SessionPendingRepairSchema.optional(),
  sessionAdjustment: SessionAdjustmentSnapshotSchema.optional(),
  activityProgress: SessionActivityProgressSchema.optional(),
});

const PendingSessionCompletionExportSchema = z.object({
  userId: z.string().uuid(),
  completion: SessionCompletionExportSchema,
  adaptation: z.object({
    planSessionId: z.string().uuid(),
    title: z.string().min(1).max(180),
    objective: z.string().min(1).max(900),
    method: z.string().min(1).max(180),
    methodReason: z.string().min(1).max(900),
    estimatedMinutes: z.number().int().min(5).max(180),
    amountLabel: z.string().min(1).max(180),
    learningMode: z.enum(["learn", "study"]),
    explanation: z.string().min(1).max(900),
  }).nullable(),
  followUpSession: z.object({
    id: z.string().uuid(),
    sequence: z.number().int().positive(),
    title: z.string().min(1).max(180),
    objective: z.string().min(1).max(900),
    method: z.string().min(1).max(180),
    methodReason: z.string().min(1).max(900),
    scheduledFor: z.string().datetime({ offset: true }),
    estimatedMinutes: z.number().int().min(5).max(180),
    amountLabel: z.string().min(1).max(180),
    learningMode: z.enum(["learn", "study"]),
    topicIds: z.array(z.string().uuid()).max(6).default([]),
    contentTargets: z.array(z.string().min(1).max(180)).max(6).default([]),
    completionEvidence: z.array(z.string().min(1).max(220)).max(4).default([]),
    reviewConcept: z.string().min(2).max(120).optional(),
    reviewType: z.enum(["repair_and_retrieve", "verify", "maintenance_transfer"]).optional(),
    status: z.enum(["ready", "upcoming"]),
    adaptationNote: z.object({
      explanation: z.string().min(1).max(900),
      adaptedAt: z.string().datetime({ offset: true }),
    }).optional(),
  }).nullable(),
  continuationSession: z.object({
    id: z.string().uuid(),
    sequence: z.number().int().positive(),
    title: z.string().min(1).max(180),
    objective: z.string().min(1).max(900),
    method: z.string().min(1).max(180),
    methodReason: z.string().min(1).max(900),
    scheduledFor: z.string().datetime({ offset: true }),
    estimatedMinutes: z.number().int().min(5).max(180),
    amountLabel: z.string().min(1).max(180),
    learningMode: z.enum(["learn", "study"]),
    topicIds: z.array(z.string().uuid()).min(1).max(6),
    contentTargets: z.array(z.string().min(5).max(180)).min(1).max(4),
    completionEvidence: z.array(z.string().min(8).max(220)).min(1).max(4),
    status: z.literal("ready"),
  }).nullable().default(null),
  queuedAt: z.string().datetime({ offset: true }),
});

const PendingSessionInterruptionExportSchema = z.object({
  userId: z.string().uuid(),
  interruption: SessionInterruptionExportSchema,
  queuedAt: z.string().datetime({ offset: true }),
});

const ActiveSessionCheckpointExportSchema = z.object({
  version: z.literal(1),
  accountId: z.string().uuid(),
  runId: z.string().uuid(),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  status: z.enum(["working", "awaiting_finish"]),
  startedAt: z.string().datetime({ offset: true }),
  savedAt: z.string().datetime({ offset: true }),
  activeSeconds: z.number().int().min(0).max(21_600),
  plannedMinutes: z.number().int().min(5).max(180),
  completedSteps: z.number().int().min(0).max(24),
  totalSteps: z.number().int().min(1).max(24),
  resumeStep: z.number().int().min(0).max(24),
  resourceFingerprint: z.string().regex(/^sr1:[0-9a-f]{16}$/),
  resourceGeneratedAt: z.string().datetime({ offset: true }).optional(),
  completionMode: z.enum(["guided", "unguided_practice"]).optional(),
  evidence: SessionEvidenceSnapshotSchema.optional(),
  pendingRepair: z.object({
    concept: z.string().trim().min(2).max(120),
    correctAnswer: z.string().trim().min(1).max(700),
  }).strict().optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
  completionFeedback: z.enum(["too_easy", "about_right", "too_difficult"]).optional(),
  sessionAdjustment: SessionAdjustmentSnapshotSchema.optional(),
  activityProgress: SessionActivityProgressSchema.optional(),
}).strict();

const PreviewSnapshotExportSchema = z.object({
  version: z.literal(1),
  account: PreviewAccountExportSchema,
  signedIn: z.boolean(),
  onboardingAnswers: z.array(z.string().max(4_000)).max(40),
  onboardingCompleted: z.boolean(),
  alphaEntered: z.boolean(),
  plans: z.array(LearningPlanSchema).max(100),
  deadlineMilestones: z.array(DeadlineMilestoneSchema).max(1_000).default([]),
  sessionCompletions: z.array(SessionCompletionExportSchema).max(10_000),
  sessionInterruptions: z.array(SessionInterruptionExportSchema).max(10_000),
  updatedAt: z.string().datetime({ offset: true }),
});

export const DeviceExportAddendumSchema = z.object({
  schemaVersion: z.literal(1),
  accountId: z.string().uuid(),
  capturedAt: z.string().datetime({ offset: true }),
  previewSnapshot: PreviewSnapshotExportSchema.nullable(),
  pendingSessionCompletions: z.array(PendingSessionCompletionExportSchema).max(25),
  pendingSessionInterruptions: z.array(PendingSessionInterruptionExportSchema).max(25),
  activeSessionCheckpoints: z.array(ActiveSessionCheckpointExportSchema).max(12),
}).strict().superRefine((addendum, context) => {
  if (addendum.previewSnapshot && addendum.previewSnapshot.account.id !== addendum.accountId) {
    context.addIssue({
      code: "custom",
      message: "The browser snapshot belongs to a different account.",
      path: ["previewSnapshot", "account", "id"],
    });
  }

  for (const [key, entries] of [
    ["pendingSessionCompletions", addendum.pendingSessionCompletions],
    ["pendingSessionInterruptions", addendum.pendingSessionInterruptions],
  ] as const) {
    entries.forEach((entry, index) => {
      if (entry.userId !== addendum.accountId) {
        context.addIssue({
          code: "custom",
          message: "The browser record belongs to a different account.",
          path: [key, index, "userId"],
        });
      }
    });
  }
  addendum.activeSessionCheckpoints.forEach((checkpoint, index) => {
    if (checkpoint.accountId !== addendum.accountId) {
      context.addIssue({
        code: "custom",
        message: "The browser record belongs to a different account.",
        path: ["activeSessionCheckpoints", index, "accountId"],
      });
    }
  });
});

export type DeviceExportAddendum = z.infer<typeof DeviceExportAddendumSchema>;

export const BeginAccountExportRpcSchema = z.object({
  exportId: z.string().uuid(),
  finalizeGrant: z.string().min(32).max(256),
  tempStoragePath: z.string().min(1).max(500),
  prepareExpiresAt: z.string().datetime({ offset: true }),
}).strict();

export const AccountExportStartResponseSchema = z.object({
  status: z.literal("ready_to_finalize"),
  exportId: z.string().uuid(),
  finalizeGrant: z.string().min(32).max(256),
  prepareExpiresAt: z.string().datetime({ offset: true }),
}).strict();

export const AccountExportStartRequestSchema = z.object({
  deviceState: DeviceExportAddendumSchema,
}).strict();

export const AccountExportFinalizeRequestSchema = z.object({
  exportId: z.string().uuid(),
  finalizeGrant: z.string().min(32).max(256),
}).strict();

export const AccountExportRevokeRequestSchema = z.object({
  exportId: z.string().uuid(),
}).strict();

export const AccountExportReadySchema = z.object({
  downloadUrl: z.string().url(),
  filename: z.string().regex(/^yova-data-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export type AccountDataExportReady = z.infer<typeof AccountExportReadySchema>;

export const AccountExportErrorResponseSchema = z.object({
  error: z.string().min(1).max(300),
  code: z.enum(["reauth_required", "rate_limited", "too_large", "unavailable", "failed"]).optional(),
}).strict();

export const ResetAccountExportsResultSchema = z.object({
  learningMaterialPaths: z.array(z.string().min(1).max(1_024)).max(10_000).default([]),
  accountExportPaths: z.array(z.string().min(1).max(500)).max(10_000),
}).strict();

import { z } from "zod";
import { LearningPlanSchema, PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { CORE_METHOD_IDS } from "@/lib/learning/method-catalog";
import { MapDeltaSchema } from "@/lib/plan-revision/map-delta";

// Runtime projections carry completed resources, reviews and checkpoints that
// creation's draft schema intentionally omits. Preserve these opaque fields in
// the signed projection; production authority always comes from server rows.
export const RevisionPlanSchema = LearningPlanSchema.extend({
  revisionId: z.string().uuid().optional(),
  materials: LearningPlanSchema.shape.materials.optional().default([]),
  sessions: LearningPlanSchema.shape.sessions.element.loose().array().min(1).max(28),
}).loose();

const currentContext = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active"), planId: z.string().uuid(), expectedRevisionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("draft"), plan: RevisionPlanSchema, generationRequest: PlanGenerationRequestSchema, draftReceipt: z.string().min(1).max(512).nullable() }).strict(),
  z.object({ kind: z.literal("development"), plan: RevisionPlanSchema, plans: z.array(RevisionPlanSchema).max(50), generationRequest: PlanGenerationRequestSchema.optional(), expectedRevisionId: z.string().uuid() }).strict(),
]);
export const RevisionControlsSchema = z.object({
  excludedOperationIndexes: z.array(z.number().int().min(0).max(39)).max(40).default([]),
  sessionEdits: z.array(z.object({
    sessionId: z.string().uuid().optional(),
    operationIndex: z.number().int().min(0).max(39).optional(),
    methodId: z.enum(CORE_METHOD_IDS).optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    durationMinutes: z.union([z.literal(10), z.literal(15), z.literal(25), z.literal(45), z.literal(60)]).optional(),
  }).strict().refine(edit => (edit.sessionId !== undefined) !== (edit.operationIndex !== undefined), "Choose one existing session or new-topic line.")).max(28).default([]),
}).strict().default({ excludedOperationIndexes: [], sessionEdits: [] });
export const RevisionFixedEventSchema = z.object({
  id: z.string().trim().min(1).max(160),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
}).strict().refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), "An event must end after it starts.");
export const PlanRevisionPreviewRequestSchema = z.object({
  action: z.literal("preview"), context: currentContext,
  delta: MapDeltaSchema, controls: RevisionControlsSchema,
  fixedEvents: z.array(RevisionFixedEventSchema).max(500).default([]),
}).strict();
export const RevisionCapacitySchema = z.object({
  status: z.enum(["fits", "reduced", "insufficient"]),
  explanation: z.string(),
  choices: z.array(z.object({ action: z.enum(["move_block", "shorten_scope", "add_time"]), label: z.string() })).max(3),
});
export const RevisionLineSchema = z.object({
  id: z.string(), operationIndex: z.number().int().nonnegative(), topicId: z.string().uuid().nullable(),
  description: z.string(), before: z.array(z.string()), after: z.array(z.string()),
  sessionIds: z.array(z.string().uuid()),
  blockedReason: z.string().nullable(),
});
export const PlanRevisionProposalSchema = z.object({
  id: z.string().uuid(), planId: z.string().uuid(), baseRevisionId: z.string().uuid(), revisionId: z.string().uuid(),
  contextKind: z.enum(["draft", "active", "development"]),
  before: RevisionPlanSchema, after: RevisionPlanSchema,
  generationRequest: PlanGenerationRequestSchema,
  delta: MapDeltaSchema, controls: RevisionControlsSchema,
  lines: z.array(RevisionLineSchema).max(40), capacity: RevisionCapacitySchema, canApply: z.boolean(),
  issuedAt: z.string().datetime({ offset: true }),
  sessionFingerprints: z.record(z.string(), z.string()).default({}),
  fixedEvents: z.array(RevisionFixedEventSchema).max(500).default([]),
  draftReceiptIssuedAt: z.string().datetime({ offset: true }).optional(),
  draftReceiptExpiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export const PlanRevisionApplyRequestSchema = z.object({
  action: z.literal("apply"), proposal: PlanRevisionProposalSchema, proposalReceipt: z.string().min(1).max(512),
}).strict();
export const PlanRevisionUndoRequestSchema = z.object({
  action: z.literal("undo"), planId: z.string().uuid(), expectedRevisionId: z.string().uuid(),
  developmentPlan: RevisionPlanSchema.optional(),
  proposal: PlanRevisionProposalSchema.optional(), proposalReceipt: z.string().min(1).max(512).optional(),
}).strict();
export type RevisionPlan = z.infer<typeof RevisionPlanSchema>;
export type PlanRevisionProposal = z.infer<typeof PlanRevisionProposalSchema>;
export type RevisionControls = z.infer<typeof RevisionControlsSchema>;
export type RevisionLine = z.infer<typeof RevisionLineSchema>;
export type RevisionCapacity = z.infer<typeof RevisionCapacitySchema>;

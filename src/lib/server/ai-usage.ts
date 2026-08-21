import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export {
  AI_USAGE_OPERATION_IN_PROGRESS_CODE,
  aiUsageReservationConflict,
  type AIUsageReservationConflict,
} from "@/lib/ai-usage/reservation-conflict";
import {
  aiUsageLimitFor,
  publicPasswordAccountsAreOpen,
  type AIUsageAction,
} from "@/lib/server/ai-usage-policy";

export type { AIUsageAction } from "@/lib/server/ai-usage-policy";

const AllowedAIUsageClaimSchema = z.object({
  allowed: z.literal(true),
  // Optional only during the migration rollout. Once the refundable-claim
  // migration is live, every allowed claim includes this private id.
  claimId: z.string().uuid().optional(),
  retryAfterSeconds: z.literal(0),
  remainingToday: z.number().int().min(0),
});

const LimitedAIUsageClaimSchema = z.object({
  allowed: z.literal(false),
  claimId: z.null().optional(),
  retryAfterSeconds: z.number().int().min(0).max(86_400),
  remainingToday: z.number().int().min(0),
});

const AIUsageClaimSchema = z.discriminatedUnion("allowed", [
  AllowedAIUsageClaimSchema,
  LimitedAIUsageClaimSchema,
]);

const AllowedAIUsageReservationSchema = z.object({
  allowed: z.literal(true),
  claimId: z.string().uuid(),
  operationKey: z.string().uuid(),
  reservationState: z.literal("reserved"),
  replayed: z.literal(false),
  retryAfterSeconds: z.literal(0),
  remainingToday: z.number().int().min(0),
}).strict();

const LimitedAIUsageReservationSchema = z.object({
  allowed: z.literal(false),
  claimId: z.null(),
  operationKey: z.string().uuid(),
  denialReason: z.enum([
    "usage_limit",
    "operation_in_progress",
    "operation_already_consumed",
    "operation_already_released",
  ]),
  retryAfterSeconds: z.number().int().min(0).max(86_400),
  remainingToday: z.number().int().min(0),
}).strict();

const AIUsageReservationSchema = z.discriminatedUnion("allowed", [
  AllowedAIUsageReservationSchema,
  LimitedAIUsageReservationSchema,
]);

export type AIUsageReservation = z.infer<typeof AIUsageReservationSchema>;

// Long enough for every currently metered route deadline, but bounded so a
// platform termination or lost response cannot consume the daily balance
// indefinitely. Provider calls still need their own shorter absolute timeout.
export const AI_USAGE_RESERVATION_LEASE_SECONDS = 180;
export const AI_USAGE_RPC_TIMEOUT_MS = 3_000;

type AIUsageRPCResult = {
  data: unknown;
  error: unknown;
};

type AbortableAIUsageRPC = PromiseLike<AIUsageRPCResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<AIUsageRPCResult>;
};

async function boundedAIUsageRPC(request: AbortableAIUsageRPC) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new AIUsageGateError());
    }, AI_USAGE_RPC_TIMEOUT_MS);
  });
  try {
    const abortableRequest = typeof request.abortSignal === "function"
      ? request.abortSignal(controller.signal)
      : request;
    return await Promise.race([Promise.resolve(abortableRequest), timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

const AvailableAIUsageStatusSchema = z.object({
  allowed: z.literal(true),
  limitedBy: z.null(),
  retryAfterSeconds: z.literal(0),
  remainingToday: z.number().int().min(1).max(1_000),
  resetAt: z.null(),
}).strict();

const LimitedAIUsageStatusSchema = z.object({
  allowed: z.literal(false),
  limitedBy: z.enum(["minute", "day"]),
  retryAfterSeconds: z.number().int().min(1).max(86_400),
  remainingToday: z.number().int().min(0).max(1_000),
  resetAt: z.string().datetime({ offset: true }),
}).strict().superRefine((status, context) => {
  if (status.limitedBy === "minute" && status.remainingToday === 0) {
    context.addIssue({
      code: "custom",
      message: "A zero daily balance must be classified by the daily window.",
    });
  }
  if (status.limitedBy === "day" && status.remainingToday !== 0) {
    context.addIssue({
      code: "custom",
      message: "A daily limit must have no requests remaining today.",
    });
  }
});

const AIUsageStatusSchema = z.union([
  AvailableAIUsageStatusSchema,
  LimitedAIUsageStatusSchema,
]);

export type AIUsageStatus =
  | z.infer<typeof AvailableAIUsageStatusSchema>
  | z.infer<typeof LimitedAIUsageStatusSchema>;

export class AIUsageGateError extends Error {
  constructor() {
    super("YOVA could not verify the AI usage budget.");
    this.name = "AIUsageGateError";
  }
}

export async function claimAIRequest(supabase: SupabaseClient, action: AIUsageAction) {
  const limit = aiUsageLimitFor(action, publicPasswordAccountsAreOpen());
  const { data, error } = await boundedAIUsageRPC(supabase.rpc("claim_ai_request", {
    request_action: action,
    minute_limit: limit.minute,
    day_limit: limit.day,
  }));
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageClaimSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  return parsed.data;
}

/**
 * Reserves one durable request with a caller-owned idempotency key. Unlike the
 * compatibility claim API, every allowed result from this strict path has an
 * exact claim id that must be either settled or released.
 */
export async function reserveAIRequest(
  supabase: SupabaseClient,
  action: AIUsageAction,
  operationKey: string,
  recoveryKey: string,
): Promise<AIUsageReservation> {
  const parsedOperationKey = z.string().uuid().safeParse(operationKey);
  const parsedRecoveryKey = z.string().uuid().safeParse(recoveryKey);
  if (
    !parsedOperationKey.success
    || !parsedRecoveryKey.success
    || parsedOperationKey.data === parsedRecoveryKey.data
  ) throw new AIUsageGateError();

  const limit = aiUsageLimitFor(action, publicPasswordAccountsAreOpen());
  const { data, error } = await boundedAIUsageRPC(supabase.rpc("reserve_ai_request", {
    request_action: action,
    minute_limit: limit.minute,
    day_limit: limit.day,
    request_operation_key: parsedOperationKey.data,
    request_recovery_key: parsedRecoveryKey.data,
    lease_seconds: AI_USAGE_RESERVATION_LEASE_SECONDS,
  }));
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageReservationSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  return parsed.data;
}

/** Marks one exact learner-usable reservation as consumed. */
export async function settleAIRequestClaim(
  supabase: SupabaseClient,
  claimId: string,
) {
  const parsedClaimId = z.string().uuid().safeParse(claimId);
  if (!parsedClaimId.success) throw new AIUsageGateError();

  // Consumption is idempotent in the database. Retry one ambiguous transport
  // or receipt failure so a committed transition whose response was lost can
  // be confirmed without charging or settling a second claim.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await boundedAIUsageRPC(supabase.rpc("consume_ai_request_claim", {
        usage_claim_id: parsedClaimId.data,
      }));
      if (!error && typeof data === "boolean") return data;
    } catch {
      // Retry the same idempotent claim exactly once.
    }
  }
  throw new AIUsageGateError();
}

/**
 * Returns one exact pre-provider reservation when generation produced no
 * learner-usable result. The database makes this operation owner-scoped and
 * idempotent, so a duplicated catch path cannot refund another request.
 */
export async function releaseAIRequestClaim(
  supabase: SupabaseClient,
  claimId: string,
) {
  const parsedClaimId = z.string().uuid().safeParse(claimId);
  if (!parsedClaimId.success) throw new AIUsageGateError();
  const { data, error } = await boundedAIUsageRPC(supabase.rpc("release_ai_request_claim", {
    usage_claim_id: parsedClaimId.data,
  }));
  if (error || typeof data !== "boolean") throw new AIUsageGateError();
  return data;
}

/**
 * Recovers the ambiguous reserve-RPC case: the database may have committed a
 * reservation even though its response never reached the route. Releasing by
 * the operation key is owner/action scoped and cannot refund another request.
 */
export async function releaseAIRequestReservation(
  supabase: SupabaseClient,
  action: AIUsageAction,
  operationKey: string,
  recoveryKey: string,
) {
  const parsedOperationKey = z.string().uuid().safeParse(operationKey);
  const parsedRecoveryKey = z.string().uuid().safeParse(recoveryKey);
  if (
    !parsedOperationKey.success
    || !parsedRecoveryKey.success
    || parsedOperationKey.data === parsedRecoveryKey.data
  ) throw new AIUsageGateError();
  const { data, error } = await boundedAIUsageRPC(supabase.rpc("release_ai_request_reservation", {
    request_action: action,
    request_operation_key: parsedOperationKey.data,
    request_recovery_key: parsedRecoveryKey.data,
  }));
  if (error || typeof data !== "boolean") throw new AIUsageGateError();
  return data;
}

/**
 * Reads the durable usage windows without incrementing either one. The
 * mutating claim remains authoritative at generation time; this snapshot is
 * only for telling the learner about a known limit before setup.
 */
export async function readAIUsageStatus(
  supabase: SupabaseClient,
  action: AIUsageAction,
): Promise<AIUsageStatus> {
  const limit = aiUsageLimitFor(action, publicPasswordAccountsAreOpen());
  const { data, error } = await boundedAIUsageRPC(supabase.rpc("read_ai_usage_status", {
    request_action: action,
    minute_limit: limit.minute,
    day_limit: limit.day,
  }));
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageStatusSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  if (parsed.data.resetAt === null) return parsed.data;
  return {
    ...parsed.data,
    resetAt: new Date(parsed.data.resetAt).toISOString(),
  };
}

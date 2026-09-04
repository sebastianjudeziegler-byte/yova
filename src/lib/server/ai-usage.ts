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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type { AIUsageAction } from "@/lib/server/ai-usage-policy";

// The allowance-status RPC predates strict operation reservations. Keep its
// TypeScript surface aligned with the legacy database allowlist instead of
// implying it supports the newly added strict-only actions.
type LegacyAIUsageAction = Exclude<
  AIUsageAction,
  "plan_adjustment" | "intake_interpretation" | "material_processing"
>;

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

export const AI_USAGE_RPC_TIMEOUT_MS = 3_000;
const authenticatedUserIdCache = new WeakMap<object, Promise<string>>();

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

/**
 * Reserves one durable request with a caller-owned idempotency key. Unlike the
 * compatibility claim API, every allowed result from this strict path has an
 * exact claim id that must be consumed, or explicitly refunded before any
 * provider invocation begins.
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

  const userId = await authenticatedAIUsageUserId(supabase);
  const admin = createAIUsageAdminClient();
  const { data, error } = await boundedAIUsageRPC(admin.rpc("reserve_ai_request_for_user", {
    target_user_id: userId,
    request_action: action,
    request_operation_key: parsedOperationKey.data,
    request_recovery_key: parsedRecoveryKey.data,
    request_public_accounts: publicPasswordAccountsAreOpen(),
  }));
  if (error) throw new AIUsageGateError();

  const parsed = AIUsageReservationSchema.safeParse(data);
  if (!parsed.success) throw new AIUsageGateError();
  return parsed.data;
}

/**
 * Irreversibly consumes one exact reservation. Call immediately before a
 * provider boundary where practical, or after any attempt that may be billed.
 */
export async function settleAIRequestClaim(
  supabase: SupabaseClient,
  claimId: string,
) {
  const parsedClaimId = z.string().uuid().safeParse(claimId);
  if (!parsedClaimId.success) throw new AIUsageGateError();
  const userId = await authenticatedAIUsageUserId(supabase);
  const admin = createAIUsageAdminClient();

  // Consumption is idempotent in the database. Retry one ambiguous transport
  // or receipt failure so a committed transition whose response was lost can
  // be confirmed without charging or settling a second claim.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await boundedAIUsageRPC(admin.rpc("consume_ai_request_claim_for_user", {
        target_user_id: userId,
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
 * Failure cleanup for any path that may have crossed a provider boundary.
 * Consumption is the safe default: provider refusals, invalid output, lost
 * receipts, validation failures and persistence conflicts may still be billed.
 */
export async function consumeAIRequestClaimAfterProviderFailure(
  supabase: SupabaseClient,
  claimId: string,
) {
  return settleAIRequestClaim(supabase, claimId);
}

/**
 * Refunds one exact reservation only when the caller proves no provider
 * invocation started. Keep this deliberately explicit and rare; ordinary
 * provider/post-provider catches use consumeAIRequestClaimAfterProviderFailure.
 */
export async function refundAIRequestClaimBeforeProvider(
  supabase: SupabaseClient,
  claimId: string,
) {
  const parsedClaimId = z.string().uuid().safeParse(claimId);
  if (!parsedClaimId.success) throw new AIUsageGateError();
  const userId = await authenticatedAIUsageUserId(supabase);
  const admin = createAIUsageAdminClient();
  const { data, error } = await boundedAIUsageRPC(admin.rpc("release_ai_request_claim_for_user", {
    target_user_id: userId,
    usage_claim_id: parsedClaimId.data,
  }));
  if (error || typeof data !== "boolean") throw new AIUsageGateError();
  return data;
}

/**
 * Recovers an ambiguous reserve/settle receipt before provider work begins.
 * The operation and private recovery keys scope the refund to the caller's
 * exact reservation; expiry or a prior consumption can never be refunded.
 */
export async function refundAIRequestReservationBeforeProvider(
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
  const userId = await authenticatedAIUsageUserId(supabase);
  const admin = createAIUsageAdminClient();
  const { data, error } = await boundedAIUsageRPC(admin.rpc("release_ai_request_reservation_for_user", {
    target_user_id: userId,
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
  action: LegacyAIUsageAction,
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

function createAIUsageAdminClient() {
  try {
    return createSupabaseAdminClient();
  } catch {
    throw new AIUsageGateError();
  }
}

function authenticatedAIUsageUserId(supabase: SupabaseClient) {
  const cached = authenticatedUserIdCache.get(supabase);
  if (cached) return cached;
  const loading = (async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      const parsed = z.string().uuid().safeParse(user?.id);
      if (error || !parsed.success) throw new AIUsageGateError();
      return parsed.data;
    } catch (error) {
      if (error instanceof AIUsageGateError) throw error;
      throw new AIUsageGateError();
    }
  })();
  authenticatedUserIdCache.set(supabase, loading);
  return loading;
}

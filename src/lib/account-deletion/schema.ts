import { z } from "zod";

export const ACCOUNT_DELETION_HEADER = "X-Yova-Confirm";
export const ACCOUNT_DELETION_HEADER_VALUE = "delete-account";
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

export const AccountDeletionRequestSchema = z.object({
  accountId: z.string().uuid(),
  confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION),
}).strict();

export const AccountDeletionRpcResultSchema = z.object({
  deletedAccountId: z.string().uuid(),
  cleanupJobId: z.string().uuid(),
}).strict();

export const AccountDeletionErrorResponseSchema = z.object({
  error: z.string().min(1).max(500),
  code: z.enum(["reauth_required", "unavailable", "failed"]),
}).strict();

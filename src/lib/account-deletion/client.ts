"use client";

import {
  requestEmailAuthentication,
  verifyEmailAuthenticationCode,
} from "@/lib/auth/client";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_HEADER,
  ACCOUNT_DELETION_HEADER_VALUE,
  AccountDeletionErrorResponseSchema,
} from "@/lib/account-deletion/schema";

export type AccountDeletionErrorCode = "reauth_required" | "unavailable" | "failed";

export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;

  constructor(code: AccountDeletionErrorCode, message: string) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
  }
}

export async function deleteAuthenticatedYovaAccount(
  accountId: string,
  options: { signal?: AbortSignal } = {},
) {
  const response = await fetch("/api/account", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [ACCOUNT_DELETION_HEADER]: ACCOUNT_DELETION_HEADER_VALUE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId,
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
    }),
    signal: options.signal,
  });
  if (response.status === 204) return;

  const body: unknown = await response.json().catch(() => null);
  const parsed = AccountDeletionErrorResponseSchema.safeParse(body);
  const code: AccountDeletionErrorCode = parsed.success
    ? parsed.data.code
    : response.status === 403
      ? "reauth_required"
      : response.status === 401 || response.status === 503
        ? "unavailable"
        : "failed";
  throw new AccountDeletionError(
    code,
    parsed.success
      ? parsed.data.error
      : "YOVA could not delete this account. Nothing was changed. Try again.",
  );
}

export async function requestAccountDeletionVerification(
  email: string,
  captchaToken?: string,
  options: { signal?: AbortSignal } = {},
) {
  const result = await requestEmailAuthentication({
    email,
    displayName: "",
    shouldCreateUser: false,
    captchaToken,
  });
  if (options.signal?.aborted) throw new DOMException("Account deletion was cancelled.", "AbortError");
  if (result.mode !== "supabase") {
    throw new AccountDeletionError("unavailable", "Account verification is unavailable right now.");
  }
}

export async function verifyAccountDeletionCode(
  expectedAccountId: string,
  email: string,
  code: string,
  options: { signal?: AbortSignal } = {},
) {
  const account = await verifyEmailAuthenticationCode(email, code);
  if (options.signal?.aborted) throw new DOMException("Account deletion was cancelled.", "AbortError");
  if (account.id !== expectedAccountId) {
    throw new AccountDeletionError(
      "failed",
      "That verification opened a different account. Sign out and return to the account you want to delete.",
    );
  }
}

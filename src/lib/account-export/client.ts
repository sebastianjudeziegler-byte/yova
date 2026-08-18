"use client";

import {
  requestEmailAuthentication,
  verifyEmailAuthenticationCode,
} from "@/lib/auth/client";
import { readActiveSessionCheckpointsForExport } from "@/lib/learning/active-session-checkpoint";
import { readPreviewSnapshotForExport } from "@/lib/persistence/preview-store";
import { readQueuedSessionCompletionsForExport } from "@/lib/sync/session-completion-outbox";
import { readQueuedSessionInterruptionsForExport } from "@/lib/sync/session-interruption-outbox";
import {
  ACCOUNT_EXPORT_DEVICE_MAX_BYTES,
  ACCOUNT_EXPORT_HEADER,
  ACCOUNT_EXPORT_HEADER_VALUE,
  AccountExportErrorResponseSchema,
  AccountExportReadySchema,
  AccountExportStartResponseSchema,
  DeviceExportAddendumSchema,
  type AccountDataExportReady,
} from "@/lib/account-export/schema";

export type { AccountDataExportReady } from "@/lib/account-export/schema";

export type AccountDataExportErrorCode =
  | "reauth_required"
  | "rate_limited"
  | "too_large"
  | "unavailable"
  | "failed";

export class AccountDataExportError extends Error {
  readonly code: AccountDataExportErrorCode;

  constructor(code: AccountDataExportErrorCode, message: string) {
    super(message);
    this.name = "AccountDataExportError";
    this.code = code;
  }
}

export async function prepareAccountDataExport(
  accountId: string,
  options: { signal?: AbortSignal } = {},
): Promise<AccountDataExportReady> {
  throwIfAborted(options.signal);
  const addendum = deviceAddendumForAccount(accountId);
  const serializedAddendum = JSON.stringify(addendum);
  const addendumBytes = new TextEncoder().encode(serializedAddendum).byteLength;
  if (addendumBytes > ACCOUNT_EXPORT_DEVICE_MAX_BYTES) {
    throw new AccountDataExportError(
      "too_large",
      "The data waiting in this browser is too large for a safe self-service download. Nothing was changed. Contact YOVA Support for help making a broader copy.",
    );
  }

  let exportId: string | null = null;
  try {
    const startResponse = await fetch("/api/account/data-export", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        [ACCOUNT_EXPORT_HEADER]: ACCOUNT_EXPORT_HEADER_VALUE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceState: addendum }),
      signal: options.signal,
    });
    const start = AccountExportStartResponseSchema.parse(await readResponse(startResponse));
    exportId = start.exportId;
    throwIfAborted(options.signal);

    const finalizeResponse = await fetch("/api/account/data-export", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        [ACCOUNT_EXPORT_HEADER]: ACCOUNT_EXPORT_HEADER_VALUE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        exportId: start.exportId,
        finalizeGrant: start.finalizeGrant,
      }),
      signal: options.signal,
    });
    const ready = AccountExportReadySchema.parse(await readResponse(finalizeResponse));
    exportId = null;
    return ready;
  } catch (error) {
    if (exportId) await revokeStartedExport(exportId);
    if (error instanceof AccountDataExportError || isAbortError(error)) throw error;
    throw new AccountDataExportError(
      "failed",
      "YOVA could not prepare your download. Nothing was changed. Check your connection and try again.",
    );
  }
}

export async function requestAccountDataExportVerification(
  email: string,
  captchaToken?: string,
  options: { signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const result = await requestEmailAuthentication({
    email,
    displayName: "",
    shouldCreateUser: false,
    captchaToken,
  });
  throwIfAborted(options.signal);
  if (result.mode !== "supabase") {
    throw new AccountDataExportError(
      "unavailable",
      "Account verification is available only for a connected cloud account.",
    );
  }
}

export async function verifyAccountDataExportCode(
  expectedAccountId: string,
  email: string,
  code: string,
  options: { signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const account = await verifyEmailAuthenticationCode(email, code);
  throwIfAborted(options.signal);
  if (account.id !== expectedAccountId) {
    throw new AccountDataExportError(
      "failed",
      "That verification opened a different account. Sign out, return to this account, and try again.",
    );
  }
  return account;
}

function deviceAddendumForAccount(accountId: string) {
  const snapshot = readPreviewSnapshotForExport();
  const completions = readQueuedSessionCompletionsForExport(accountId);
  const interruptions = readQueuedSessionInterruptionsForExport(accountId);
  const checkpoints = readActiveSessionCheckpointsForExport(accountId);
  if (!snapshot.ok || !completions.ok || !interruptions.ok || !checkpoints.ok) {
    throw new AccountDataExportError(
      "failed",
      "YOVA could not safely read all data saved in this browser. Nothing was changed. Close other YOVA tabs, check browser storage access, and try again.",
    );
  }
  return DeviceExportAddendumSchema.parse({
    schemaVersion: 1,
    accountId,
    capturedAt: new Date().toISOString(),
    previewSnapshot: snapshot.value?.account?.id === accountId ? snapshot.value : null,
    pendingSessionCompletions: completions.value,
    pendingSessionInterruptions: interruptions.value,
    activeSessionCheckpoints: checkpoints.value,
  });
}

async function readResponse(response: Response) {
  const value: unknown = await response.json().catch(() => null);
  if (response.ok) return value;

  const parsed = AccountExportErrorResponseSchema.safeParse(value);
  const code: AccountDataExportErrorCode = parsed.success && parsed.data.code
    ? parsed.data.code
    : response.status === 403
      ? "reauth_required"
      : response.status === 429
        ? "rate_limited"
      : response.status === 413
        ? "too_large"
        : response.status === 401 || response.status === 503
          ? "unavailable"
          : "failed";
  throw new AccountDataExportError(
    code,
    parsed.success
      ? parsed.data.error
      : "YOVA could not prepare your download. Nothing was changed. Try again.",
  );
}

async function revokeStartedExport(exportId: string) {
  await fetch("/api/account/data-export", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [ACCOUNT_EXPORT_HEADER]: ACCOUNT_EXPORT_HEADER_VALUE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ exportId }),
  }).catch(() => null);
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("The account-data request was cancelled.", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

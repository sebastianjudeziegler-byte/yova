import { NextResponse } from "next/server";
import { cleanupDeletedAccountStorage } from "@/lib/account-deletion/cleanup";
import {
  ACCOUNT_DELETION_HEADER,
  ACCOUNT_DELETION_HEADER_VALUE,
  AccountDeletionRequestSchema,
  AccountDeletionRpcResultSchema,
} from "@/lib/account-deletion/schema";
import { authenticateAccountExportStart } from "@/lib/account-export/auth";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAXIMUM_BODY_BYTES = 1_024;

export async function DELETE(request: Request) {
  const requestIssue = validateRequest(request);
  if (requestIssue) return requestIssue;
  if (!isSupabaseAdminConfigured()) return unavailable();

  const requestBody = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
  const parsedRequest = AccountDeletionRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonError("Confirm permanent account deletion inside YOVA.", 422, "failed");
  }

  const supabase = await createSupabaseServerClient();
  const auth = await authenticateAccountExportStart(supabase);
  if (!auth.ok) return authError(auth.reason);
  if (parsedRequest.data.accountId !== auth.context.user.id) {
    return jsonError("YOVA blocked an account deletion for a different identity.", 403, "failed");
  }

  const { data, error } = await supabase.rpc("delete_yova_account", {
    expected_account_id: auth.context.user.id,
  });
  if (error) {
    if (
      error.code === "PXD01"
      || error.message?.includes("account_deletion_reauthentication_required")
    ) return authError("reauth_required");
    if (
      error.code === "PXD02"
      || error.message?.includes("account_deletion_email_unverified")
    ) return authError("unverified_email");
    if (
      error.code === "54000"
      || error.message?.includes("account_deletion_cleanup_limit_exceeded")
    ) {
      return jsonError(
        "This account has more private files than self-service deletion can safely process. Nothing was changed. Contact YOVA Support.",
        409,
        "failed",
      );
    }
    return jsonError("YOVA could not delete this account. Nothing was changed. Try again.", 500, "failed");
  }

  // At this point the Auth identity and FK-owned records are already gone in
  // one committed transaction. A malformed response must never strand the
  // browser in a signed-in UI or imply that retrying could restore the account.
  const deletion = AccountDeletionRpcResultSchema.safeParse(data);
  if (deletion.success && deletion.data.deletedAccountId === auth.context.user.id) {
    await cleanupDeletedAccountStorage(createSupabaseAdminClient(), { limit: 100 }).catch(() => null);
  }
  return new NextResponse(null, { status: 204, headers: privateHeaders() });
}

function validateRequest(request: Request) {
  if (request.headers.get(ACCOUNT_DELETION_HEADER.toLowerCase()) !== ACCOUNT_DELETION_HEADER_VALUE) {
    return jsonError("Start permanent account deletion from inside YOVA.", 400, "failed");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return jsonError("YOVA blocked a cross-site account-deletion request.", 403, "failed");
  }
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return jsonError("YOVA blocked a cross-site account-deletion request.", 403, "failed");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError("The account-deletion request must use JSON.", 415, "failed");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = /^\d+$/.test(contentLength) ? Number(contentLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAXIMUM_BODY_BYTES) {
      return jsonError("The account-deletion request body is too large.", 413, "failed");
    }
  }
  return null;
}

async function readBoundedJson(request: Request, maximumBytes: number) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function authError(reason: "signed_out" | "unverified_email" | "reauth_required") {
  if (reason === "signed_out") {
    return jsonError("Sign in before deleting your YOVA account.", 401, "unavailable");
  }
  return jsonError(
    reason === "unverified_email"
      ? "Verify your account email before permanently deleting this account."
      : "For your security, verify your email again before permanently deleting this account.",
    403,
    "reauth_required",
  );
}

function unavailable() {
  return jsonError("Account deletion is not configured on this YOVA environment.", 503, "unavailable");
}

function jsonError(
  error: string,
  status: number,
  code: "reauth_required" | "unavailable" | "failed",
) {
  return NextResponse.json({ error, code }, {
    status,
    headers: privateHeaders(),
  });
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

import { NextResponse } from "next/server";
import {
  authenticateAccountExportFinalize,
  authenticateAccountExportStart,
} from "@/lib/account-export/auth";
import { isAccountExportCleanupConfigured } from "@/lib/account-export/config";
import {
  accountExportFinalPath,
  accountExportTempPath,
  AccountExportServerError,
  finalizeAccountDataArtifact,
} from "@/lib/account-export/server";
import {
  ACCOUNT_EXPORT_BUCKET,
  ACCOUNT_EXPORT_DEVICE_MAX_BYTES,
  ACCOUNT_EXPORT_HEADER,
  ACCOUNT_EXPORT_HEADER_VALUE,
  AccountExportFinalizeRequestSchema,
  AccountExportReadySchema,
  AccountExportRevokeRequestSchema,
  AccountExportStartRequestSchema,
  BeginAccountExportRpcSchema,
} from "@/lib/account-export/schema";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const START_REQUEST_MAX_BYTES = ACCOUNT_EXPORT_DEVICE_MAX_BYTES + 16_384;
const BODY_TOO_LARGE = Symbol("body-too-large");

export async function POST(request: Request) {
  const guard = validateMutationRequest(request, START_REQUEST_MAX_BYTES);
  if (guard) return guard;
  if (!isAccountExportCleanupConfigured()) return unavailable();

  const supabase = await createSupabaseServerClient();
  const auth = await authenticateAccountExportStart(supabase);
  if (!auth.ok) return authError(auth.reason);

  const requestBody = await readBoundedJson(request, START_REQUEST_MAX_BYTES);
  if (requestBody === BODY_TOO_LARGE) {
    return jsonError("The account-copy request body is too large.", 413, "too_large");
  }
  const parsedRequest = AccountExportStartRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonError("The device data for this account copy was not valid.", 422, "failed");
  }
  const serializedDeviceState = JSON.stringify(parsedRequest.data.deviceState);
  if (new TextEncoder().encode(serializedDeviceState).byteLength > ACCOUNT_EXPORT_DEVICE_MAX_BYTES) {
    return jsonError(
      "The data waiting in this browser is too large for a safe self-service download. Nothing was changed.",
      413,
      "too_large",
    );
  }

  if (parsedRequest.data.deviceState.accountId !== auth.context.user.id) {
    return jsonError("The browser data belongs to a different account. Nothing was changed.", 403, "failed");
  }

  const exportId = crypto.randomUUID();
  const { data, error } = await supabase.rpc("begin_account_data_export", {
    requested_export_id: exportId,
  });
  if (error) {
    if (error.message?.includes("account_export_reauthentication_required")) {
      return authError("reauth_required");
    }
    if (
      error.code === "PXA01"
      || error.code === "PXA02"
      || error.message?.includes("account_export_hourly_quota_exceeded")
      || error.message?.includes("account_export_daily_quota_exceeded")
    ) {
      const daily = error.code === "PXA02" || error.message?.includes("daily");
      return jsonError(
        "Too many account copies were prepared recently. Wait a while, then try again.",
        429,
        "rate_limited",
        { "Retry-After": String(retryAfterSeconds(error.details, daily ? 86_400 : 3_600)) },
      );
    }
    if (error.code === "PXA03" || error.message?.includes("account_export_in_progress")) {
      return jsonError(
        "Another account copy is already being prepared. Wait for it to finish or close it before starting again.",
        409,
        "failed",
      );
    }
    return failed("YOVA could not securely start your account copy. Nothing was changed. Try again.");
  }

  const parsed = BeginAccountExportRpcSchema.safeParse(data);
  if (!parsed.success || parsed.data.exportId !== exportId) {
    return failed("YOVA could not verify the new account copy. Nothing was changed. Try again.");
  }

  const admin = createSupabaseAdminClient();
  const expectedTempPath = accountExportTempPath(auth.context.user.id, exportId);
  if (parsed.data.tempStoragePath !== expectedTempPath) {
    await failExport(supabase, admin, auth.context.user.id, exportId);
    return failed("YOVA could not verify the private storage location. Nothing was changed.");
  }

  const { error: tempUploadError } = await admin.storage
    .from(ACCOUNT_EXPORT_BUCKET)
    .upload(expectedTempPath, serializedDeviceState, {
      contentType: "application/json",
      cacheControl: "0",
      upsert: false,
    });
  if (tempUploadError) {
    await failExport(supabase, admin, auth.context.user.id, exportId);
    return failed("YOVA could not prepare private temporary storage. Nothing was changed. Try again.");
  }

  return NextResponse.json({
    status: "ready_to_finalize",
    exportId,
    finalizeGrant: parsed.data.finalizeGrant,
    prepareExpiresAt: parsed.data.prepareExpiresAt,
  }, { headers: privateHeaders() });
}

export async function PUT(request: Request) {
  const guard = validateMutationRequest(request, 2_048);
  if (guard) return guard;
  if (!isAccountExportCleanupConfigured()) return unavailable();

  const requestBody = await readBoundedJson(request, 2_048);
  if (requestBody === BODY_TOO_LARGE) {
    return jsonError("The account-copy request body is too large.", 413, "too_large");
  }
  const parsedRequest = AccountExportFinalizeRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonError("YOVA could not identify the account copy to finish.", 422, "failed");
  }

  const supabase = await createSupabaseServerClient();
  const auth = await authenticateAccountExportFinalize(supabase);
  if (!auth.ok) return authError(auth.reason);

  const { exportId, finalizeGrant } = parsedRequest.data;
  const { data: claimed, error: claimError } = await supabase.rpc("claim_account_data_export", {
    requested_export_id: exportId,
    requested_finalize_grant: finalizeGrant,
  });
  if (claimError || claimed !== true) {
    return jsonError(
      "This account-copy request expired or was already used. Nothing was changed. Start again.",
      409,
      "failed",
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    const ready = await finalizeAccountDataArtifact({
      authenticated: supabase,
      admin,
      user: auth.context.user,
      exportId,
    });
    const { data: completed, error: completeError } = await supabase.rpc("complete_account_data_export", {
      requested_export_id: exportId,
      requested_size_bytes: ready.sizeBytes,
      requested_filename: ready.filename,
    });
    if (completeError || completed !== true) {
      await failExport(supabase, admin, auth.context.user.id, exportId);
      return failed("YOVA could not safely finish the account copy. Nothing was changed. Start again.");
    }

    return NextResponse.json(AccountExportReadySchema.parse({
      downloadUrl: ready.downloadUrl,
      filename: ready.filename,
      expiresAt: ready.expiresAt,
    }), {
      headers: privateHeaders(),
    });
  } catch (error) {
    await failExport(supabase, admin, auth.context.user.id, exportId);
    if (error instanceof AccountExportServerError) {
      return jsonError(error.message, error.code === "too_large" ? 413 : 500, error.code);
    }
    return failed("YOVA could not prepare your download. Nothing was changed. Try again.");
  }
}

export async function DELETE(request: Request) {
  const guard = validateMutationRequest(request, 512);
  if (guard) return guard;
  if (!isSupabaseAdminConfigured()) return unavailable();

  const requestBody = await readBoundedJson(request, 512);
  if (requestBody === BODY_TOO_LARGE) {
    return jsonError("The account-copy request body is too large.", 413, "too_large");
  }
  const parsedRequest = AccountExportRevokeRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonError("YOVA could not identify the account copy to close.", 422, "failed");
  }
  const { exportId } = parsedRequest.data;

  const supabase = await createSupabaseServerClient();
  const auth = await authenticateAccountExportFinalize(supabase);
  if (!auth.ok) return authError(auth.reason);

  const { error: revokeError } = await supabase.rpc("revoke_account_data_export", {
    requested_export_id: exportId,
  });
  if (revokeError) return failed("YOVA could not close the temporary account copy. Try again.");

  const admin = createSupabaseAdminClient();
  const paths = [
    accountExportTempPath(auth.context.user.id, exportId),
    accountExportFinalPath(auth.context.user.id, exportId),
  ];
  const { error: removeError } = await admin.storage.from(ACCOUNT_EXPORT_BUCKET).remove(paths);
  // The revoked row remains as a bounded cleanup receipt. The service-role
  // cleanup lease removes it; authenticated routes cannot bypass that lease.
  void removeError;

  return new NextResponse(null, { status: 204, headers: privateHeaders() });
}

async function failExport(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  exportId: string,
) {
  await supabase.rpc("fail_account_data_export", { requested_export_id: exportId });
  await admin.storage.from(ACCOUNT_EXPORT_BUCKET).remove([
    accountExportTempPath(userId, exportId),
    accountExportFinalPath(userId, exportId),
  ]);
}

function validateMutationRequest(request: Request, maximumBytes: number) {
  if (request.headers.get(ACCOUNT_EXPORT_HEADER.toLowerCase()) !== ACCOUNT_EXPORT_HEADER_VALUE) {
    return jsonError("Start this private download from inside YOVA.", 400, "failed");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return jsonError("YOVA blocked a cross-site account-copy request.", 403, "failed");
  }
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return jsonError("YOVA blocked a cross-site account-copy request.", 403, "failed");
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError("The account-copy request must use JSON.", 415, "failed");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = /^\d+$/.test(contentLength) ? Number(contentLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maximumBytes) {
      return jsonError("The account-copy request body is too large.", 413, "too_large");
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
        return BODY_TOO_LARGE;
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
    return jsonError("Sign in before downloading your YOVA data.", 401, "unavailable");
  }
  return jsonError(
    reason === "unverified_email"
      ? "Verify your account email before downloading private YOVA data."
      : "For your privacy, verify your email again before preparing this download.",
    403,
    "reauth_required",
  );
}

function unavailable() {
  return jsonError("Account downloads are not configured on this YOVA environment.", 503, "unavailable");
}

function failed(message: string) {
  return jsonError(message, 500, "failed");
}

function jsonError(
  error: string,
  status: number,
  code: "reauth_required" | "rate_limited" | "too_large" | "unavailable" | "failed",
  headers: Record<string, string> = {},
) {
  return NextResponse.json({ error, code }, {
    status,
    headers: { ...privateHeaders(), ...headers },
  });
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

function retryAfterSeconds(detail: string | undefined, fallback: number) {
  const parsed = Number.parseInt(detail?.match(/retry_after_seconds\s*=\s*(\d+)/i)?.[1] ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(60, Math.min(parsed, 86_400)) : fallback;
}

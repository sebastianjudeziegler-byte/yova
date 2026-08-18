import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ACCOUNT_EXPORT_BUCKET,
  ACCOUNT_EXPORT_DEVICE_MAX_BYTES,
  ACCOUNT_EXPORT_DOWNLOAD_TTL_SECONDS,
  ACCOUNT_EXPORT_FINAL_MAX_BYTES,
  ACCOUNT_EXPORT_MAX_LOGICAL_RECORDS,
  AccountExportReadySchema,
  DeviceExportAddendumSchema,
  type AccountDataExportReady,
  type DeviceExportAddendum,
} from "@/lib/account-export/schema";

export class AccountExportServerError extends Error {
  readonly code: "too_large" | "failed";

  constructor(code: "too_large" | "failed", message: string) {
    super(message);
    this.name = "AccountExportServerError";
    this.code = code;
  }
}

export async function finalizeAccountDataArtifact({
  authenticated,
  admin,
  user,
  exportId,
  now = new Date(),
}: {
  authenticated: SupabaseClient;
  admin: SupabaseClient;
  user: User;
  exportId: string;
  now?: Date;
}): Promise<AccountDataExportReady & { sizeBytes: number; filename: string }> {
  const tempStoragePath = accountExportTempPath(user.id, exportId);
  const finalStoragePath = accountExportFinalPath(user.id, exportId);
  const bucket = admin.storage.from(ACCOUNT_EXPORT_BUCKET);

  const { data: deviceFile, error: deviceError } = await bucket.download(tempStoragePath);
  if (deviceError || !deviceFile) {
    throw new AccountExportServerError(
      "failed",
      "YOVA could not verify the data saved on this device. Nothing was changed. Start the download again.",
    );
  }
  if (deviceFile.size > ACCOUNT_EXPORT_DEVICE_MAX_BYTES) {
    throw new AccountExportServerError(
      "too_large",
      "The data waiting in this browser is too large for a safe self-service download. Nothing was changed. Contact YOVA Support for help making a broader copy.",
    );
  }

  const deviceText = await deviceFile.text();
  if (new TextEncoder().encode(deviceText).byteLength > ACCOUNT_EXPORT_DEVICE_MAX_BYTES) {
    throw new AccountExportServerError(
      "too_large",
      "The data waiting in this browser is too large for a safe self-service download. Nothing was changed. Contact YOVA Support for help making a broader copy.",
    );
  }
  const parsedDevice = DeviceExportAddendumSchema.safeParse(parseJson(deviceText));
  if (!parsedDevice.success || parsedDevice.data.accountId !== user.id) {
    throw new AccountExportServerError(
      "failed",
      "YOVA could not verify that this browser data belongs to the signed-in account. Nothing was changed.",
    );
  }

  const { data: cloudData, error: cloudError } = await authenticated.rpc("build_account_data_export");
  if (cloudError || !cloudData || typeof cloudData !== "object" || Array.isArray(cloudData)) {
    throw new AccountExportServerError(
      isExportLimitError(cloudError) ? "too_large" : "failed",
      isExportLimitError(cloudError)
        ? "This account copy is too large for YOVA's self-service download. Nothing was changed. Contact YOVA Support for a broader privacy request."
        : "YOVA could not safely collect every saved account record. Nothing was changed. Try again.",
    );
  }

  const cloudRecordCount = cloudData.recordCount;
  if (!Number.isSafeInteger(cloudRecordCount) || Number(cloudRecordCount) < 0) {
    throw new AccountExportServerError(
      "failed",
      "YOVA could not verify the number of saved account records. Nothing was changed. Try again.",
    );
  }
  const combinedRecordCount = Number(cloudRecordCount) + deviceLogicalRecordCount(parsedDevice.data);
  if (combinedRecordCount > ACCOUNT_EXPORT_MAX_LOGICAL_RECORDS) {
    throw new AccountExportServerError(
      "too_large",
      "This account copy is too large for YOVA's self-service download. Nothing was changed. Contact YOVA Support for a broader privacy request.",
    );
  }

  const exportedAt = now.toISOString();
  const filename = exportFilename(now);
  const artifact = {
    schemaVersion: 1,
    product: "YOVA",
    exportedAt,
    account: safeAuthAccount(user),
    cloudData,
    deviceState: parsedDevice.data,
    exportScope: {
      format: "JSON",
      originalMaterialFilesIncluded: false,
      originalMaterialFiles: "listed_in_storage_manifest_only",
      passwordIncluded: false,
      signInTokensIncluded: false,
      providerLogsIncluded: false,
      serviceUsageCountersIncluded: true,
      internalSecurityLogsIncluded: false,
    },
  };
  const serialized = JSON.stringify(artifact, null, 2);
  const sizeBytes = new TextEncoder().encode(serialized).byteLength;
  if (sizeBytes > ACCOUNT_EXPORT_FINAL_MAX_BYTES) {
    throw new AccountExportServerError(
      "too_large",
      "This account copy is too large for YOVA's self-service download. Nothing was changed. Contact YOVA Support for a broader privacy request.",
    );
  }

  const { error: uploadError } = await bucket.upload(
    finalStoragePath,
    new Blob([serialized], { type: "application/json" }),
    { contentType: "application/json", cacheControl: "0", upsert: false },
  );
  if (uploadError) {
    throw new AccountExportServerError(
      "failed",
      "YOVA could not place the finished copy in private storage. Nothing was changed. Try again.",
    );
  }

  const { error: tempDeleteError } = await bucket.remove([tempStoragePath]);
  if (tempDeleteError) {
    await bucket.remove([finalStoragePath]);
    throw new AccountExportServerError(
      "failed",
      "YOVA could not finish cleaning up the temporary device copy. Nothing in your YOVA account was changed. Try again.",
    );
  }

  const expiresAt = new Date(now.getTime() + ACCOUNT_EXPORT_DOWNLOAD_TTL_SECONDS * 1_000).toISOString();
  const { data: signed, error: signedError } = await bucket.createSignedUrl(
    finalStoragePath,
    ACCOUNT_EXPORT_DOWNLOAD_TTL_SECONDS,
    { download: filename },
  );
  if (signedError || !signed?.signedUrl) {
    await bucket.remove([finalStoragePath]);
    throw new AccountExportServerError(
      "failed",
      "YOVA prepared the private copy but could not open a download link. Nothing was changed. Try again.",
    );
  }

  return {
    ...AccountExportReadySchema.parse({
      downloadUrl: signed.signedUrl,
      filename,
      expiresAt,
    }),
    sizeBytes,
  };
}

export function accountExportTempPath(userId: string, exportId: string) {
  return `${userId}/${exportId}/device-state.json`;
}

export function accountExportFinalPath(userId: string, exportId: string) {
  return `${userId}/${exportId}/yova-data.json`;
}

export function exportFilename(date: Date) {
  return `yova-data-${date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")}.json`;
}

function safeAuthAccount(user: User) {
  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? user.user_metadata
    : {};
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : typeof user.app_metadata?.provider === "string"
      ? [user.app_metadata.provider]
      : [];

  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: safeAuthTimestamp(user.created_at),
    updatedAt: safeAuthTimestamp(user.updated_at),
    lastSignInAt: safeAuthTimestamp(user.last_sign_in_at),
    emailConfirmedAt: safeAuthTimestamp(user.email_confirmed_at),
    emailConfirmed: Boolean(user.email_confirmed_at),
    isAnonymous: user.is_anonymous === true,
    providers: [...new Set(providers.flatMap((provider) => safeProvider(provider)))],
    profileMetadata: {
      displayName: safeMetadataText(metadata.display_name, 80),
      termsVersion: safeMetadataText(metadata.terms_version, 40),
      termsAcceptedAt: safeMetadataText(metadata.terms_accepted_at, 80),
      ageConfirmation: safeMetadataText(metadata.age_confirmation, 80),
    },
  };
}

function safeProvider(value: unknown) {
  if (typeof value !== "string") return [];
  const provider = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(provider) ? [provider] : [];
}

function safeMetadataText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximumLength ? text : null;
}

function safeAuthTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 80) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function deviceLogicalRecordCount(addendum: DeviceExportAddendum) {
  const preview = addendum.previewSnapshot;
  return (preview
    ? preview.onboardingAnswers.length
      + preview.plans.length
      + preview.deadlineMilestones.length
      + preview.sessionCompletions.length
      + preview.sessionInterruptions.length
    : 0)
    + addendum.pendingSessionCompletions.length
    + addendum.pendingSessionInterruptions.length
    + addendum.activeSessionCheckpoints.length;
}

function isExportLimitError(error: { message?: string; code?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "54000" || message.includes("account_export_limit_exceeded");
}

import { NextResponse } from "next/server";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import { MaterialUnderstandingSchema } from "@/lib/knowledge-map/schema";
import { MaterialExtractionError } from "@/lib/materials/extract";
import { extractMaterialWithRecovery } from "@/lib/materials/extract-with-recovery";
import { assessMaterialQuality } from "@/lib/materials/quality";
import { materialStoragePath, sanitizeMaterialDisplayName } from "@/lib/materials/filename";
import { storePrivateMaterial } from "@/lib/materials/storage-upload";
import {
  MATERIAL_MAPPING_ROUTE_BUDGET_MS,
  mapAndPersistMaterialWithConsumedAIUsage,
} from "@/lib/materials/material-understanding";
import { cancelStagedMaterial } from "@/lib/materials/staged-cleanup";
import {
  MaterialDeleteRequestSchema,
  MaterialProcessRequestSchema,
  MaterialStageRequestSchema,
  MaterialStageResponseSchema,
  MaterialUploadResponseSchema,
} from "@/lib/materials/schema";
import {
  refundAIRequestClaimBeforeProvider,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { checkMaterialUploadRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type SupportedMimeType = "application/pdf" | "text/plain" | "text/markdown";

// Creates a user-owned staging record and a short-lived token. The browser
// sends the file directly to Supabase Storage, avoiding hosting request limits.
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before adding learning materials." }, { status: 401 });
  }

  const rateLimit = checkMaterialUploadRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many files were uploaded at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const parsed = MaterialStageRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose one PDF, TXT, or Markdown file up to 10 MB." }, { status: 422 });
  }

  const mimeType = resolveMimeType(parsed.data.name, parsed.data.mimeType);
  if (!mimeType) {
    return NextResponse.json({ error: "This file type is not supported. Use PDF, TXT, or Markdown." }, { status: 422 });
  }

  const materialId = crypto.randomUUID();
  const safeName = sanitizeMaterialDisplayName(parsed.data.name);
  const storagePath = materialStoragePath(user.id, materialId, mimeType);
  const { data: staged, error: insertError } = await supabase.rpc("create_material_upload", {
    payload: {
      id: materialId,
      filename: safeName,
      storagePath,
      mimeType,
      byteSize: parsed.data.sizeBytes,
      processingStatus: "processing",
      metadata: { originalFilename: parsed.data.name.slice(0, 180) },
    },
  });

  if (insertError || staged !== true) {
    console.error("YOVA material staging failed", { requestId, reason: "database_insert" });
    return NextResponse.json({ error: "YOVA could not prepare a secure upload.", requestId }, { status: 500, headers: { "X-Yova-Request-Id": requestId } });
  }

  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from("learning-materials")
    .createSignedUploadUrl(storagePath);
  if (signedUploadError || !signedUpload?.token) {
    const cleanup = await cancelStagedMaterial(supabase, materialId);
    console.error("YOVA material staging failed", { requestId, reason: "signed_upload" });
    if (cleanup.status === "outcome_unconfirmed" || cleanup.status === "durable") {
      return NextResponse.json({
        error: `YOVA could not prepare the secure upload or confirm cancellation. Do not add the file again yet. Contact YOVA Support with reference ${requestId}.`,
        code: "material_stage_cleanup_outcome_unconfirmed",
        committed: "unknown",
        materialId,
        requestId,
      }, { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
    }
    return NextResponse.json({ error: "YOVA could not prepare a secure upload.", requestId }, { status: 500, headers: { "X-Yova-Request-Id": requestId } });
  }

  try {
    const stagedMaterial = MaterialStageResponseSchema.parse({
      materialId,
      storagePath,
      token: signedUpload.token,
      mimeType,
    });
    return NextResponse.json(stagedMaterial, {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  } catch (error) {
    const invalidResponseReason = error instanceof Error ? error.name : "unknown";
    const cleanup = await cancelStagedMaterial(supabase, materialId);
    if (cleanup.status !== "outcome_unconfirmed" && cleanup.status !== "durable") {
      console.error("YOVA material staging response was invalid; staging row cancelled", {
        requestId,
        materialId,
        reason: invalidResponseReason,
      });
      return NextResponse.json({
        error: "YOVA could not prepare the secure upload. The pending upload was removed, so it is safe to try adding the file again.",
        code: "material_stage_response_invalid_rolled_back",
        retryable: true,
        requestId,
      }, {
        status: 500,
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }

    console.error("YOVA material staging committed but its response was invalid", {
      requestId,
      materialId,
      reason: invalidResponseReason,
      cleanupStatus: cleanup.status,
    });
    return NextResponse.json({
      error: `YOVA created the pending material upload, but could not return its secure upload instructions. Do not add the file again. Contact YOVA Support with reference ${requestId}.`,
      code: "material_stage_committed_response_invalid",
      committed: true,
      materialId,
      requestId,
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
}

// Browser-to-storage signed uploads can be blocked by privacy extensions or
// strict cross-site storage rules. This authenticated same-origin fallback is
// intentionally bounded to the same staged record and file limits.
export async function PUT(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before adding learning materials." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const materialId = form?.get("materialId");
  const file = form?.get("file");
  if (typeof materialId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "YOVA could not identify this upload." }, { status: 422 });
  }
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Choose a file up to 10 MB." }, { status: 422 });
  }

  const { data: upload, error: uploadError } = await supabase
    .from("material_uploads")
    .select("storage_path,mime_type,byte_size,expires_at")
    .eq("id", materialId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (uploadError) return NextResponse.json({ error: "YOVA could not load that staged upload." }, { status: 500 });
  if (!upload) return NextResponse.json({
    error: "That pending upload expired or is no longer available. Add the file again.",
    code: "material_staging_expired",
  }, { status: 410 });
  if (Number(upload.byte_size) !== file.size) return NextResponse.json({ error: "The selected file changed before upload." }, { status: 422 });

  // The owner-scoped row lookup above is the authorization boundary. Storage
  // writes use the server credential so authenticated clients need no DELETE
  // or UPDATE policy that could be replayed directly against this exact path.
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "YOVA's secure upload fallback is not configured. Try the direct upload again.", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
  let adminStorage: ReturnType<typeof createSupabaseAdminClient>["storage"];
  try {
    adminStorage = createSupabaseAdminClient().storage;
  } catch {
    return NextResponse.json(
      { error: "YOVA's secure upload fallback is unavailable. Try the direct upload again.", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }

  const stored = await storePrivateMaterial(
    adminStorage.from("learning-materials"),
    upload.storage_path,
    file,
    upload.mime_type,
  );
  if (!stored.ok) {
    console.error("YOVA same-origin material upload failed", { requestId, reason: stored.reason });
    if (stored.reason === "object-conflict") {
      return NextResponse.json({
        error: "A different object already occupies this pending upload. Cancel it and add the file again.",
        code: "material_storage_object_conflict",
        retryable: false,
        requestId,
      }, {
        status: 409,
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }
    return NextResponse.json(
      { error: "YOVA could not securely upload this file. Try again before exporting or changing the document.", requestId },
      { status: 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
  const { data: activeUpload, error: activeUploadError } = await supabase
    .from("material_uploads")
    .select("id")
    .eq("id", materialId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (activeUploadError || !activeUpload) {
    const cleanup = await cancelStagedMaterial(supabase, materialId);
    if (cleanup.status === "outcome_unconfirmed" || cleanup.status === "durable") {
      return NextResponse.json({
        error: `YOVA stored the file but could not confirm whether its pending upload was cancelled. Do not add it again yet. Contact YOVA Support with reference ${requestId}.`,
        code: "material_upload_cleanup_outcome_unconfirmed",
        committed: "unknown",
        materialId,
        requestId,
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }
    return NextResponse.json({
      error: activeUploadError
        ? "YOVA could not confirm the stored upload, so its pending copy was cancelled. It is safe to add the file again."
        : "That pending upload expired while the file was being stored. Add the file again.",
      code: activeUploadError ? "material_upload_confirmation_failed_cancelled" : "material_staging_expired",
      retryable: true,
      committed: true,
      ...(cleanup.status === "cleanup_pending" ? { cleanupPending: true } : {}),
      requestId,
    }, {
      status: activeUploadError ? 503 : 410,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
  return new NextResponse(null, { status: 204, headers: { "X-Yova-Request-Id": requestId } });
}

// Downloads the just-uploaded private object on the server, validates it,
// extracts bounded text, and marks it ready for plan generation.
export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const mappingDeadlineAt = Date.now() + MATERIAL_MAPPING_ROUTE_BUDGET_MS;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before processing learning materials." }, { status: 401 });
  }

  const parsed = MaterialProcessRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "YOVA could not identify this material." }, { status: 422 });

  const { data: upload, error: uploadError } = await supabase
    .from("material_uploads")
    .select("id,filename,storage_path,mime_type,byte_size,processing_status,metadata,expires_at")
    .eq("id", parsed.data.materialId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (uploadError) return NextResponse.json({ error: "YOVA could not load this material." }, { status: 500 });
  if (!upload) return NextResponse.json({
    error: "That pending material expired or is no longer available. Add it again.",
    code: "material_staging_expired",
  }, { status: 410 });

  let readyUpload: { extracted_text: string; metadata: unknown } | null = null;
  if (upload.processing_status === "ready") {
    const { data, error: readyError } = await supabase
      .from("material_uploads")
      .select("extracted_text,metadata")
      .eq("id", upload.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (readyError) {
      return NextResponse.json({ error: "YOVA could not reload this material." }, { status: 500 });
    }
    if (!data?.extracted_text) return NextResponse.json({
      error: "That pending material expired before YOVA could finish it. Add it again.",
      code: "material_staging_expired",
    }, { status: 410 });
    readyUpload = { extracted_text: data.extracted_text, metadata: data.metadata };
    if (hasDurableMaterialMapping(readyUpload.metadata)) {
      return NextResponse.json(materialResponse(upload, readyUpload.extracted_text, readyUpload.metadata), {
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }
  }

  // The material id is stable across duplicate PATCH requests. The durable AI
  // reservation's owner/action/operation-key uniqueness therefore acts as a
  // cross-instance single-flight lease before either PDF recovery or mapping
  // can contact OpenAI.
  const recoveryKey = crypto.randomUUID();
  let reservation: Awaited<ReturnType<typeof reserveAIRequest>>;
  try {
    reservation = await reserveAIRequest(
      supabase,
      "material_processing",
      upload.id,
      recoveryKey,
    );
  } catch (error) {
    await recoverUnknownMaterialReservation(supabase, upload.id, recoveryKey);
    console.error("YOVA paused material processing before provider work", {
      requestId,
      materialId: upload.id,
      reason: "ai_usage_gate",
    });
    // A stable material operation key is terminal after recovery. Cancel the
    // staged copy so the learner is never left with an upload that cannot be
    // safely retried under a new id.
    return materialProcessingFailureResponse({ supabase, upload, requestId, error });
  }
  if (!reservation.allowed) {
    const conflict = aiUsageReservationConflict(reservation);
    if (conflict) {
      return NextResponse.json({
        code: conflict.code,
        error: conflict.error,
        retryable: conflict.retryable,
        requestId,
      }, {
        status: 409,
        headers: {
          "Cache-Control": "no-store",
          ...(conflict.retryAfterSeconds === null ? {} : {
            "Retry-After": String(conflict.retryAfterSeconds),
          }),
          "X-Yova-Request-Id": requestId,
        },
      });
    }
    return NextResponse.json({
      error: "This account has reached its material-processing allowance. Try again after the allowance resets.",
      code: "material_processing_allowance_exhausted",
      retryable: true,
      requestId,
    }, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(reservation.retryAfterSeconds),
        "X-Yova-Request-Id": requestId,
      },
    });
  }

  let providerAllowanceConsumed = false;
  try {
    if (readyUpload) {
      providerAllowanceConsumed = await consumeMaterialClaim(
        supabase,
        reservation.claimId,
        requestId,
      );
      if (!providerAllowanceConsumed) {
        throw new Error("Material AI allowance settlement could not be confirmed.");
      }
      await mapAndPersistMaterialWithConsumedAIUsage({
        supabase,
        materialId: upload.id,
        filename: upload.filename,
        text: readyUpload.extracted_text,
        deadlineAt: mappingDeadlineAt,
      });
      return NextResponse.json(materialResponse(upload, readyUpload.extracted_text, readyUpload.metadata), {
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }

    const { data: storedFile, error: downloadError } = await supabase.storage
      .from("learning-materials")
      .download(upload.storage_path);
    if (downloadError || !storedFile) throw new Error("Stored file unavailable");

    const bytes = new Uint8Array(await storedFile.arrayBuffer());
    if (bytes.byteLength !== Number(upload.byte_size)) throw new MaterialExtractionError("The uploaded file size did not match the selected file.");

    // PDF recovery can contact OpenAI from inside the extraction helper. For
    // text formats, local extraction remains free and can still release the
    // reservation if it fails before the mapper is reached.
    if (upload.mime_type === "application/pdf") {
      providerAllowanceConsumed = await consumeMaterialClaim(
        supabase,
        reservation.claimId,
        requestId,
      );
      if (!providerAllowanceConsumed) {
        throw new Error("Material AI allowance settlement could not be confirmed.");
      }
    }
    const { extracted, aiAssistedExtraction } = await extractMaterialWithRecovery(
      bytes,
      upload.mime_type as SupportedMimeType,
      upload.filename,
    );
    const priorMetadata = upload.metadata && typeof upload.metadata === "object" && !Array.isArray(upload.metadata)
      ? upload.metadata as Record<string, unknown>
      : {};
    const metadata = {
      ...priorMetadata,
      pageCount: extracted.pages,
      textTruncated: extracted.truncated,
      aiAssistedExtraction,
      mappingStatus: "processing",
    };
    const { error: updateError } = await supabase
      .from("material_uploads")
      .update({ extracted_text: extracted.text, metadata })
      .eq("id", upload.id);
    if (updateError) throw new Error("Material update failed");

    // "Ready" is a complete contract: the extracted text, understanding and
    // source chunks all exist durably before the browser may attach the file.
    // This removes the race where attachment moved the staging row while an
    // after-response mapper was still trying to update it.
    if (!providerAllowanceConsumed) {
      providerAllowanceConsumed = await consumeMaterialClaim(
        supabase,
        reservation.claimId,
        requestId,
      );
      if (!providerAllowanceConsumed) {
        throw new Error("Material AI allowance settlement could not be confirmed.");
      }
    }
    await mapAndPersistMaterialWithConsumedAIUsage({
      supabase,
      materialId: upload.id,
      filename: upload.filename,
      text: extracted.text,
      deadlineAt: mappingDeadlineAt,
    });

    return NextResponse.json(materialResponse(upload, extracted.text, metadata), {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  } catch (error) {
    if (!providerAllowanceConsumed) {
      await refundFailedMaterialClaimBeforeProvider(supabase, reservation.claimId, requestId);
    }
    console.error("YOVA material processing failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
    return materialProcessingFailureResponse({ supabase, upload, requestId, error });
  }
}

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before removing learning materials." }, { status: 401 });
  }

  const parsed = MaterialDeleteRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "YOVA could not identify that material." }, { status: 422 });

  const result = await cancelStagedMaterial(supabase, parsed.data.materialId);
  if (result.status === "removed") {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
  if (result.status === "cleanup_pending") {
    return NextResponse.json({
      status: "cleanup_pending",
      code: "material_cleanup_pending",
      committed: true,
      cleanupPending: true,
      materialId: parsed.data.materialId,
      requestId,
    }, {
      status: 202,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
  if (result.status === "durable") {
    return NextResponse.json({
      error: "This material is already attached to a goal and cannot be removed as a pending upload.",
      code: "material_already_durable",
      committed: false,
      requestId,
    }, {
      status: 409,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
  return NextResponse.json({
    error: `YOVA could not confirm whether this pending material was cancelled. Do not add it again yet. Contact YOVA Support with reference ${requestId}.`,
    code: "material_cleanup_outcome_unconfirmed",
    committed: "unknown",
    materialId: parsed.data.materialId,
    requestId,
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function materialResponse(
  upload: { id: string; filename: string; mime_type: string; byte_size: number },
  extractedText: string,
  metadata: unknown,
) {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const truncated = record.textTruncated === true;
  const aiAssistedExtraction = record.aiAssistedExtraction === true;
  const quality = assessMaterialQuality(extractedText, truncated);
  const responseQuality = quality.status === "unusable" ? "limited" : quality.status;
  return MaterialUploadResponseSchema.parse({
    material: {
      id: upload.id,
      name: upload.filename,
      mimeType: upload.mime_type,
      sizeBytes: Number(upload.byte_size),
      textContent: null,
      processingStatus: "ready",
    },
    extraction: {
      characters: extractedText.length,
      words: quality.wordCount,
      pages: typeof record.pageCount === "number" ? record.pageCount : null,
      truncated,
      quality: responseQuality,
      notice: aiAssistedExtraction
        ? "YOVA used AI to read this PDF after the private text reader could not finish. Review the generated plan against the original document before relying on it."
        : quality.notice,
    },
  });
}

function resolveMimeType(name: string, suppliedMimeType: string): SupportedMimeType | null {
  const extension = name.split(".").pop()?.toLowerCase();
  const genericType = !suppliedMimeType || suppliedMimeType === "application/octet-stream";
  if (extension === "pdf" && (genericType || suppliedMimeType === "application/pdf")) return "application/pdf";
  if (extension === "txt" && (genericType || suppliedMimeType === "text/plain")) return "text/plain";
  if ((extension === "md" || extension === "markdown") && (genericType || suppliedMimeType === "text/plain" || suppliedMimeType === "text/markdown")) return "text/markdown";
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function hasDurableMaterialMapping(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.mappingStatus === "ready"
    && MaterialUnderstandingSchema.safeParse(record.materialUnderstanding).success;
}

async function materialProcessingFailureResponse({
  supabase,
  upload,
  requestId,
  error,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  upload: { id: string; storage_path: string };
  requestId: string;
  error: unknown;
}) {
  const cleanup = await cancelStagedMaterial(supabase, upload.id);
  const isExtractionError = error instanceof MaterialExtractionError;

  if (cleanup.status === "outcome_unconfirmed" || cleanup.status === "durable") {
    return NextResponse.json({
      error: `YOVA could not finish this material or confirm whether its pending copy was cancelled. Do not add it again yet. Contact YOVA Support with reference ${requestId}.`,
      code: "material_processing_cleanup_outcome_unconfirmed",
      committed: "unknown",
      materialId: upload.id,
      requestId,
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }

  return NextResponse.json({
    error: isExtractionError
      ? cleanup.status === "cleanup_pending"
        ? `${error.message} The pending copy was cancelled and private cleanup will finish automatically.`
        : error.message
      : cleanup.status === "cleanup_pending"
        ? "YOVA could not map this file. Its pending copy was cancelled and private cleanup will finish automatically, so it is safe to add the file again."
        : "YOVA could not map this file into reliable source sections. The incomplete upload was removed, so it is safe to add the file again.",
    code: isExtractionError
      ? cleanup.status === "cleanup_pending"
        ? "material_extraction_failed_cleanup_pending"
        : "material_extraction_failed_rolled_back"
      : cleanup.status === "cleanup_pending"
        ? "material_mapping_failed_cleanup_pending"
        : "material_mapping_failed_rolled_back",
    retryable: true,
    ...(cleanup.status === "cleanup_pending" ? { committed: true, cleanupPending: true } : {}),
    requestId,
  }, {
    status: isExtractionError ? 422 : 503,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

async function consumeMaterialClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    const consumed = await settleAIRequestClaim(supabase, claimId);
    if (!consumed) {
      console.error("YOVA could not settle a material-processing allowance claim", { requestId });
    }
    return consumed;
  } catch {
    console.error("YOVA could not settle a material-processing allowance claim", { requestId });
    return false;
  }
}

async function refundFailedMaterialClaimBeforeProvider(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    await refundAIRequestClaimBeforeProvider(supabase, claimId);
  } catch {
    console.error("YOVA could not refund a pre-provider material-processing allowance claim", { requestId });
  }
}

async function recoverUnknownMaterialReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(
      supabase,
      "material_processing",
      operationKey,
      recoveryKey,
    );
  } catch {
    // If recovery cannot be confirmed, lease expiry conservatively consumes
    // the attempt so an ambiguous provider charge can never be refunded.
  }
}

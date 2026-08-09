import { after, NextResponse } from "next/server";
import { MaterialExtractionError } from "@/lib/materials/extract";
import { extractMaterialWithRecovery } from "@/lib/materials/extract-with-recovery";
import { assessMaterialQuality } from "@/lib/materials/quality";
import { materialStoragePath, sanitizeMaterialDisplayName } from "@/lib/materials/filename";
import { storePrivateMaterial } from "@/lib/materials/storage-upload";
import { mapAndPersistMaterial } from "@/lib/materials/material-understanding";
import {
  MaterialDeleteRequestSchema,
  MaterialProcessRequestSchema,
  MaterialStageRequestSchema,
  MaterialStageResponseSchema,
  MaterialUploadResponseSchema,
} from "@/lib/materials/schema";
import { checkMaterialUploadRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
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
  const { error: insertError } = await supabase.from("material_uploads").insert({
    id: materialId,
    user_id: user.id,
    filename: safeName,
    storage_path: storagePath,
    mime_type: mimeType,
    byte_size: parsed.data.sizeBytes,
    processing_status: "processing",
    metadata: { originalFilename: parsed.data.name.slice(0, 180) },
  });

  if (insertError) {
    console.error("YOVA material staging failed", { requestId, reason: "database_insert" });
    return NextResponse.json({ error: "YOVA could not prepare a secure upload.", requestId }, { status: 500, headers: { "X-Yova-Request-Id": requestId } });
  }

  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from("learning-materials")
    .createSignedUploadUrl(storagePath);
  if (signedUploadError || !signedUpload?.token) {
    await supabase.from("material_uploads").delete().eq("id", materialId);
    console.error("YOVA material staging failed", { requestId, reason: "signed_upload" });
    return NextResponse.json({ error: "YOVA could not prepare a secure upload.", requestId }, { status: 500, headers: { "X-Yova-Request-Id": requestId } });
  }

  return NextResponse.json(MaterialStageResponseSchema.parse({
    materialId,
    storagePath,
    token: signedUpload.token,
    mimeType,
  }), { headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
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
    .select("storage_path,mime_type,byte_size")
    .eq("id", materialId)
    .maybeSingle();
  if (uploadError || !upload) return NextResponse.json({ error: "That staged upload was not found." }, { status: 404 });
  if (Number(upload.byte_size) !== file.size) return NextResponse.json({ error: "The selected file changed before upload." }, { status: 422 });

  const stored = await storePrivateMaterial(
    supabase.storage.from("learning-materials"),
    upload.storage_path,
    file,
    upload.mime_type,
  );
  if (!stored.ok) {
    console.error("YOVA same-origin material upload failed", { requestId, reason: stored.reason });
    return NextResponse.json(
      { error: "YOVA could not securely upload this file. Try again before exporting or changing the document.", requestId },
      { status: 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
  return new NextResponse(null, { status: 204, headers: { "X-Yova-Request-Id": requestId } });
}

// Downloads the just-uploaded private object on the server, validates it,
// extracts bounded text, and marks it ready for plan generation.
export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before processing learning materials." }, { status: 401 });
  }

  const parsed = MaterialProcessRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "YOVA could not identify this material." }, { status: 422 });

  const { data: upload, error: uploadError } = await supabase
    .from("material_uploads")
    .select("id,filename,storage_path,mime_type,byte_size,processing_status,metadata")
    .eq("id", parsed.data.materialId)
    .maybeSingle();
  if (uploadError) return NextResponse.json({ error: "YOVA could not load this material." }, { status: 500 });
  if (!upload) return NextResponse.json({ error: "That staged material was not found." }, { status: 404 });

  if (upload.processing_status === "ready") {
    const { data: readyUpload, error: readyError } = await supabase
      .from("material_uploads")
      .select("extracted_text,metadata")
      .eq("id", upload.id)
      .maybeSingle();
    if (readyError || !readyUpload?.extracted_text) {
      return NextResponse.json({ error: "YOVA could not reload this material." }, { status: 500 });
    }
    return NextResponse.json(materialResponse(upload, readyUpload.extracted_text, readyUpload.metadata));
  }

  try {
    const { data: storedFile, error: downloadError } = await supabase.storage
      .from("learning-materials")
      .download(upload.storage_path);
    if (downloadError || !storedFile) throw new Error("Stored file unavailable");

    const bytes = new Uint8Array(await storedFile.arrayBuffer());
    if (bytes.byteLength !== Number(upload.byte_size)) throw new MaterialExtractionError("The uploaded file size did not match the selected file.");

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
      .update({ processing_status: "ready", extracted_text: extracted.text, metadata })
      .eq("id", upload.id);
    if (updateError) throw new Error("Material update failed");

    // File reading is the blocking promise the learner is waiting for. Topic
    // mapping continues after the response and is also recoverable from plan
    // generation if the learner moves faster than this background pass.
    after(async () => {
      await mapAndPersistMaterial({
        supabase,
        userId: user.id,
        materialId: upload.id,
        filename: upload.filename,
        text: extracted.text,
      }).catch((mappingError) => {
        console.error("YOVA material mapping failed", {
          requestId,
          reason: mappingError instanceof Error ? mappingError.name : "unknown",
        });
      });
    });

    return NextResponse.json(materialResponse(upload, extracted.text, metadata), {
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  } catch (error) {
    console.error("YOVA material processing failed", {
      requestId,
      reason: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
    await Promise.all([
      supabase.storage.from("learning-materials").remove([upload.storage_path]),
      supabase.from("material_uploads").delete().eq("id", upload.id),
    ]);
    const isExtractionError = error instanceof MaterialExtractionError;
    return NextResponse.json(
      { error: isExtractionError ? error.message : "YOVA could not process this file. Try again.", requestId },
      { status: isExtractionError ? 422 : 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } },
    );
  }
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before removing learning materials." }, { status: 401 });
  }

  const parsed = MaterialDeleteRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "YOVA could not identify that material." }, { status: 422 });

  const { data: upload, error: uploadError } = await supabase
    .from("material_uploads")
    .select("storage_path")
    .eq("id", parsed.data.materialId)
    .maybeSingle();
  if (uploadError) return NextResponse.json({ error: "YOVA could not load that material." }, { status: 500 });
  if (!upload) return NextResponse.json({ error: "That staged material was not found." }, { status: 404 });

  const { error: storageError } = await supabase.storage.from("learning-materials").remove([upload.storage_path]);
  if (storageError) return NextResponse.json({ error: "YOVA could not remove the stored file." }, { status: 500 });

  const { error: deleteError } = await supabase.from("material_uploads").delete().eq("id", parsed.data.materialId);
  if (deleteError) return NextResponse.json({ error: "YOVA could not finish removing that file." }, { status: 500 });

  return new NextResponse(null, { status: 204 });
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

import { NextResponse } from "next/server";
import { fetchArticleSource, fetchYouTubeTitle, ExternalSourceError } from "@/lib/materials/external-fetch";
import {
  ExternalMaterialReadyResponseSchema,
  ExternalMaterialRequestSchema,
  ExternalMaterialSourceSchema,
  ExternalMaterialTranscriptResponseSchema,
} from "@/lib/materials/external-source-schema";
import { buildExternalMaterialFilename, parseYouTubeSource } from "@/lib/materials/external-source";
import { assessMaterialQuality } from "@/lib/materials/quality";
import { MAX_EXTRACTED_CHARACTERS } from "@/lib/materials/extract";
import {
  MATERIAL_MAPPING_ROUTE_BUDGET_MS,
  mapAndPersistMaterial,
} from "@/lib/materials/material-understanding";
import { cancelStagedMaterial } from "@/lib/materials/staged-cleanup";
import { checkMaterialUploadRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const mappingDeadlineAt = Date.now() + MATERIAL_MAPPING_ROUTE_BUDGET_MS;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before adding learning materials." }, { status: 401 });
  }

  const rateLimit = checkMaterialUploadRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many materials were added at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const parsed = ExternalMaterialRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a public article or YouTube URL. Pasted transcripts need at least a few complete sentences." }, { status: 422 });
  }

  try {
    const youtube = parseYouTubeSource(parsed.data.url);
    let kind: "article" | "youtube";
    let title: string;
    let canonicalUrl: string;
    let text: string;
    let truncated = false;

    if (youtube) {
      kind = "youtube";
      canonicalUrl = youtube.canonicalUrl;
      title = await fetchYouTubeTitle(canonicalUrl);
      if (!parsed.data.transcript) {
        return NextResponse.json(ExternalMaterialTranscriptResponseSchema.parse({
          status: "transcript_required",
          source: { kind, title, url: canonicalUrl },
          instructions: "Open the video on YouTube, choose Show transcript, copy the transcript, and paste it here. YOVA will use the video title and transcript together.",
        }), { headers: { "Cache-Control": "no-store" } });
      }
      text = parsed.data.transcript.trim().slice(0, MAX_EXTRACTED_CHARACTERS);
      truncated = parsed.data.transcript.trim().length > MAX_EXTRACTED_CHARACTERS;
    } else {
      if (parsed.data.transcript) throw new ExternalSourceError("The transcript field can only be used with a YouTube link.");
      kind = "article";
      const article = await fetchArticleSource(parsed.data.url);
      title = article.title;
      canonicalUrl = article.canonicalUrl;
      text = article.text;
      truncated = article.truncated;
    }

    const quality = assessMaterialQuality(text, truncated);
    if (quality.status === "unusable") {
      throw new ExternalSourceError(kind === "article"
        ? "YOVA could not find enough readable article text. Try the article's print view, upload a PDF, or paste notes."
        : "That transcript does not contain enough readable learning content yet.");
    }

    // Redirects and fetched metadata are untrusted inputs too. Validate the
    // canonical source before creating either the storage object or database
    // row, while leaving construction of the Ready response until mapping has
    // durably completed.
    const source = ExternalMaterialSourceSchema.parse({ kind, title, url: canonicalUrl });

    const materialId = crypto.randomUUID();
    const filename = buildExternalMaterialFilename(kind, title);
    const storagePath = `${user.id}/${materialId}/${filename}`;
    const bytes = new TextEncoder().encode(text);
    const metadata = {
      sourceKind: kind,
      sourceTitle: title,
      sourceUrl: canonicalUrl,
      textTruncated: truncated,
      importedAt: new Date().toISOString(),
      mappingStatus: "processing",
    };
    const { data: staged, error: insertError } = await supabase.rpc("create_material_upload", {
      payload: {
        id: materialId,
        filename,
        storagePath,
        mimeType: "text/plain",
        byteSize: bytes.byteLength,
        processingStatus: "processing",
        extractedText: text,
        metadata,
      },
    });
    if (insertError || staged !== true) throw new Error("External material record failed");

    // Create the leased staging record before Storage. If Storage fails, the
    // same cancellation path used by explicit abandonment can expire the row
    // immediately and let the cron retry exact cleanup without an orphan.
    const { error: storageError } = await supabase.storage
      .from("learning-materials")
      .upload(storagePath, bytes, { contentType: "text/plain", upsert: false });
    if (storageError) {
      const cleanup = await cancelStagedMaterial(supabase, materialId);
      if (cleanup.status === "outcome_unconfirmed" || cleanup.status === "durable") {
        return NextResponse.json({
          error: `YOVA could not store this source or confirm whether its pending copy was cancelled. Do not add it again yet. Contact YOVA Support with reference ${requestId}.`,
          code: "external_material_storage_cleanup_outcome_unconfirmed",
          committed: "unknown",
          materialId,
          requestId,
        }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        });
      }
      throw new Error("External material storage failed");
    }

    try {
      // A linked source is not Ready until its understanding and exact source
      // chunks are durable. This keeps plan attachment from racing a deferred
      // mapper and makes the response's state truthful.
      await mapAndPersistMaterial({
        supabase,
        materialId,
        filename,
        text,
        deadlineAt: mappingDeadlineAt,
      });

      // Build a Ready response only after the mapping transaction has stored
      // every chunk and atomically advanced processing_status to ready.
      const readyPayload = ExternalMaterialReadyResponseSchema.parse({
        status: "ready",
          source,
        material: {
          id: materialId,
          name: filename,
          mimeType: "text/plain",
          sizeBytes: bytes.byteLength,
          textContent: null,
          processingStatus: "ready",
        },
        extraction: {
          characters: text.length,
          words: quality.wordCount,
          pages: null,
          truncated,
          quality: quality.status,
          notice: quality.notice,
        },
      });
      return new NextResponse(JSON.stringify(readyPayload), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "X-Yova-Request-Id": requestId,
        },
      });
    } catch (mappingError) {
      console.error("YOVA external material mapping failed", {
        requestId,
        materialId,
        reason: mappingError instanceof Error ? mappingError.name : "unknown",
      });
      const cleanup = await cancelStagedMaterial(supabase, materialId);
      if (cleanup.status === "removed") {
        return NextResponse.json({
          error: "YOVA could not map this source into reliable sections. The incomplete import was removed, so it is safe to try again.",
          code: "external_material_mapping_failed_rolled_back",
          retryable: true,
          requestId,
        }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        });
      }
      if (cleanup.status === "cleanup_pending") {
        return NextResponse.json({
          error: "YOVA could not map this source. Its pending copy was cancelled and private cleanup will finish automatically, so it is safe to try again.",
          code: "external_material_mapping_failed_cleanup_pending",
          committed: true,
          cleanupPending: true,
          retryable: true,
          requestId,
        }, {
          status: 503,
          headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
        });
      }
      return NextResponse.json({
        error: `YOVA could not finish this source or confirm whether its pending copy was cancelled. Do not add it again yet. Contact YOVA Support with reference ${requestId}.`,
        code: "external_material_mapping_cleanup_outcome_unconfirmed",
        committed: "unknown",
        materialId,
        requestId,
      }, {
        status: 500,
        headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
      });
    }

  } catch (error) {
    console.error("YOVA external material import failed", { requestId, reason: error instanceof Error ? error.name : "unknown" });
    const expected = error instanceof ExternalSourceError;
    return NextResponse.json({
      error: expected ? error.message : "YOVA could not import this link. Try again or add the material another way.",
      requestId,
    }, { status: expected ? 422 : 500, headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

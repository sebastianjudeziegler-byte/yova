import { after, NextResponse } from "next/server";
import { fetchArticleSource, fetchYouTubeTitle, ExternalSourceError } from "@/lib/materials/external-fetch";
import {
  ExternalMaterialReadyResponseSchema,
  ExternalMaterialRequestSchema,
  ExternalMaterialTranscriptResponseSchema,
} from "@/lib/materials/external-source-schema";
import { buildExternalMaterialFilename, parseYouTubeSource } from "@/lib/materials/external-source";
import { assessMaterialQuality } from "@/lib/materials/quality";
import { MAX_EXTRACTED_CHARACTERS } from "@/lib/materials/extract";
import { mapAndPersistMaterial } from "@/lib/materials/material-understanding";
import { checkMaterialUploadRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const { error: storageError } = await supabase.storage
      .from("learning-materials")
      .upload(storagePath, bytes, { contentType: "text/plain", upsert: false });
    if (storageError) throw new Error("External material storage failed");

    const { error: insertError } = await supabase.from("material_uploads").insert({
      id: materialId,
      user_id: user.id,
      filename,
      storage_path: storagePath,
      mime_type: "text/plain",
      byte_size: bytes.byteLength,
      processing_status: "ready",
      extracted_text: text,
      metadata,
    });
    if (insertError) {
      await supabase.storage.from("learning-materials").remove([storagePath]);
      throw new Error("External material record failed");
    }

    after(async () => {
      await mapAndPersistMaterial({
        supabase,
        materialId,
        filename,
        text,
      }).catch((mappingError) => {
        console.error("YOVA external material mapping failed", {
          requestId,
          reason: mappingError instanceof Error ? mappingError.name : "unknown",
        });
      });
    });

    return NextResponse.json(ExternalMaterialReadyResponseSchema.parse({
      status: "ready",
      source: { kind, title, url: canonicalUrl },
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
    }), { headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId } });
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

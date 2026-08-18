import "server-only";

export const STUDY_PROFILE_RESPONSE_MAX_BYTES = 32_768;
export const STUDY_PROFILE_EVENT_MAX_BYTES = 8_192;
export const STUDY_PROFILE_INTEREST_MAX_BYTES = 2_048;

export type StudyProfileRequestGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 415; message: string };

export type StudyProfileBoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid_json" | "too_large" };

/**
 * Blocks browser cross-site writes and simple-form/no-CORS submissions. Requests
 * without browser provenance headers remain available to trusted server tools;
 * they must still use application/json and pass the route's rate limits.
 */
export function validateStudyProfileJsonPostRequest(
  request: Request,
): StudyProfileRequestGuardResult {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      status: 415,
      message: "Study Profile requests must use application/json.",
    };
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return {
      ok: false,
      status: 403,
      message: "Cross-origin Study Profile requests are not allowed.",
    };
  }

  const origin = request.headers.get("origin")?.trim();
  if (!origin) return { ok: true };

  try {
    const submittedOrigin = new URL(origin).origin;
    if (requestOrigins(request).has(submittedOrigin)) {
      return { ok: true };
    }
  } catch {
    // Invalid and opaque origins are never accepted for a browser write.
  }

  return {
    ok: false,
    status: 403,
    message: "Cross-origin Study Profile requests are not allowed.",
  };
}

/**
 * Next can expose an internal request URL while a reverse proxy preserves the
 * browser-facing origin in forwarded/Host headers. Compare against both forms
 * so legitimate same-origin writes survive Vercel and local proxying.
 */
function requestOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin]);
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, "");

  if (host && (protocol === "http" || protocol === "https")) {
    try {
      origins.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      // Invalid proxy metadata cannot expand the accepted origin set.
    }
  }

  return origins;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() || null;
}

/** Reads and parses JSON while enforcing the limit on bytes actually streamed. */
export async function readStudyProfileBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<StudyProfileBoundedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !request.body) {
    return { ok: false, reason: "invalid_json" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

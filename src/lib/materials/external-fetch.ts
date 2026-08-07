import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractReadableArticle } from "@/lib/materials/external-source";

const MAX_REMOTE_BYTES = 2 * 1024 * 1024;

export class ExternalSourceError extends Error {}

export async function fetchArticleSource(value: string) {
  const startingUrl = await validatePublicUrl(value);
  let currentUrl = startingUrl;

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "YOVA-Learning-Material/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new ExternalSourceError("This article redirected too many times.");
      currentUrl = await validatePublicUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) throw new ExternalSourceError("YOVA could not open this public article.");

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new ExternalSourceError("This link is not a readable article page. Try the article itself or upload a PDF.");
    }
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > MAX_REMOTE_BYTES) throw new ExternalSourceError("This article page is too large to import safely.");
    const html = await readBoundedText(response);
    const article = contentType.includes("text/plain")
      ? { title: currentUrl.hostname, text: html.slice(0, 50_000), truncated: html.length > 50_000 }
      : extractReadableArticle(html, currentUrl.toString());
    return { ...article, canonicalUrl: currentUrl.toString() };
  }
  throw new ExternalSourceError("YOVA could not follow this article link.");
}

export async function fetchYouTubeTitle(canonicalUrl: string) {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", canonicalUrl);
  endpoint.searchParams.set("format", "json");
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new ExternalSourceError("YOVA could not read this YouTube video title.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("title" in body) || typeof body.title !== "string") {
    throw new ExternalSourceError("YOVA could not verify this YouTube video.");
  }
  return body.title.trim().slice(0, 180) || "YouTube video";
}

async function validatePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExternalSourceError("Enter a complete public article URL.");
  }
  if (url.protocol !== "https:") throw new ExternalSourceError("For safety, article links must use HTTPS.");
  if (url.username || url.password || url.port) throw new ExternalSourceError("This article URL is not supported.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new ExternalSourceError("Private network links cannot be imported.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ExternalSourceError("YOVA could not verify this as a public article link.");
  }
  return url;
}

function isPrivateAddress(address: string) {
  if (!isIP(address)) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function readBoundedText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_BYTES) {
      await reader.cancel();
      throw new ExternalSourceError("This article page is too large to import safely.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export type ParsedYouTubeSource = {
  videoId: string;
  canonicalUrl: string;
};

export function parseYouTubeSource(value: string): ParsedYouTubeSource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(hostname)) return null;

  let videoId = "";
  if (hostname === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
  else if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? "";
  else {
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0] ?? "")) videoId = parts[1] ?? "";
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export function extractReadableArticle(html: string, sourceUrl: string) {
  const title = decodeHtmlEntities(
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i)
      ?? firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i)
      ?? firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
      ?? new URL(sourceUrl).hostname,
  ).replace(/\s+/g, " ").trim().slice(0, 180);

  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|template|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const main = firstMatch(withoutNoise, /<article[^>]*>([\s\S]*?)<\/article>/i)
    ?? firstMatch(withoutNoise, /<main[^>]*>([\s\S]*?)<\/main>/i)
    ?? firstMatch(withoutNoise, /<body[^>]*>([\s\S]*?)<\/body>/i)
    ?? withoutNoise;
  const text = decodeHtmlEntities(
    main
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: title || "Article", text: text.slice(0, 50_000), truncated: text.length > 50_000 };
}

export function buildExternalMaterialFilename(kind: "article" | "youtube", title: string) {
  const safeTitle = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || (kind === "youtube" ? "YouTube transcript" : "Article");
  return `${safeTitle}.txt`;
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() ?? null;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", hellip: "…", ldquo: "“", lsquo: "‘",
    lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: '"', rdquo: "”", rsquo: "’",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const hex = code[1]?.toLowerCase() === "x";
      const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      const validCodePoint = Number.isInteger(number) && number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff);
      return validCodePoint ? String.fromCodePoint(number) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

import { describe, expect, it } from "vitest";
import { buildExternalMaterialFilename, extractReadableArticle, parseYouTubeSource } from "@/lib/materials/external-source";

describe("external learning sources", () => {
  it("accepts common YouTube URL forms and canonicalizes them", () => {
    expect(parseYouTubeSource("https://youtu.be/dQw4w9WgXcQ")?.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parseYouTubeSource("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.videoId).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeSource("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("extracts the article body and removes page chrome", () => {
    const result = extractReadableArticle(`<!doctype html><html><head><title>Energy systems</title><style>.x{}</style></head><body><nav>Menu</nav><article><h1>Energy systems</h1><p>Cells transfer energy through several linked processes.</p><p>This paragraph contains the learning content students need.</p></article><footer>Legal</footer></body></html>`, "https://example.com/energy");
    expect(result.title).toBe("Energy systems");
    expect(result.text).toContain("Cells transfer energy");
    expect(result.text).not.toContain("Menu");
    expect(result.text).not.toContain("Legal");
  });

  it("creates a safe text filename", () => {
    expect(buildExternalMaterialFilename("article", "What / why: a guide?")).toBe("What why a guide.txt");
  });
});

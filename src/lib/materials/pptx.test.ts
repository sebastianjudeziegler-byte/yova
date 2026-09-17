import { readFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractPptxText, PptxExtractionError } from "@/lib/materials/pptx";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"`;
const MAIN_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";

function paragraph(...runs: string[]) {
  return `<a:p>${runs.map((text) => `<a:r><a:t>${text}</a:t></a:r>`).join("")}</a:p>`;
}

function shape(content: string, placeholder = "") {
  return `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${content}</p:txBody></p:sp>`;
}

function slide(content: string) {
  return `<p:sld ${NS}><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`;
}

function rels(content: string) {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
}

function relationship(id: string, type: string, target: string, external = false) {
  return `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
}

function deckParts(slides: string[], order = slides.map((_, index) => index + 1)): Record<string, string> {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="${MAIN_TYPE}"/></Types>`,
    "_rels/.rels": rels(relationship("root", "officeDocument", "ppt/presentation.xml")),
    "ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst>${order.map((number, index) => `<p:sldId id="${256 + index}" r:id="slide${number}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(slides.map((_, index) => relationship(`slide${index + 1}`, "slide", `slides/slide${index + 1}.xml`)).join("")),
    ...Object.fromEntries(slides.map((content, index) => [`ppt/slides/slide${index + 1}.xml`, slide(content)])),
  };
}

function zip(parts: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, content]) => [name, strToU8(content)])));
}

function changeEntry(bytes: Uint8Array, name: string, change: (view: DataView, central: number, local: number) => void) {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  let offset = view.getUint32(result.length - 22 + 16, true);
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    if (new TextDecoder().decode(result.subarray(offset + 46, offset + 46 + nameLength)) === name) {
      change(view, offset, view.getUint32(offset + 42, true));
      return result;
    }
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  throw new Error("Missing test entry");
}

describe("PowerPoint material extraction", () => {
  it("uses presentation relationships for slide order and joins text runs within paragraphs", () => {
    const parts = deckParts([
      shape(paragraph("Inter", "national ", "politics") + paragraph("Second paragraph &amp; evidence.")),
      shape(paragraph("The opening slide")),
    ], [2, 1]);

    expect(extractPptxText(zip(parts), 10_000)).toEqual({
      text: "[Slide 1]\nThe opening slide\n\n[Slide 2]\nInternational politics\nSecond paragraph & evidence.",
      pages: 2,
      truncated: false,
      notice: null,
    });
  });

  it("includes speaker notes and tables while excluding number and footer placeholders", () => {
    const parts = deckParts([
      shape(paragraph("Main slide"))
      + shape(paragraph("123"), "sldNum")
      + '<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody>' + paragraph("Table evidence") + "</a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>",
    ]);
    parts["ppt/slides/_rels/slide1.xml.rels"] = rels(relationship("notes", "notesSlide", "../notesSlides/notesSlide1.xml"));
    parts["ppt/notesSlides/notesSlide1.xml"] = `<p:notes ${NS}><p:cSld><p:spTree>${
      shape(paragraph("Explain ", "sovereignty."), "body")
      + shape(paragraph("456"), "sldNum")
      + shape(paragraph("Footer should not appear"), "ftr")
      + shape('<a:p><a:fld type="slidenum"><a:t>789</a:t></a:fld></a:p>')
    }</p:spTree></p:cSld></p:notes>`;

    expect(extractPptxText(zip(parts), 10_000).text).toBe("[Slide 1]\nMain slide\nTable evidence\n\nSpeaker notes:\nExplain sovereignty.");
  });

  it("preserves explicit line breaks, numeric text, and XML character entities", () => {
    const parts = deckParts([shape('<a:p><a:r><a:t>1900</a:t></a:r><a:br/><a:r><a:t>War &#38; peace &#x2014; &#169;</a:t></a:r></a:p>')]);
    expect(extractPptxText(zip(parts), 10_000).text).toBe("[Slide 1]\n1900\nWar & peace — ©");
  });

  it("decodes entities once and preserves literal entities and CDATA text", () => {
    const parts = deckParts([shape(paragraph("Literal &amp;#38; &amp;amp; &#x1f30d;") + '<a:p><a:r><a:t><![CDATA[Literal &#38; in CDATA]]></a:t></a:r></a:p>')]);
    expect(extractPptxText(zip(parts), 10_000).text).toBe("[Slide 1]\nLiteral &#38; &amp; 🌍\nLiteral &#38; in CDATA");
  });

  it("allows text in speaker notes when slides are images", () => {
    const parts = deckParts(["<p:pic/>"]);
    parts["ppt/slides/_rels/slide1.xml.rels"] = rels(relationship("notes", "notesSlide", "../notesSlides/notesSlide1.xml"));
    parts["ppt/notesSlides/notesSlide1.xml"] = `<p:notes ${NS}>${shape(paragraph("An explanation of the diagram"), "body")}</p:notes>`;
    const result = extractPptxText(zip(parts), 10_000);
    expect(result.text).toContain("Speaker notes:\nAn explanation of the diagram");
    expect(result.notice).toContain("Images, charts, and linked videos");
  });

  it("gives image-only decks an actionable PDF fallback", () => {
    expect(() => extractPptxText(zip(deckParts(["<p:pic/>"])), 10_000)).toThrow(/Export this PowerPoint to PDF and upload the PDF/);
  });

  it("reports visual limitations without opening images, embedded content, or external links", () => {
    const parts = deckParts([shape(paragraph("Learning content")) + '<p:pic/><p:oleObj r:id="object"/>']);
    parts["ppt/slides/_rels/slide1.xml.rels"] = rels(
      relationship("image", "image", "../media/absent.png")
      + relationship("object", "oleObject", "https://example.invalid/embedded", true)
      + relationship("url", "hyperlink", "https://example.invalid/never-open", true),
    );
    const result = extractPptxText(zip(parts), 10_000);
    expect(result.text).toBe("[Slide 1]\nLearning content");
    expect(result.notice).toContain("add notes or a transcript");
  });

  it("limits the complete output including slide labels and separators", () => {
    const archive = zip(deckParts([shape(paragraph("A".repeat(80))), shape(paragraph("B".repeat(80)))]));
    const complete = extractPptxText(archive, 1_000);
    const result = extractPptxText(archive, 105);
    expect(result.text).toBe(complete.text.slice(0, 105));
    expect(result.text).toHaveLength(105);
    expect(result.truncated).toBe(true);
    expect(result.pages).toBe(2);
    expect(extractPptxText(archive, complete.text.length).truncated).toBe(false);
  });

  it("bounds the number of slides while reporting the full slide count", () => {
    const result = extractPptxText(zip(deckParts(Array.from({ length: 301 }, () => shape(paragraph("Slide content"))))), 100_000);
    expect(result.pages).toBe(301);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[Slide 300]");
    expect(result.text).not.toContain("[Slide 301]");
  });

  it.each([
    ["an invalid ZIP", new Uint8Array([1, 2, 3])],
    ["an encrypted Office container", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
    ["a ZIP which is not a presentation", zip({ "other.xml": "<root/>" })],
  ])("rejects %s with a user-facing error", (_, bytes) => {
    expect(() => extractPptxText(bytes, 10_000)).toThrow(PptxExtractionError);
  });

  it("rejects encrypted ZIP entries", () => {
    const archive = zip(deckParts([shape(paragraph("Text"))]));
    const encrypted = changeEntry(archive, "ppt/slides/slide1.xml", (view, central, local) => {
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true);
    });
    expect(() => extractPptxText(encrypted, 10_000)).toThrow(/encrypted/);
  });

  it("rejects damaged content using its ZIP checksum", () => {
    const archive = zip(deckParts([shape(paragraph("Text"))]));
    const damaged = changeEntry(archive, "ppt/slides/slide1.xml", (view, central, local) => {
      view.setUint32(central + 16, 12345, true);
      view.setUint32(local + 14, 12345, true);
    });
    expect(() => extractPptxText(damaged, 10_000)).toThrow(/could not read/);
  });

  it("rejects parts above the expanded-size limit before inflating them", () => {
    const archive = zip(deckParts([shape(paragraph("Text"))]));
    const huge = changeEntry(archive, "ppt/slides/slide1.xml", (view, central, local) => {
      view.setUint32(central + 24, 3 * 1024 * 1024, true);
      view.setUint32(local + 22, 3 * 1024 * 1024, true);
    });
    expect(() => extractPptxText(huge, 10_000)).toThrow(/too large or complex/);
  });

  it("bounds inflation even when a ZIP lies about its expanded size", () => {
    const archive = zip(deckParts([shape(paragraph("A".repeat(1_000_000)))]));
    const understated = changeEntry(archive, "ppt/slides/slide1.xml", (view, central, local) => {
      view.setUint32(central + 24, 64, true);
      view.setUint32(local + 22, 64, true);
    });
    expect(() => extractPptxText(understated, 10_000)).toThrow(/too large or complex/);
  });

  it.each([
    ["malformed XML", "<p:sld><unclosed></p:sld>"],
    ["DTDs", '<!DOCTYPE sld [<!ENTITY e "expansion">]><sld>&e;</sld>'],
    ["excessive nesting", `<sld>${"<x>".repeat(100)}text${"</x>".repeat(100)}</sld>`],
  ])("rejects %s", (_, content) => {
    const parts = deckParts([shape(paragraph("Text"))]);
    parts["ppt/slides/slide1.xml"] = content;
    expect(() => extractPptxText(zip(parts), 10_000)).toThrow(PptxExtractionError);
  });

  it.each(["https://example.invalid/slide.xml", "../../../outside.xml"])("rejects unsafe slide target %s", (target) => {
    const parts = deckParts([shape(paragraph("Text"))]);
    parts["ppt/_rels/presentation.xml.rels"] = rels(relationship("slide1", "slide", target));
    expect(() => extractPptxText(zip(parts), 10_000)).toThrow(PptxExtractionError);
  });

  it("rejects non-presentation and macro-enabled content types", () => {
    const parts = deckParts([shape(paragraph("Text"))]);
    parts["[Content_Types].xml"] = parts["[Content_Types].xml"].replace(MAIN_TYPE, "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml");
    expect(() => extractPptxText(zip(parts), 10_000)).toThrow(/save a .pptx copy/i);
  });

  // Optional local regression: supply the original 17-slide fixture without checking private course content into Git.
  it.skipIf(!process.env.YOVA_PPTX_FIXTURE)("extracts all slides from the supplied course deck", async () => {
    const bytes = await readFile(process.env.YOVA_PPTX_FIXTURE!);
    const result = extractPptxText(bytes, 288_000);
    expect(result.pages).toBe(17);
    expect(result.truncated).toBe(false);
    expect(result.text.match(/^\[Slide \d+\]$/gm)).toHaveLength(17);
    expect(result.text.length).toBeGreaterThan(1_000);
  });
});

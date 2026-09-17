import "server-only";

import { Inflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_PART_BYTES = 2 * 1024 * 1024;
const MAX_XML_BYTES = 24 * 1024 * 1024;
const MAX_SLIDES = 300;
const INVALID_FILE = "YOVA could not read this PowerPoint. Save a new .pptx copy in PowerPoint or export it to PDF, then upload it again.";
const TOO_COMPLEX = "This PowerPoint is too large or complex to read safely. Split it into smaller decks or export it to PDF and upload those files.";
const OFFICE_RELATIONSHIP = /^(?:http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/|http:\/\/purl\.oclc\.org\/ooxml\/officeDocument\/relationships\/)/;

type XmlNode = { ":@"?: Record<string, string>; "#text"?: string; [key: string]: unknown };
type ZipEntry = { name: string; start: number; compressedSize: number; size: number; method: number; crc: number };
type Relationship = { id: string; type: string; target: string; external: boolean };

export class PptxExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptxExtractionError";
  }
}

export type ExtractedPptx = { text: string; pages: number; truncated: boolean; notice: string | null };

/** Reads only package XML. Embedded files, pictures, macros, and external URLs are never opened. */
export function extractPptxText(bytes: Uint8Array, maxCharacters: number): ExtractedPptx {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new PptxExtractionError(INVALID_FILE);
  try {
    return extractPresentation(bytes, maxCharacters);
  } catch (error) {
    if (error instanceof PptxExtractionError) throw error;
    throw new PptxExtractionError(INVALID_FILE);
  }
}

function extractPresentation(bytes: Uint8Array, maxCharacters: number): ExtractedPptx {
  const entries = indexArchive(bytes);
  const cache = new Map<string, XmlNode[]>();
  let xmlBytes = 0;
  const readXml = (path: string): XmlNode[] => {
    const cached = cache.get(path);
    if (cached) return cached;
    const entry = entries.get(path);
    if (!entry) throw new PptxExtractionError(INVALID_FILE);
    xmlBytes += entry.size;
    if (entry.size > MAX_PART_BYTES || xmlBytes > MAX_XML_BYTES) throw new PptxExtractionError(TOO_COMPLEX);
    const xml = parseXml(inflateEntry(bytes, entry));
    cache.set(path, xml);
    return xml;
  };
  const rootRelationships = relationships(readXml("_rels/.rels"));
  const presentationRelationship = rootRelationships.find((rel) => isRelationship(rel, "officeDocument"));
  if (!presentationRelationship || presentationRelationship.external) throw new PptxExtractionError(INVALID_FILE);
  const presentationPath = resolvePart("", presentationRelationship.target);
  const contentTypes = readXml("[Content_Types].xml");
  const isPresentation = [...descendants(contentTypes, "Override")].some((node) => (
    attribute(node, "PartName") === `/${presentationPath}`
    && attribute(node, "ContentType") === "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
  ));
  if (!isPresentation) throw new PptxExtractionError("Upload a .pptx PowerPoint file. For older or macro-enabled presentations, save a .pptx copy or export to PDF first.");

  const presentation = readXml(presentationPath);
  const slideList = [...descendants(presentation, "sldIdLst")][0];
  const slideIds = slideList ? children(slideList).filter((node) => tag(node) === "sldId") : [];
  if (!slideIds.length) throw new PptxExtractionError("This PowerPoint does not contain any slides.");
  const presentationRels = relationships(readXml(relationshipPath(presentationPath)));
  const parts: string[] = [];
  let characters = 0;
  let readableCharacters = 0;
  let hasVisuals = false;
  let truncated = slideIds.length > MAX_SLIDES;

  for (let index = 0; index < Math.min(slideIds.length, MAX_SLIDES); index += 1) {
    const id = attribute(slideIds[index], "id", true);
    const rel = presentationRels.find((candidate) => candidate.id === id && isRelationship(candidate, "slide"));
    if (!rel || rel.external) throw new PptxExtractionError(INVALID_FILE);
    const slidePath = resolvePart(presentationPath, rel.target);
    const slide = readXml(slidePath);
    const slideText = extractParagraphs(slide, false);
    hasVisuals ||= [...descendants(slide)].some((node) => ["pic", "chart", "oleObj", "videoFile", "audioFile", "diagram"].includes(tag(node)));
    let notesText = "";
    const relsPath = relationshipPath(slidePath);
    if (entries.has(relsPath)) {
      const slideRelationships = relationships(readXml(relsPath));
      hasVisuals ||= slideRelationships.some((candidate) => ["image", "chart", "diagramData", "video", "audio", "oleObject", "hyperlink"].some((kind) => isRelationship(candidate, kind)));
      const notes = slideRelationships.find((candidate) => isRelationship(candidate, "notesSlide"));
      if (notes && !notes.external) notesText = extractParagraphs(readXml(resolvePart(slidePath, notes.target)), true);
    }
    readableCharacters += slideText.length + notesText.length;
    const block = `[Slide ${index + 1}]${slideText ? `\n${slideText}` : ""}${notesText ? `\n\nSpeaker notes:\n${notesText}` : ""}`;
    const separator = parts.length ? "\n\n" : "";
    const remaining = maxCharacters - characters;
    const addition = separator + block;
    parts.push(addition.slice(0, remaining));
    characters += Math.min(addition.length, remaining);
    if (addition.length > remaining || (characters === maxCharacters && index + 1 < slideIds.length)) {
      truncated = true;
      break;
    }
  }
  if (!readableCharacters) {
    throw new PptxExtractionError("YOVA could not find readable slide text or speaker notes. Export this PowerPoint to PDF and upload the PDF so image-based slides can be read.");
  }
  return {
    text: parts.join("").trim(),
    pages: slideIds.length,
    truncated,
    notice: hasVisuals ? "Slide text and notes were read. Images, charts, and linked videos were not read; add notes or a transcript for any content you need tested." : null,
  };
}

function tag(node: XmlNode): string {
  const key = Object.keys(node).find((name) => !name.startsWith(":") && !name.startsWith("#") && !name.startsWith("?"));
  return key?.split(":").pop() ?? "";
}

function children(node: XmlNode): XmlNode[] {
  const value = Object.entries(node).find(([name]) => !name.startsWith(":") && !name.startsWith("#"))?.[1];
  return Array.isArray(value) ? value : [];
}

function* descendants(nodes: XmlNode[], wanted?: string): Generator<XmlNode> {
  for (const node of nodes) {
    if (!wanted || tag(node) === wanted) yield node;
    yield* descendants(children(node), wanted);
  }
}

function attribute(node: XmlNode, name: string, namespaced = false): string {
  const entry = Object.entries(node[":@"] ?? {}).find(([key]) => (
    key.replace(/^@_/, "").split(":").pop() === name && (!namespaced || key.includes(":"))
  ));
  return entry?.[1] ?? "";
}

function extractParagraphs(nodes: XmlNode[], notes: boolean): string {
  const paragraphs: string[] = [];
  const visit = (items: XmlNode[]) => {
    for (const node of items) {
      if (tag(node) === "sp") {
        const placeholder = [...descendants(children(node), "ph")][0];
        const type = placeholder ? attribute(placeholder, "type") : "";
        if (["sldNum", "dt", "ftr", "hdr", ...(notes ? ["sldImg"] : [])].includes(type)) continue;
      }
      if (tag(node) === "p") {
        const value = paragraphText(children(node)).replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
        if (value) paragraphs.push(value);
      } else visit(children(node));
    }
  };
  visit(nodes);
  return paragraphs.join("\n");
}

function paragraphText(nodes: XmlNode[]): string {
  return nodes.map((node) => {
    if (tag(node) === "t") return children(node).map((child) => child["#text"] ?? "").join("");
    if (tag(node) === "br") return "\n";
    if (tag(node) === "tab") return "\t";
    if (tag(node) === "fld" && attribute(node, "type").toLowerCase() === "slidenum") return "";
    return paragraphText(children(node));
  }).join("");
}

function relationships(nodes: XmlNode[]): Relationship[] {
  const seen = new Set<string>();
  return [...descendants(nodes, "Relationship")].map((node) => {
    const id = attribute(node, "Id");
    if (!id || seen.has(id)) throw new PptxExtractionError(INVALID_FILE);
    seen.add(id);
    return { id, type: attribute(node, "Type"), target: attribute(node, "Target"), external: attribute(node, "TargetMode").toLowerCase() === "external" };
  });
}

function isRelationship(rel: Relationship, kind: string): boolean {
  return OFFICE_RELATIONSHIP.test(rel.type) && rel.type.endsWith(`/${kind}`);
}

function relationshipPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
}

function resolvePart(source: string, target: string): string {
  if (!target || /[\\\u0000?#]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) throw new PptxExtractionError(INVALID_FILE);
  const path = target.startsWith("/") ? target.slice(1) : source.slice(0, source.lastIndexOf("/") + 1) + target;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") {
      if (!segments.length) throw new PptxExtractionError(INVALID_FILE);
      segments.pop();
    } else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

function parseXml(bytes: Uint8Array): XmlNode[] {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  // OOXML never needs a DTD. Reject entity definitions before giving XML to the parser.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new PptxExtractionError(INVALID_FILE);
  let depth = 0;
  let count = 0;
  for (let offset = 0; offset < xml.length;) {
    const start = xml.indexOf("<", offset);
    if (start === -1) break;
    const special = xml.startsWith("<!--", start) ? "-->" : xml.startsWith("<![CDATA[", start) ? "]]>" : xml.startsWith("<?", start) ? "?>" : null;
    if (special) {
      const end = xml.indexOf(special, start + 2);
      if (end === -1) throw new PptxExtractionError(INVALID_FILE);
      offset = end + special.length;
      continue;
    }
    let end = start + 1;
    let quote = "";
    for (; end < xml.length; end += 1) {
      const character = xml[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === xml.length) throw new PptxExtractionError(INVALID_FILE);
    if (xml[start + 1] === "/") depth -= 1;
    else if (xml[end - 1] !== "/") depth += 1;
    if (++count > 50_000 || depth > 80) throw new PptxExtractionError(TOO_COMPLEX);
    offset = end + 1;
  }
  if (XMLValidator.validate(xml) !== true) throw new PptxExtractionError(INVALID_FILE);
  return new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
    // Numeric references need the decoder hook in current fast-xml-parser.
    // This only shrinks XML entities; it never expands definitions or decodes twice.
    entityDecoder: {
      decode: decodeXmlEntities,
      reset() {},
      setXmlVersion() {},
      setExternalEntities: rejectEntityDefinitions,
      addInputEntities: rejectEntityDefinitions,
    },
  }).parse(xml) as XmlNode[];
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };

function rejectEntityDefinitions(entities: Record<string, string>) {
  if (Object.keys(entities).length) throw new PptxExtractionError(INVALID_FILE);
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&([^;\s&]*);/g, (_, entity: string) => {
    if (Object.hasOwn(XML_ENTITIES, entity)) return XML_ENTITIES[entity];
    const numeric = /^#(?:x[\da-f]+|\d+)$/i.test(entity);
    const point = numeric ? entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10) : -1;
    const valid = [9, 10, 13].includes(point) || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff);
    if (!valid) throw new PptxExtractionError(INVALID_FILE);
    return String.fromCodePoint(point);
  });
}

/** Index first, so ignored media never gets decompressed and declared ZIP bombs are rejected. */
function indexArchive(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new PptxExtractionError(TOO_COMPLEX);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new PptxExtractionError("This file is password protected or uses an older PowerPoint format. Save an unlocked .pptx copy or export it to PDF first.");
  if (bytes.length < 22) throw new PptxExtractionError(INVALID_FILE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end -= 1) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65_557)) throw new PptxExtractionError(INVALID_FILE);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || !count || count === 0xffff || centralStart + centralSize !== end) throw new PptxExtractionError(INVALID_FILE);
  if (count > MAX_ENTRIES) throw new PptxExtractionError(TOO_COMPLEX);
  const entries = new Map<string, ZipEntry>();
  let offset = centralStart;
  let totalSize = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new PptxExtractionError(INVALID_FILE);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const recordSize = 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (flags & 0x41) throw new PptxExtractionError("This PowerPoint is encrypted. Save a copy without a password or export it to PDF and upload that copy.");
    if (![0, 8].includes(method) || view.getUint16(offset + 34, true) || offset + recordSize > end || compressedSize === 0xffffffff || size === 0xffffffff || local + 30 > centralStart) throw new PptxExtractionError(INVALID_FILE);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    if (!name || /[\\\u0000]/.test(name) || name.startsWith("/") || name.split("/").some((part) => part === ".." || part === ".") || entries.has(name)) throw new PptxExtractionError(INVALID_FILE);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || view.getUint16(local + 26, true) !== nameSize) throw new PptxExtractionError(INVALID_FILE);
    const start = local + 30 + nameSize + view.getUint16(local + 28, true);
    if (start + compressedSize > centralStart || !bytes.subarray(local + 30, local + 30 + nameSize).every((value, n) => value === bytes[offset + 46 + n])) throw new PptxExtractionError(INVALID_FILE);
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== size)) throw new PptxExtractionError(INVALID_FILE);
    totalSize += size;
    if (totalSize > MAX_ARCHIVE_EXPANDED_BYTES) throw new PptxExtractionError(TOO_COMPLEX);
    entries.set(name, { name, start, compressedSize, size, method, crc });
    offset += recordSize;
  }
  if (offset !== end) throw new PptxExtractionError(INVALID_FILE);
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function inflateEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const output = new Uint8Array(entry.size);
  let written = 0;
  let crc = 0xffffffff;
  const receive = (chunk: Uint8Array) => {
    if (written + chunk.length > entry.size) throw new PptxExtractionError(TOO_COMPLEX);
    output.set(chunk, written);
    written += chunk.length;
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  };
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressedSize);
  if (entry.method === 0) receive(compressed);
  else {
    const inflater = new Inflate(receive);
    // Tiny compressed pushes also bound memory if an entry lies about its expanded size.
    for (let offset = 0; offset < compressed.length; offset += 1_024) {
      inflater.push(compressed.subarray(offset, offset + 1_024), offset + 1_024 >= compressed.length);
    }
  }
  if (written !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new PptxExtractionError(INVALID_FILE);
  return output;
}

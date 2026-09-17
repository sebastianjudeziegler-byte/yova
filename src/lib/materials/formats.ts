// Shared by the file picker, upload validation, and the server boundary.
export const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const MATERIAL_MIME_TYPES = ["application/pdf", "text/plain", "text/markdown", PPTX_MIME_TYPE] as const;
export type MaterialMimeType = typeof MATERIAL_MIME_TYPES[number];
export const MATERIAL_FORMAT_LABEL = "PowerPoint (.pptx), PDF, TXT, or Markdown";
export const MATERIAL_FILE_ACCEPT = `.pptx,.pdf,.txt,.md,.markdown,${MATERIAL_MIME_TYPES.join(",")}`;

export function resolveMaterialMimeType(name: string, suppliedMimeType: string): MaterialMimeType | null {
  const extension = name.split(".").pop()?.toLowerCase();
  const mimeType = suppliedMimeType.toLowerCase().trim();
  const genericType = !mimeType || mimeType === "application/octet-stream";
  if (extension === "pptx" && (genericType || mimeType === PPTX_MIME_TYPE || mimeType === "application/zip")) return PPTX_MIME_TYPE;
  if (extension === "pdf" && (genericType || mimeType === "application/pdf")) return "application/pdf";
  if (extension === "txt" && (genericType || mimeType === "text/plain")) return "text/plain";
  if ((extension === "md" || extension === "markdown") && (genericType || mimeType === "text/plain" || mimeType === "text/markdown")) return "text/markdown";
  return null;
}

export function unsupportedMaterialMessage(name: string) {
  return /\.(ppt|pptm|pps|ppsx)$/i.test(name)
    ? `${name}: save the presentation as PowerPoint (.pptx) or export it as PDF, then upload it again.`
    : `${name} is not supported. Use ${MATERIAL_FORMAT_LABEL}.`;
}

export function normalizeRichMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\s*\\\[\s*/g, () => "\n$$\n")
    .replace(/\s*\\\]/g, () => "\n$$\n")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$")
    .replace(
      /\$(\d[\d,]*(?:\.\d{1,2})?)(?=(?:\s+[A-Za-z]|\s*$|[,.](?:\s|$)))/gm,
      (_match, amount: string) => `\\$${amount}`,
    )
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

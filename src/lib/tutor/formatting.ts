export function normalizeTutorMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\s*\\\[\s*/g, () => "\n$$\n")
    .replace(/\s*\\\]/g, () => "\n$$\n")
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

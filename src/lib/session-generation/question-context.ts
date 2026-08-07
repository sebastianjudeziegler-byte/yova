import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

const HIDDEN_CONTEXT_REFERENCES = [
  /\b(previous|prior) (answer|example|problem|question|result|screen|session)\b/i,
  /\b(earlier|above) (answer|example|problem|question|result|screen)\b/i,
  /\bthe (same|original) (answer|example|problem|question|result)\b/i,
  /\bwithout (reopening|looking at|viewing) (the )?(answer|example|problem|question)\b/i,
];

export function validateSessionQuestionContext(draft: GeneratedSessionDraft) {
  for (const activity of draft.activities) {
    if (activity.type !== "multiple_choice" && activity.type !== "free_response") continue;
    const prompt = `${activity.title} ${activity.body}`.replace(/\s+/g, " ").trim();

    if (HIDDEN_CONTEXT_REFERENCES.some((pattern) => pattern.test(prompt))) {
      return `The question "${activity.title}" depends on a previous or hidden prompt. Restate all information needed to answer it.`;
    }

    if (activity.type === "multiple_choice" && activity.choices.every(isNumericChoice)) {
      const numbers = prompt.match(/-?\d+(?:\.\d+)?/g) ?? [];
      if (new Set(numbers).size < 2 && !containsDefinedEquation(prompt)) {
        return `The quantitative question "${activity.title}" lists numeric answers without supplying enough values or an equation to solve it.`;
      }
    }
  }

  return null;
}

function isNumericChoice(value: string) {
  return /^\s*(?:[$€£]\s*)?-?\d+(?:\.\d+)?(?:\s*%|\s*[a-zA-Z]+)?\s*$/.test(value);
}

function containsDefinedEquation(value: string) {
  return /(?:[a-zA-Z][a-zA-Z0-9_]*(?:\([^)]*\))?\s*=\s*[^,.;?]+)|(?:\$[^$]*=[^$]*\$)/.test(value);
}

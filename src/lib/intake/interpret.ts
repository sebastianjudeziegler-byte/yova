import type { IntakeInterpretation, IntakeItemType } from "@/lib/intake/schema";

const TEST_PATTERN = /\b(test|exam|quiz|midterm|final|sat|act|ap exam)\b/i;
const ASSIGNMENT_PATTERN = /\b(assignment|homework|paper|essay|project|presentation|worksheet|problem set|lab report|submit|turn in|due)\b|\bcomplete\s+\d+/i;
const COURSE_PATTERN = /\b(all of|entire|full)\s+(calculus|course|class)|\bcourse\b/i;
const BOOK_PATTERN = /\b(book|novel|chapter|read)\b/i;
const SKILL_PATTERN = /\b(skill|product rule|coding|programming|speaking|vocabulary|language)\b/i;

export function interpretIntake(input: {
  description: string;
  materialNames: string[];
  now?: Date;
}): IntakeInterpretation {
  const description = normalize(input.description);
  const itemType = inferType(description);
  const dueAt = inferDueAt(description, input.now ?? new Date());
  const scope = inferScope(description);
  const progress = inferProgress(description);

  return {
    title: deriveLearningTitle(description, itemType),
    objective: deriveObjective(description, itemType),
    itemType,
    dueAt,
    scope,
    progress,
    requestedMinutes: inferRequestedMinutes(description),
    materialsSummary: input.materialNames.length
      ? `${input.materialNames.length} attached ${input.materialNames.length === 1 ? "source" : "sources"}: ${input.materialNames.join(", ")}`
      : "No materials attached. YOVA can create or guide the learning from the description.",
    missingFields: [
      ...(scope.length < 8 ? ["scope" as const] : []),
      ...(!progress ? ["progress" as const] : []),
    ],
  };
}

export function deriveLearningTitle(description: string, itemType: IntakeItemType = inferType(description)) {
  const text = normalize(description);
  const known = [
    { pattern: /lab report/i, title: "Lab Report" },
    { pattern: /thermodynam/i, title: /essay|paper/i.test(text) ? "Thermodynamics Essay" : "Thermodynamics" },
    { pattern: /history essay/i, title: "History Essay" },
    { pattern: /world war (?:i|1)|wwi|first world war/i, title: itemType === "test" ? "World War I Test Prep" : "World War I" },
    { pattern: /startup.*fund|funding.*startup|term sheets?|dilution/i, title: "Startup Funding Foundations" },
    { pattern: /product rule/i, title: "Calculus: Product Rule" },
    { pattern: /calculus/i, title: "Calculus Learning Path" },
    { pattern: /photosynthesis|cellular respiration/i, title: "Photosynthesis and Cellular Respiration" },
    { pattern: /biology/i, title: itemType === "test" ? "Biology Test Prep" : "Biology Foundations" },
    { pattern: /melatonin/i, title: "Melatonin and Sleep Timing" },
    { pattern: /personal finance|investing|budget|credit/i, title: "Personal Finance Fundamentals" },
    { pattern: /vocabulary|new words/i, title: "Conversation Vocabulary Builder" },
  ].find((candidate) => candidate.pattern.test(text));
  if (known) return known.title;

  const cleaned = text
    .replace(/^i\s+(?:have|need|want|am|would like)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/\b(?:by|before|due|on)\s+(?:tomorrow|today|next\s+\w+|in\s+\d+\s+(?:days?|weeks?)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?).*$/i, "")
    .replace(/\b(?:in|for)\s+(?:two|three|four|\d+)\s+weeks?.*$/i, "")
    .replace(/\bwith\s+(?:a|my)\s+(?:study guide|pdf|notes).*$/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 9);
  const base = words.length ? titleCase(words.join(" ")) : "New learning goal";
  if (itemType === "test" && !/test|exam|quiz/i.test(base)) return `${base} Test Prep`.slice(0, 100);
  return base.slice(0, 100);
}

const GENERIC_LEARNING_TITLE = /^(personalized learning plan|personalized study plan|learning plan|study plan|new learning goal|untitled(?: plan)?)$/i;

/**
 * Keeps learner-facing titles short and specific, including plans created before
 * stricter title validation was added. The original topic remains the source of
 * truth when the generated title is generic or reads like an unedited prompt.
 */
export function resolveLearningTitle(candidate: string, context: string) {
  const title = normalize(candidate).replace(/[.,;:]+$/g, "");
  const source = normalize(context);
  const sentenceLike = title.length > 72
    || /[.!?]\s+\S/.test(title)
    || /\b(?:i|my|we|our)\s+(?:have|need|want|am|are|would|will)\b/i.test(title);
  const repeatedFragment = /\b(.{8,35})\b[\s.,:;-]+\1\b/i.test(title);

  if (!title || GENERIC_LEARNING_TITLE.test(title) || sentenceLike || repeatedFragment) {
    return deriveLearningTitle(source || title);
  }

  return title.slice(0, 72);
}

function inferType(description: string): IntakeItemType {
  if (TEST_PATTERN.test(description)) return "test";
  if (ASSIGNMENT_PATTERN.test(description)) return "assignment";
  if (COURSE_PATTERN.test(description)) return "course";
  if (BOOK_PATTERN.test(description)) return "book";
  if (SKILL_PATTERN.test(description)) return "skill";
  return "topic";
}

function deriveObjective(description: string, itemType: IntakeItemType) {
  if (itemType === "assignment") return `Complete the requested work with a clear sequence, realistic schedule, and support where needed: ${description}`.slice(0, 500);
  if (itemType === "test") return `Become ready to explain, recall, and apply the material described here: ${description}`.slice(0, 500);
  return `Build useful understanding and be able to use what was learned: ${description}`.slice(0, 500);
}

function inferScope(description: string) {
  const scopeMatch = description.match(/(?:on|about|covering|for)\s+([^,.]{3,180})/i);
  return normalize(scopeMatch?.[1] ?? description).slice(0, 400);
}

function inferProgress(description: string) {
  if (/\b(know nothing|ground zero|from the beginning|starting from (?:the )?beginning|haven't learned|have not learned|completely new|beginner)\b/i.test(description)) return "Starting from the beginning";
  if (/\b(know a few basics|some basics|seen it|a little)\b/i.test(description)) return "Some prior exposure";
  if (/\b(mostly review|reviewing|already know|understand the basics)\b/i.test(description)) return "Has a foundation and needs review or practice";
  return "";
}

function inferDueAt(description: string, now: Date) {
  const lower = description.toLocaleLowerCase();
  const due = new Date(now);
  due.setHours(23, 59, 59, 999);
  if (/\btoday\b/.test(lower)) return due.toISOString();
  if (/\btomorrow\b/.test(lower)) {
    due.setDate(due.getDate() + 1);
    return due.toISOString();
  }

  const relative = lower.match(/\b(?:in\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|days|week|weeks)\b/);
  if (relative) {
    const amount = wordNumber(relative[1]);
    due.setDate(due.getDate() + amount * (relative[2].startsWith("week") ? 7 : 1));
    return due.toISOString();
  }

  const weekdayMatch = lower.match(/\b(?:(?:by|due|on|before)\s+(?:next\s+)?|next\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = weekdays.indexOf(weekdayMatch[1]);
    let delta = (target - due.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    due.setDate(due.getDate() + delta);
    return due.toISOString();
  }

  const explicit = description.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (explicit) {
    const parsed = new Date(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3]), 23, 59, 59, 999);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const monthDate = description.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i);
  if (monthDate) {
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(monthDate[1].toLocaleLowerCase());
    const year = monthDate[3] ? Number(monthDate[3]) : due.getFullYear();
    const parsed = new Date(year, month, Number(monthDate[2]), 23, 59, 59, 999);
    if (!monthDate[3] && parsed.getTime() < now.getTime()) parsed.setFullYear(parsed.getFullYear() + 1);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function inferRequestedMinutes(description: string) {
  const match = description.match(/\b(?:in|for|within)\s+(\d{1,3})\s*(?:minutes?|mins?)\b/i);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes >= 5 && minutes <= 180 ? minutes : null;
}

function wordNumber(value: string) {
  const numbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return numbers[value] ?? Number(value);
}

function titleCase(value: string) {
  const small = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"]);
  return value.split(/\s+/).map((word, index) => index > 0 && small.has(word.toLocaleLowerCase())
    ? word.toLocaleLowerCase()
    : `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`).join(" ");
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

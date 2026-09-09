import { describesLearnerAsAType } from "@/lib/plan-generation/quality-gate";
import type { LearningPlanSession } from "@/lib/domain";
import { CORE_METHOD_CATALOG, CORE_METHOD_IDS, recognizedCoreMethodNames } from "@/lib/learning/method-catalog";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

/** Self-report changes planning priority only; it is never placement evidence. */
export function startingDifficultyTopicIds(request: Pick<PlanGenerationRequest, "startingContext" | "knowledgeMap">): ReadonlySet<string> {
  const sentences = (request.startingContext ?? "").split(/[.!?;]+/u).map(normalize);
  return new Set((request.knowledgeMap?.topics ?? []).filter(topic => {
    const title = normalize(topic.title);
    const acronym = title.split(" ").filter(word => !["and", "the", "of"].includes(word)).map(word => word[0]).join("");
    return sentences.some(sentence => {
      if (!/\b(confus\w*|stuck|struggl\w*|difficult\w*|unclear|weak|hard)\b/u.test(sentence)
        || /\b(not|no longer|isn t|aren t)\b/u.test(sentence)) return false;
      const padded = ` ${sentence} `;
      return padded.includes(` ${title} `) || (acronym.length >= 3 && padded.includes(` ${acronym} `));
    });
  }).map(topic => topic.id));
}

export function wordBoundedText(text: string, maximum: number) {
  const cleaned = text.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= maximum) return cleaned;
  const boundary = cleaned.lastIndexOf(" ", maximum);
  return boundary > 0 ? cleaned.slice(0, boundary).replace(/[,;:]$/u, "") : "";
}

export function learnerCopyPreference(request: Pick<PlanGenerationRequest, "profileSummary" | "startingContext">) {
  const text = request.profileSummary.toLowerCase();
  if (/example|concrete/.test(text)) return { reason: "You asked for an example first", objective: "after working through a concrete example" };
  if (/own words|explain.*(?:first|memory)|reflect/.test(text)) return { reason: "You prefer explaining in your own words", objective: "in your own words, then check your reasoning" };
  if (/hint/.test(text)) return { reason: "You asked for hints before explanations", objective: "with a hint if needed, then on your own" };
  if (/short|focus|20 minutes/.test(text)) return { reason: "You prefer short periods of focused work", objective: "one small step at a time" };
  if (/direct|concise/.test(text)) return { reason: "You asked for direct explanations", objective: "after a concise explanation" };
  return { reason: request.startingContext?.trim() ? "Building from the starting point you described" : "For the goal you described", objective: "and apply it to a fresh example" };
}

export function personalizedMethodReason({ request, session, proposed }: {
  request: PlanGenerationRequest;
  session: Pick<LearningPlanSession, "sequence" | "method" | "learningMode" | "topicIds">;
  proposed?: string;
}) {
  const titles = session.topicIds?.map(id => request.knowledgeMap?.topics.find(topic => topic.id === id)?.title ?? "this topic") ?? ["this topic"];
  const rawFocus = wordBoundedText(titles.join(", ").replace(/\*\*|__|[\u2013\u2014]/gu, ""), 110);
  const focus = rawFocus && !describesLearnerAsAType(rawFocus) ? rawFocus : "this topic";
  const preference = learnerCopyPreference(request);
  const methodId = CORE_METHOD_IDS.find(id => CORE_METHOD_CATALOG[id].name === session.method);
  const actions: Record<string, string> = {
    self_explanation: "explain the connections", concept_mapping: "make the relationships visible",
    read_recall_review: "read a short section, close it and recall the main idea",
    worked_example_fading: "work from a model toward an independent solution",
    retrieval_practice: "recall the essentials and check what is missing",
    spaced_retrieval: "revisit what you can recall after a gap",
    retrieval_based_outlining: "organize the claims before drafting",
    pretesting: "make a prediction and check it against the explanation",
    practice_problems: "solve a fresh problem and inspect the key step",
    interleaved_practice: "compare examples and choose the right approach",
    scaffolded_coding: "trace a model before building a solution",
    practice_test_error_repair: "try a short assessment and repair the mistakes",
  };
  const phase = session.learningMode === "learn" ? "build understanding" : "check what you can do independently";
  const fallback = `${preference.reason}; ${session.method} lets you ${actions[methodId ?? ""] ?? "practice the key ideas"} for ${focus} to ${phase} in session ${session.sequence}.`;
  if (!proposed) return fallback;
  const copy = proposed.trim();
  const normalized = normalize(copy);
  const foreignMethod = CORE_METHOD_IDS.some(id => id !== methodId && recognizedCoreMethodNames(id).some(name => normalized.includes(normalize(name))));
  const topicTokens = normalize(titles.join(" ")).split(" ").filter(word => word.length >= 3);
  const profileTokens = normalize(`${request.profileSummary} ${request.startingContext ?? ""}`).split(" ").filter(word => word.length >= 4 && !["before", "after", "asking", "anything", "things", "study", "learning", "explanation", "explanations"].includes(word));
  if (copy.length < 10 || copy.length > 600 || foreignMethod || describesLearnerAsAType(copy)
    || /\b(targets?|envelopes?|ignore|override|instead|switch|diagnosis|brain type|learning style)\b|evidence check \d|[\u2013\u2014]|\*\*/iu.test(copy)
    || !topicTokens.some(token => normalized.split(" ").includes(token))
    || !profileTokens.some(token => normalized.split(" ").some(word => word.startsWith(token.replace(/s$/u, ""))))) return fallback;
  return copy;
}

export function startingDifficultyRationale(request: PlanGenerationRequest) {
  const ids = startingDifficultyTopicIds(request);
  const names = request.knowledgeMap?.topics.filter(topic => ids.has(topic.id) && !topic.deferred).map(topic => topic.title) ?? [];
  return names.length ? ` You said ${wordBoundedText(names.join(", "), 150)} was difficult, so it comes earlier after its prerequisites, with extra study time where capacity allows.` : "";
}

export function normalPlanAmountLabel(topicCount: number, evidenceCount: number, minutes: number) {
  return `${topicCount} ${topicCount === 1 ? "topic" : "topics"} + ${evidenceCount} ${evidenceCount === 1 ? "practice check" : "practice checks"} + about ${minutes} min`;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

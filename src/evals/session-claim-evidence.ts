import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

/** Keep the existing quality gate unchanged while making synthetic failures inspectable. */
export const UNSUPPORTED_LEARNER_CLAIM_PATTERN = /learns? best|learning style|brain type|visual learner|auditory learner|kinesthetic learner|because (you have|of your) adhd|diagnos(?:is|ed|e)\b/i;

type ClaimEvidenceInput = {
  rationale: string;
  coverage: Pick<GeneratedSessionDraft["coverage"], "focus" | "essentialIdeas" | "completionEvidence" | "deferredContent">;
  methodBriefing: Pick<GeneratedSessionDraft["methodBriefing"], "name" | "what" | "why" | "how" | "completion" | "personalization">;
  activities: Array<Pick<GeneratedSessionDraft["activities"][number], "label" | "title" | "body" | "teaching" | "correctAnswer" | "feedback" | "choices"> & { lessonBrief?: { essentialIdeas: string[] } | null }>;
};

export type SessionClaimEvidence = { field: string; matchedPhrase: string; snippet: string };

/**
 * Evaluation-only: retain at most three 220-character matches from generated
 * learner-facing fields in fixed synthetic cases. Never log the context,
 * profile, source excerpts, full response, or request/account metadata.
 */
export function unsupportedLearnerClaimEvidence(draft: ClaimEvidenceInput): SessionClaimEvidence[] {
  const fields: Array<{ field: string; text: string }> = [];
  const add = (field: string, text: string | null | undefined) => { if (text) fields.push({ field, text }); };
  const addList = (field: string, values: readonly string[]) => values.forEach((value, index) => add(`${field}[${index}]`, value));
  add("rationale", draft.rationale);
  add("coverage.focus", draft.coverage.focus);
  for (const key of ["essentialIdeas", "completionEvidence", "deferredContent"] as const) addList(`coverage.${key}`, draft.coverage[key]);
  for (const key of ["name", "what", "why", "completion"] as const) add(`methodBriefing.${key}`, draft.methodBriefing[key]);
  for (const key of ["how", "personalization"] as const) addList(`methodBriefing.${key}`, draft.methodBriefing[key]);
  draft.activities.forEach((activity, index) => {
    const prefix = `activities[${index}]`;
    for (const key of ["label", "title", "body", "correctAnswer", "feedback"] as const) add(`${prefix}.${key}`, activity[key]);
    addList(`${prefix}.choices`, activity.choices);
    addList(`${prefix}.lessonBrief.essentialIdeas`, activity.lessonBrief?.essentialIdeas ?? []);
    const teaching = activity.teaching;
    if (!teaching) return;
    add(`${prefix}.teaching.keyIdea`, teaching.keyIdea);
    add(`${prefix}.teaching.explanation`, teaching.explanation);
    add(`${prefix}.teaching.example.setup`, teaching.example?.setup);
    addList(`${prefix}.teaching.example.steps`, teaching.example?.steps ?? []);
    add(`${prefix}.teaching.example.takeaway`, teaching.example?.takeaway);
    add(`${prefix}.teaching.commonMistake.mistake`, teaching.commonMistake?.mistake);
    add(`${prefix}.teaching.commonMistake.correction`, teaching.commonMistake?.correction);
  });
  const evidence: SessionClaimEvidence[] = [];
  for (const { field, text } of fields) {
    const clean = text.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]").replace(/\s+/g, " ").trim();
    const match = clean.match(UNSUPPORTED_LEARNER_CLAIM_PATTERN);
    if (!match) continue;
    const start = Math.max(0, (match.index ?? 0) - 80);
    evidence.push({ field, matchedPhrase: match[0], snippet: clean.slice(start, start + 220) });
    if (evidence.length === 3) break;
  }
  return evidence;
}

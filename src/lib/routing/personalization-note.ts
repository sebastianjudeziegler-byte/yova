import { defaultEvidence, noteEvidence, type HappenedInSession } from "@/lib/routing/rule-evidence";
import type { SessionRoute } from "@/lib/routing/session-route";

/**
 * The one-sentence personalization note on the session end screen: what
 * changed and why, drawn from the rule ID that fired. Rule IDs are ranked so
 * the most visible profile-driven change is the one named; the sentence is a
 * template per rule, never model text (templates in rule-evidence.ts).
 */
export type PersonalizationNote = {
  ruleId: string;
  sentence: string;
};

/**
 * `exampleShown: false` means the session could not show a worked example, so
 * no sentence may claim one (Brief 1.5 item 5: never claim a personalization
 * that did not happen). Omit it before a session has run.
 */
export function personalizationNote(route: SessionRoute, happened: HappenedInSession = {}): PersonalizationNote {
  const { ruleId, sentence } = noteEvidence(route, happened)[0] ?? defaultEvidence(route);
  return { ruleId, sentence };
}

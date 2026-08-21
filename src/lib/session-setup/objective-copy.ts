import type { LearningPlanSession, StudyMode } from "@/lib/domain";

const TRUNCATION_MARK = /(?:\.{3}|…)/u;
const LEADING_SESSION_VERB = /^(?:learn|retrieve and apply|connect and apply|verify)\s+/i;
const TRAILING_PUNCTUATION = /[\s,;:.!?…]+$/u;
const MAX_TARGET_LENGTH = 100;

export function sessionSetupObjective(
  studyMode: StudyMode,
  session: Pick<LearningPlanSession, "title" | "objective" | "contentTargets">,
) {
  const objective = normalizeWhitespace(session.objective);
  if (studyMode !== "outside_yova" || !TRUNCATION_MARK.test(objective)) return objective;

  const targets = (session.contentTargets ?? [])
    .map(cleanTarget)
    .filter(Boolean);
  const firstTarget = conciseTarget(targets[0] ?? cleanTarget(session.title));
  const connectedTargetCount = Math.max(0, targets.length - 1);
  const targetLabel = connectedTargetCount > 0
    ? `${firstTarget} and ${connectedTargetCount} connected ${connectedTargetCount === 1 ? "topic" : "topics"}`
    : firstTarget;

  return `Open your chosen source and work through ${targetLabel}. Close the source, then return to YOVA and explain or apply what you understood.`;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function cleanTarget(value: string) {
  return normalizeWhitespace(value)
    .replace(LEADING_SESSION_VERB, "")
    .replace(TRAILING_PUNCTUATION, "");
}

function conciseTarget(value: string) {
  if (value && value.length <= MAX_TARGET_LENGTH && !TRUNCATION_MARK.test(value)) return value;
  return "the current target";
}

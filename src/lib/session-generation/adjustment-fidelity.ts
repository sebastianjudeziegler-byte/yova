import type {
  GeneratedSessionDraft,
  SessionAdjustment,
} from "@/lib/session-generation/schema";

export function validateSessionAdjustmentFidelity(
  draft: Pick<GeneratedSessionDraft, "activities" | "methodBriefing">,
  adjustment: SessionAdjustment | null | undefined,
) {
  if (adjustment?.familiarity !== "already_know") return null;
  const firstUnsupportedCheck = draft.activities.findIndex((activity) => (
    activity.requiredForCompletion
    && (activity.type === "multiple_choice" || activity.type === "free_response")
    && ["retrieve", "independent_practice", "discriminate", "transfer"].includes(activity.methodPhase)
  ));
  const firstModel = draft.activities.findIndex((activity) => activity.methodPhase === "model");
  if (firstUnsupportedCheck < 0 || (firstModel >= 0 && firstModel < firstUnsupportedCheck)) {
    return "A learner claim of prior knowledge must begin with an unsupported evidence check before any teaching model.";
  }
  if (adjustment.knownTargets.length > 0) {
    const explanation = draft.methodBriefing.personalization.join(" ").toLowerCase();
    if (!/claim|already know|verify|evidence|demonstrat|check first/.test(explanation)) {
      return "The method briefing must explain that the learner's named prior-knowledge claim is being verified before content is skipped.";
    }
  }
  return null;
}

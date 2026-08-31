import { StudyRouteTimingSchema, type StudyRouteTiming } from "@/lib/study-route/schema";

/** Short, non-technical copy for the already-visible session recipe. */
export function explainStudyRouteDuration(timingInput: StudyRouteTiming) {
  const timing = StudyRouteTimingSchema.parse(timingInput);
  if (
    timing.hardMaximumMinutes === timing.activeMinutes
    && timing.durationSource !== "learner_override"
    && timing.durationSource !== "scheduled_review"
  ) {
    return `This recipe uses the ${timing.hardMaximumMinutes}-minute window you selected.`;
  }
  switch (timing.durationSource) {
    case "availability_cap":
      return timing.hardMaximumMinutes && timing.hardMaximumMinutes > timing.activeMinutes
        ? `YOVA fit this to the ${timing.hardMaximumMinutes}-minute window you gave it.`
        : "YOVA kept this within the time you said was available.";
    case "profile_recommendation":
      return "YOVA used the sustainable session length in your current profile.";
    case "observed_outcome_adjustment":
      return "YOVA changed the length by one step using comparable recent sessions.";
    case "learner_override":
      return "You selected this length when you adjusted the plan.";
    case "router_default":
      return "YOVA used its safe starting length until it has stronger personal evidence.";
    case "scheduled_review":
      return "This short return check keeps the review lightweight.";
    case "legacy_reconstruction":
      return "This length came from the recipe already saved with the plan.";
  }
}

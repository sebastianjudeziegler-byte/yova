import { recommendStudySchedule } from "@/lib/personalization/study-schedule";

export type PlanPreferenceContract = {
  presentation: { label: string; instruction: string; reason: string };
  support: { label: string; instruction: string; reason: string };
  retention: { label: string; instruction: string; reason: string };
  workspace: { label: string; instruction: string; reason: string };
  pacing: { label: string; instruction: string; reason: string };
  recommendedWindow: string;
  recommendedMinutes: number;
  signalsUsed: string[];
};

/**
 * Converts onboarding prose into an explicit planning contract. The task still
 * chooses the learning method; these preferences change how that method is
 * presented, supported, paced, and revisited.
 */
export function buildPlanPreferenceContract(profileSummary: string): PlanPreferenceContract {
  const normalized = profileSummary.toLocaleLowerCase();
  const schedule = recommendStudySchedule(profileSummary);
  const presentation = includes(normalized, "concrete example before the rule", "a concrete example first", "examples before")
    ? part("Example first", "Open teaching sessions with one concrete case before naming the general rule.", "You asked for examples before rules.")
    : includes(
        normalized,
        "big picture before the details",
        "big picture before details",
        "big picture first",
        "overall map before details",
        "overall model before details",
      )
      ? part("Big picture first", "Show the overall relationship before introducing details and terminology.", "You asked to see the overall model before the details.")
      : includes(normalized, "clear sequence of small steps", "step-by-step instructions", "small steps")
        ? part("Step by step", "Break new procedures into a short visible sequence, then fade the steps.", "You asked for a clear sequence when material is new.")
        : includes(normalized, "trying it before seeing", "trying it and getting feedback")
          ? part("Try, then model", "Use a brief low-stakes prediction before the complete model when the task allows it.", "You said an early attempt and feedback can help ideas click.")
          : includes(normalized, "comparing similar ideas")
            ? part("Contrast first", "Show the target beside its most plausible confusing alternative and name the difference.", "You said comparing similar ideas can help.")
            : part("Task-led explanation", "Present each idea in the clearest sequence for the actual task.", "YOVA will use the task as the primary presentation signal until more evidence is available.");
  const support = includes(normalized, "small hint first", "small hint before", "hint before the answer", "hint before an answer")
    ? part("Hint before answer", "After a miss, reveal one bounded cue before the complete correction.", "You asked for a small hint before the answer.")
    : includes(normalized, "different example")
      ? part("Another example", "After a miss, use a different concrete case before the retry.", "You asked for a new example when stuck.")
      : includes(normalized, "mistake directly")
        ? part("Direct correction", "Name the exact incorrect relationship, replace it, and require a fresh explain-back.", "You asked for mistakes to be explained directly.")
        : includes(normalized, "break it into smaller steps")
          ? part("Restore smaller steps", "Bring back one intermediate step at a time, then return to independent work.", "You asked for smaller steps when stuck.")
          : includes(normalized, "try again without help")
            ? part("Independent retry", "Give concise feedback, then preserve another unsupported attempt before adding help.", "You asked for another independent attempt when possible.")
            : part("Evidence-led support", "Use the smallest amount of help that repairs the demonstrated gap.", "YOVA will adjust support from the learner's actual attempts.");
  const retention = includes(normalized, "recognize it but cannot recall")
    ? part("Recall without cues", "Schedule closed-note retrieval before answer review.", "You said recognition can be stronger than recall.")
    : includes(
        normalized,
        "forget it after a few days",
        "forgets it after a few days",
        "forgets material after a few days",
        "forget material after a few days",
        "fade after a few days",
      )
      ? part("Return after a delay", "Add a short delayed retrieval after initial learning instead of repeating the same material immediately.", "You said information can fade after a few days.")
      : includes(normalized, "confuse similar ideas")
        ? part("Distinguish close ideas", "Include comparison checks that require choosing which concept applies.", "You said similar ideas can become confused.")
        : includes(normalized, "understand it but cannot apply")
          ? part("Transfer to a new case", "Follow initial understanding with an application that changes the surface details.", "You said application can lag behind understanding.")
          : includes(normalized, "with help but not independently")
            ? part("Fade support", "Start with enough guidance to succeed, then remove it before completion.", "You said supported work does not always transfer to independent work.")
            : part("Task-led retention", "Use the retrieval or application check that best matches the task.", "YOVA will select retention work from the content and later performance.");
  const workspace = includes(normalized, "show one step at a time", "one visible step at a time", "one step at a time")
    ? part("One step at a time", "Keep one current action prominent while leaving the path available on demand.", "You asked for one step to be prominent at a time.")
    : includes(normalized, "keep the full path visible")
      ? part("Full path visible", "Keep the plan path visible while one current action remains primary.", "You asked to see the whole path while working.")
      : includes(normalized, "give me choices")
        ? part("Bounded choices", "Offer a small choice only when several routes preserve the same learning target.", "You asked for some control over the route.")
        : includes(normalized, "least guidance")
          ? part("Minimal guidance", "Hide optional support until an attempt shows it is needed.", "You asked YOVA to use the least guidance that works.")
          : part("Focused workspace", "Keep one obvious next action and make additional context optional.", "YOVA will use a focused default workspace.");
  const needsSmallStart = includes(normalized, "struggle to start", "often delay", "deadline feels close", "long plans make me shut down", "feel overwhelmed");
  const pacing = needsSmallStart
    ? part("Small first action", "Make the opening action two to five minutes while preserving the full completion target.", "You said starting or plan size can create friction.")
    : part("Realistic session size", `Keep planned sessions close to ${schedule.minutes} minutes unless the content needs a smaller coherent slice.`, "YOVA is using the session length you said is realistic.");

  return {
    presentation,
    support,
    retention,
    workspace,
    pacing,
    recommendedWindow: schedule.window,
    recommendedMinutes: schedule.minutes,
    signalsUsed: [presentation.label, support.label, retention.label, workspace.label, pacing.label],
  };
}

function part(label: string, instruction: string, reason: string) {
  return { label, instruction, reason };
}

function includes(value: string, ...needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

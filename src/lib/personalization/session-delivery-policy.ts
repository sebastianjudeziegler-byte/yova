import { z } from "zod";
import type { SessionLearningMode } from "@/lib/domain";
import type { CalibrationPattern } from "@/lib/learning/confidence-calibration";

export const SessionDeliveryPolicySchema = z.object({
  schemaVersion: z.literal(1),
  evidenceStatus: z.enum(["baseline", "starting_hypothesis", "observed_pattern", "blended"]),
  presentation: z.object({
    mode: z.enum(["task_aligned", "example_first", "overview_first", "step_by_step", "prediction_then_model", "compare_first"]),
    label: z.string().trim().min(3).max(80),
    instruction: z.string().trim().min(15).max(300),
  }),
  repair: z.object({
    mode: z.enum(["task_aligned", "hint_first", "alternate_example", "direct_correction", "smaller_steps", "retry_independently"]),
    label: z.string().trim().min(3).max(80),
    instruction: z.string().trim().min(15).max(300),
  }),
  retention: z.object({
    mode: z.enum(["task_aligned", "retrieval", "delayed_retrieval", "discrimination", "transfer", "fade_support"]),
    label: z.string().trim().min(3).max(80),
    instruction: z.string().trim().min(15).max(300),
  }),
  workspace: z.object({
    mode: z.enum(["task_aligned", "one_step", "full_path", "learner_choice", "minimal_guidance"]),
    label: z.string().trim().min(3).max(80),
    instruction: z.string().trim().min(15).max(300),
  }),
  pacing: z.object({
    firstActionMinutes: z.number().int().min(1).max(8),
    maximumActivities: z.number().int().min(3).max(8),
    reason: z.string().trim().min(15).max(300),
  }),
  learnerFacingReasons: z.array(z.string().trim().min(15).max(300)).min(1).max(4),
  signalsUsed: z.array(z.string().trim().min(3).max(120)).max(6),
});

export type SessionDeliveryPolicy = z.infer<typeof SessionDeliveryPolicySchema>;

type LearnerProfile = {
  processingPreference?: string | null;
  explanationPreference?: string | null;
  memoryChallenge?: string | null;
  supportPreference?: string | null;
  workspacePreference?: string | null;
  commonBlocker?: string | null;
  guidancePreference?: string | null;
  startingPattern?: string | null;
};

type RecentResult = {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  calibrationPattern: CalibrationPattern;
};

type Interruption = {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  completedSteps: number | null;
  totalSteps: number | null;
};

export function buildSessionDeliveryPolicy({
  learnerProfile,
  recentResults,
  recentInterruptions,
  learningMode,
  estimatedMinutes,
}: {
  learnerProfile: LearnerProfile | null;
  recentResults: RecentResult[];
  recentInterruptions: Interruption[];
  learningMode: SessionLearningMode;
  estimatedMinutes: number;
}): SessionDeliveryPolicy {
  const presentationPreference = learnerProfile?.processingPreference ?? learnerProfile?.explanationPreference;
  const presentation = presentationPolicy(presentationPreference, learningMode);
  const repair = repairPolicy(learnerProfile?.supportPreference);
  const retention = retentionPolicy(learnerProfile?.memoryChallenge);
  const workspace = workspacePolicy(learnerProfile?.workspacePreference);
  const observedPacing = observedPacingPolicy(recentResults, recentInterruptions, estimatedMinutes, learnerProfile);
  const selfReportSignals = [
    presentationPreference,
    learnerProfile?.memoryChallenge,
    learnerProfile?.supportPreference,
    learnerProfile?.workspacePreference,
    learnerProfile?.commonBlocker,
    learnerProfile?.startingPattern,
  ].filter((value): value is string => Boolean(value?.trim()));
  const observedSignals = observedPacing.signals;
  const evidenceStatus = observedSignals.length && selfReportSignals.length
    ? "blended"
    : observedSignals.length
      ? "observed_pattern"
      : selfReportSignals.length
        ? "starting_hypothesis"
        : "baseline";
  const learnerFacingReasons = unique([
    presentation.reason,
    retention.reason,
    repair.reason,
    observedPacing.learnerReason,
  ].filter((value): value is string => Boolean(value))).slice(0, 4);

  return SessionDeliveryPolicySchema.parse({
    schemaVersion: 1,
    evidenceStatus,
    presentation: withoutReason(presentation),
    repair: withoutReason(repair),
    retention: withoutReason(retention),
    workspace: withoutReason(workspace),
    pacing: {
      firstActionMinutes: observedPacing.firstActionMinutes,
      maximumActivities: observedPacing.maximumActivities,
      reason: observedPacing.reason,
    },
    learnerFacingReasons: learnerFacingReasons.length
      ? learnerFacingReasons
      : ["YOVA is using the task and current objective as the starting point until it has more learner evidence."],
    signalsUsed: unique([...selfReportSignals, ...observedSignals]).slice(0, 6),
  });
}

export function validateSessionDeliveryPolicy({
  policy,
  learningMode,
  activities,
}: {
  policy: SessionDeliveryPolicy;
  learningMode: SessionLearningMode;
  activities: Array<{
    methodPhase: string;
    type: string;
    estimatedMinutes: number;
    teaching: null | {
      example: null | { steps: string[] };
      commonMistake: null | { mistake: string; correction: string };
    };
  }>;
}) {
  if (activities.length > policy.pacing.maximumActivities) {
    return `The learner delivery policy allows at most ${policy.pacing.maximumActivities} focused activities in this session.`;
  }
  if ((activities[0]?.estimatedMinutes ?? 0) > policy.pacing.firstActionMinutes + 2) {
    return `The first action must stay close to the ${policy.pacing.firstActionMinutes}-minute starting target.`;
  }

  const firstTeaching = activities.find((activity) => Boolean(activity.teaching))?.teaching ?? null;
  if (learningMode === "learn" && policy.presentation.mode === "example_first" && !firstTeaching?.example) {
    return "This learner asked for examples first, so the opening teaching block needs a concrete worked example.";
  }
  if (learningMode === "learn" && policy.presentation.mode === "step_by_step" && (firstTeaching?.example?.steps.length ?? 0) < 3) {
    return "This learner asked for a clear sequence, so the opening model needs at least three visible steps.";
  }
  if (learningMode === "learn" && policy.presentation.mode === "compare_first" && !firstTeaching?.commonMistake) {
    return "This learner asked to compare similar ideas, so the opening teaching block needs a plausible contrast or corrected mix-up.";
  }
  if (policy.repair.mode === "alternate_example" && learningMode === "learn" && !firstTeaching?.example) {
    return "The selected repair approach needs a concrete alternate example available before independent practice.";
  }
  if (policy.retention.mode === "delayed_retrieval" && !activities.some((activity) => activity.methodPhase === "schedule_return")) {
    return "This learner reports forgetting after a delay, so the session needs an explicit delayed retrieval return.";
  }
  if (policy.retention.mode === "transfer" && !activities.some((activity) => activity.methodPhase === "transfer")) {
    return "This learner reports difficulty applying ideas, so the session needs a transfer activity using a different application.";
  }
  if (policy.retention.mode === "fade_support" && !activities.some((activity) => activity.methodPhase === "independent_practice" || activity.methodPhase === "transfer")) {
    return "This learner reports relying on help, so the session needs a later independent attempt after support fades.";
  }
  return null;
}

function presentationPolicy(value: string | null | undefined, learningMode: SessionLearningMode) {
  const normalized = normalize(value);
  const studyPrefix = learningMode === "study"
    ? "Keep the unsupported check first. When support is needed, "
    : "";
  if (normalized.includes("concrete example")) return policyPart("example_first", "Example first", `${studyPrefix}begin the explanation with one concrete case before naming the general rule.`, "You asked for concrete examples before rules, so YOVA will make the first explanation example-led.");
  if (normalized.includes("big picture")) return policyPart("overview_first", "Big picture first", `${studyPrefix}show the overall relationship before introducing details or terminology.`, "You asked for the big picture first, so YOVA will establish the overall model before the details.");
  if (normalized.includes("small steps") || normalized.includes("clear sequence")) return policyPart("step_by_step", "Step by step", `${studyPrefix}show the model as a short visible sequence with one operation or relationship per step.`, "You asked for a clear sequence, so YOVA will break the model into visible steps.");
  if (normalized.includes("trying it")) return policyPart("prediction_then_model", "Predict, then model", `${studyPrefix}use a brief prediction or partial attempt to activate prior knowledge before revealing the complete model.`, "You asked to try ideas early, so YOVA will use a brief prediction before the complete model when the task allows it.");
  if (normalized.includes("comparing similar")) return policyPart("compare_first", "Contrast first", `${studyPrefix}contrast the target with the most plausible similar idea and name the difference explicitly.`, "You said similar ideas can be useful side by side, so YOVA will make the important contrast visible.");
  return policyPart("task_aligned", "Task-led presentation", `${studyPrefix}present the content in the sequence best supported by the current task.`, null);
}

function repairPolicy(value: string | null | undefined) {
  const normalized = normalize(value);
  if (normalized.includes("small hint")) return policyPart("hint_first", "Hint first", "After a miss, reveal one bounded cue before showing the complete correction.", "You asked for a small hint first, so YOVA will preserve another attempt before revealing the answer.");
  if (normalized.includes("different example")) return policyPart("alternate_example", "Another example", "After a miss, show a different concrete example and then ask for a fresh attempt.", "You asked for another example when stuck, so YOVA will repair with a new case rather than repeat the same wording.");
  if (normalized.includes("mistake directly")) return policyPart("direct_correction", "Direct correction", "After a miss, name the incorrect relationship, replace it explicitly, and require an explain-back.", "You asked for direct error explanations, so YOVA will name the exact gap before the retry.");
  if (normalized.includes("smaller steps")) return policyPart("smaller_steps", "Smaller steps", "After a miss, restore one intermediate step at a time before returning to independent work.", "You asked for smaller steps when stuck, so YOVA will restore support in bounded pieces.");
  if (normalized.includes("without help")) return policyPart("retry_independently", "Independent retry", "After concise feedback, offer a fresh unsupported attempt before adding more guidance.", "You asked to retry without help, so YOVA will preserve an independent second attempt when it is safe.");
  return policyPart("task_aligned", "Evidence-led repair", "Choose the smallest repair that addresses the demonstrated gap without lowering the target.", null);
}

function retentionPolicy(value: string | null | undefined) {
  const normalized = normalize(value);
  if (normalized.includes("cannot recall")) return policyPart("retrieval", "Recall without cues", "Require retrieval without visible notes before answer review.", "You report recognizing ideas without recalling them, so YOVA will emphasize producing answers without cues.");
  if (normalized.includes("few days")) return policyPart("delayed_retrieval", "Delayed retrieval", "End with a specific return point for another unsupported retrieval after a delay.", "You report forgetting after a few days, so YOVA will schedule a delayed retrieval instead of adding more rereading now.");
  if (normalized.includes("confuse similar")) return policyPart("discrimination", "Distinguish close ideas", "Use plausible contrasts that require choosing which concept applies and explaining the difference.", "You report confusing similar ideas, so YOVA will add contrast and discrimination checks.");
  if (normalized.includes("cannot apply")) return policyPart("transfer", "Apply in a new case", "Include a different application after the initial explanation or repair.", "You report understanding ideas but struggling to apply them, so YOVA will require transfer to a new case.");
  if (normalized.includes("with help")) return policyPart("fade_support", "Fade support", "Begin with enough guidance to succeed, then remove it before the completion check.", "You report succeeding with help but not yet independently, so YOVA will visibly fade support before completion.");
  return policyPart("task_aligned", "Task-led evidence", "Use the memory or application check that best matches the current task.", null);
}

function workspacePolicy(value: string | null | undefined) {
  const normalized = normalize(value);
  if (normalized.includes("one step")) return policyPart("one_step", "One step at a time", "Keep only the current action prominent while preserving an optional path preview.", null);
  if (normalized.includes("full path")) return policyPart("full_path", "Full path visible", "Keep the session path visible while one current action remains primary.", null);
  if (normalized.includes("choices")) return policyPart("learner_choice", "Guided choices", "Offer bounded choices only where more than one valid route preserves the learning target.", null);
  if (normalized.includes("least guidance")) return policyPart("minimal_guidance", "Minimal guidance", "Hide optional guidance until evidence shows that it is needed.", null);
  return policyPart("task_aligned", "Focused workspace", "Show one obvious current action with the session path available nearby.", null);
}

function observedPacingPolicy(results: RecentResult[], interruptions: Interruption[], estimatedMinutes: number, learnerProfile: LearnerProfile | null) {
  const standardMaximum = estimatedMinutes <= 15 ? 4 : estimatedMinutes <= 30 ? 5 : 8;
  const usableRatios = results
    .filter((result) => result.plannedMinutes && result.actualMinutes)
    .map((result) => (result.actualMinutes as number) / (result.plannedMinutes as number))
    .slice(0, 4);
  const repeatedEarlyExits = interruptions.filter((interruption) => {
    if (interruption.completedSteps !== null && interruption.totalSteps) {
      return interruption.completedSteps / interruption.totalSteps < 0.75;
    }
    return Boolean(interruption.plannedMinutes && interruption.actualMinutes && interruption.actualMinutes < interruption.plannedMinutes * 0.75);
  }).length >= 2;
  const consistentlyLong = usableRatios.length >= 2 && usableRatios.filter((ratio) => ratio > 1.25).length >= 2;
  const misconceptionSignals = results.filter((result) => result.calibrationPattern === "possible_misconception").length;

  if (repeatedEarlyExits) return {
    firstActionMinutes: 2,
    maximumActivities: Math.max(3, standardMaximum - 1),
    reason: "At least two recent sessions ended before most required work was reached, so this session starts smaller and contains fewer transitions.",
    learnerReason: "Two recent sessions ended early, so YOVA is reducing transitions and making the first action smaller. This is a pacing adjustment, not a judgment about ability.",
    signals: ["Repeated early session exits"],
  };
  if (consistentlyLong) return {
    firstActionMinutes: 3,
    maximumActivities: Math.max(3, standardMaximum - 1),
    reason: "At least two recent sessions ran materially longer than planned, so the current content slice is narrower.",
    learnerReason: "Recent sessions took longer than planned, so YOVA is narrowing today’s content rather than rushing through it.",
    signals: ["Repeated session timing overrun"],
  };
  if (misconceptionSignals) return {
    firstActionMinutes: Math.min(4, estimatedMinutes),
    maximumActivities: standardMaximum,
    reason: "A recent confident miss suggests that one tempting model should be contrasted explicitly before transfer.",
    learnerReason: "A recent confident miss suggests a misconception may be present, so YOVA will compare the tempting answer with the corrected model.",
    signals: ["Recent confidence and performance mismatch"],
  };
  const startingContext = normalize([learnerProfile?.commonBlocker, learnerProfile?.startingPattern].filter(Boolean).join(" "));
  if (/struggle to start|hard to start|procrast|often delay|overwhelm/.test(startingContext)) return {
    firstActionMinutes: 2,
    maximumActivities: standardMaximum,
    reason: "The learner reports that beginning is a recurring barrier, so the first action is deliberately small while the learning target stays unchanged.",
    learnerReason: "You said getting started is often the hardest part, so YOVA is making the first action small without reducing what counts as completion.",
    signals: [],
  };
  return {
    firstActionMinutes: Math.min(4, estimatedMinutes),
    maximumActivities: standardMaximum,
    reason: "There is not enough repeated behavior evidence to change the normal session size.",
    learnerReason: null,
    signals: [],
  };
}

function policyPart<Mode extends string>(mode: Mode, label: string, instruction: string, reason: string | null) {
  return { mode, label, instruction, reason };
}

function withoutReason<Mode extends string>(value: { mode: Mode; label: string; instruction: string; reason: string | null }) {
  return { mode: value.mode, label: value.label, instruction: value.instruction };
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

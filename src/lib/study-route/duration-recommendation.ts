import { z } from "zod";
import {
  LEARNING_TASK_TYPES,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  NORMAL_STUDY_DURATION_LEVELS,
  type NormalStudyDurationMinutes,
} from "@/lib/study-route/duration-precedence";
import {
  StudyRouteModeSchema,
  StudyRouteRuleTraceEntrySchema,
  type StudyRouteDurationSource,
  type StudyRouteMode,
  type StudyRouteRuleTraceEntry,
} from "@/lib/study-route/schema";

export const NORMAL_DURATION_RECOMMENDER_VERSION = "normal_duration_recommender_v1" as const;

export const DURATION_PLANNING_WINDOWS = [
  "morning",
  "afternoon",
  "evening",
  "late_night",
  "varies",
] as const;

export const DURATION_RISK_LEVELS = ["low", "moderate", "high"] as const;

export type DurationPlanningWindow = (typeof DURATION_PLANNING_WINDOWS)[number];
export type DurationRiskLevel = (typeof DURATION_RISK_LEVELS)[number];

export type NormalDurationOutcome = {
  kind: "completion" | "interruption";
  sessionClass: "normal" | "lightweight_review";
  taskFamily: LearningTaskType;
  mode: StudyRouteMode;
  occurredAt: string;
  routeRevisionId: string;
  plannedMinutes: number;
  actualMinutes: number;
  completedSteps?: number;
  totalSteps?: number;
  correctAnswers?: number;
  totalAnswers?: number;
  feedback?: "too_easy" | "about_right" | "too_difficult";
  evidenceRef: string;
};

export type NormalStudyDurationRecommendationInput = {
  context: {
    taskFamily: LearningTaskType;
    mode: StudyRouteMode;
  };
  profile: {
    sustainableMinutes: NormalStudyDurationMinutes | null;
    startingFrictionRisk: DurationRiskLevel | null;
    fatigueRisk: DurationRiskLevel | null;
    preferredWindow: DurationPlanningWindow | null;
    evidenceRefs: {
      sustainableMinutes: readonly string[];
      startingFrictionRisk: readonly string[];
      fatigueRisk: readonly string[];
      preferredWindow: readonly string[];
    };
  };
  schedule: {
    window: DurationPlanningWindow | null;
  };
  recentOutcomes: readonly NormalDurationOutcome[];
};

export type NormalStudyDurationRecommendation = {
  readonly minutes: NormalStudyDurationMinutes;
  readonly source: Extract<
    StudyRouteDurationSource,
    "router_default" | "profile_recommendation" | "observed_outcome_adjustment"
  >;
  readonly ruleTrace: readonly DeepReadonly<StudyRouteRuleTraceEntry>[];
};

const NormalStudyDurationSchema = z.union(
  NORMAL_STUDY_DURATION_LEVELS.map((minutes) => z.literal(minutes)) as [
    z.ZodLiteral<10>,
    z.ZodLiteral<15>,
    z.ZodLiteral<25>,
    z.ZodLiteral<45>,
    z.ZodLiteral<60>,
  ],
);
const DurationPlanningWindowSchema = z.enum(DURATION_PLANNING_WINDOWS);
const DurationRiskLevelSchema = z.enum(DURATION_RISK_LEVELS);
const EvidenceReferenceSchema = z.string().trim().min(1).max(200);

const NormalDurationOutcomeSchema = z.object({
  kind: z.enum(["completion", "interruption"]),
  sessionClass: z.enum(["normal", "lightweight_review"]),
  taskFamily: z.enum(LEARNING_TASK_TYPES),
  mode: StudyRouteModeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  routeRevisionId: z.string().uuid(),
  plannedMinutes: z.number().int().min(5).max(180),
  actualMinutes: z.number().int().min(0).max(240),
  completedSteps: z.number().int().nonnegative().max(500).optional(),
  totalSteps: z.number().int().positive().max(500).optional(),
  correctAnswers: z.number().int().nonnegative().max(500).optional(),
  totalAnswers: z.number().int().positive().max(500).optional(),
  feedback: z.enum(["too_easy", "about_right", "too_difficult"]).optional(),
  evidenceRef: EvidenceReferenceSchema,
}).strict().superRefine((outcome, context) => {
  if (outcome.sessionClass === "normal" && outcome.plannedMinutes < 10) {
    context.addIssue({
      code: "custom",
      path: ["plannedMinutes"],
      message: "A normal session outcome must have at least ten planned minutes.",
    });
  }
  if ((outcome.completedSteps === undefined) !== (outcome.totalSteps === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["completedSteps"],
      message: "Completed and total steps must be supplied together.",
    });
  }
  if (
    outcome.completedSteps !== undefined
    && outcome.totalSteps !== undefined
    && outcome.completedSteps > outcome.totalSteps
  ) {
    context.addIssue({
      code: "custom",
      path: ["completedSteps"],
      message: "Completed steps cannot exceed total steps.",
    });
  }
  if ((outcome.correctAnswers === undefined) !== (outcome.totalAnswers === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["correctAnswers"],
      message: "Correct and total answers must be supplied together.",
    });
  }
  if (
    outcome.correctAnswers !== undefined
    && outcome.totalAnswers !== undefined
    && outcome.correctAnswers > outcome.totalAnswers
  ) {
    context.addIssue({
      code: "custom",
      path: ["correctAnswers"],
      message: "Correct answers cannot exceed total answers.",
    });
  }
});

const ProfileEvidenceRefsSchema = z.object({
  sustainableMinutes: z.array(EvidenceReferenceSchema).max(20),
  startingFrictionRisk: z.array(EvidenceReferenceSchema).max(20),
  fatigueRisk: z.array(EvidenceReferenceSchema).max(20),
  preferredWindow: z.array(EvidenceReferenceSchema).max(20),
}).strict();

const NormalStudyDurationProfileSchema = z.object({
  sustainableMinutes: NormalStudyDurationSchema.nullable(),
  startingFrictionRisk: DurationRiskLevelSchema.nullable(),
  fatigueRisk: DurationRiskLevelSchema.nullable(),
  preferredWindow: DurationPlanningWindowSchema.nullable(),
  evidenceRefs: ProfileEvidenceRefsSchema,
}).strict().superRefine((profile, context) => {
  for (const signal of [
    "sustainableMinutes",
    "startingFrictionRisk",
    "fatigueRisk",
    "preferredWindow",
  ] as const) {
    const references = profile.evidenceRefs[signal];
    if (profile[signal] !== null && references.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs", signal],
        message: `The ${signal} signal requires its own evidence reference.`,
      });
    }
    if (profile[signal] === null && references.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs", signal],
        message: `The ${signal} evidence references must be empty when the signal is absent.`,
      });
    }
  }
});

const NormalStudyDurationRecommendationInputSchema = z.object({
  context: z.object({
    taskFamily: z.enum(LEARNING_TASK_TYPES),
    mode: StudyRouteModeSchema,
  }).strict(),
  profile: NormalStudyDurationProfileSchema,
  schedule: z.object({
    window: DurationPlanningWindowSchema.nullable(),
  }).strict(),
  recentOutcomes: z.array(NormalDurationOutcomeSchema).max(100),
}).strict().superRefine((value, context) => {
  const seenOutcomeRefs = new Set<string>();
  value.recentOutcomes.forEach((outcome, index) => {
    if (seenOutcomeRefs.has(outcome.evidenceRef)) {
      context.addIssue({
        code: "custom",
        path: ["recentOutcomes", index, "evidenceRef"],
        message: "Each outcome evidence reference must be unique before duration scoring.",
      });
    }
    seenOutcomeRefs.add(outcome.evidenceRef);
  });
});

/**
 * Selects the system's normal-session recommendation before learner agency
 * and hard availability are applied. Inputs must already have passed the
 * learner's personalization controls and evidence-exclusion boundary.
 */
export function recommendNormalStudyDuration(
  input: NormalStudyDurationRecommendationInput,
): NormalStudyDurationRecommendation {
  const parsed = NormalStudyDurationRecommendationInputSchema.parse(input);
  const baseline = parsed.profile.sustainableMinutes ?? 25;
  let minutes = baseline;
  let source: NormalStudyDurationRecommendation["source"] = parsed.profile.sustainableMinutes === null
    ? "router_default"
    : "profile_recommendation";
  const ruleTrace: StudyRouteRuleTraceEntry[] = [durationRecommendationTrace({
    ruleId: parsed.profile.sustainableMinutes === null
      ? "duration.recommendation.router_baseline"
      : "duration.recommendation.sustainable_baseline",
    result: `baseline_${baseline}_minutes`,
    reason: parsed.profile.sustainableMinutes === null
      ? `No authorized sustainable-duration answer is available, so YOVA uses the conservative 25-minute ${plainContext(parsed.context)} baseline.`
      : `The learner's authorized sustainable-duration answer sets a ${baseline}-minute starting recommendation.`,
    evidenceRefs: parsed.profile.sustainableMinutes === null
      ? []
      : unique(parsed.profile.evidenceRefs.sustainableMinutes),
  })];

  const comparableOutcomes = parsed.recentOutcomes
    .filter((outcome) => (
      outcome.sessionClass === "normal"
      && outcome.taskFamily === parsed.context.taskFamily
      && outcome.mode === parsed.context.mode
    ))
    .sort((left, right) => (
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || left.evidenceRef.localeCompare(right.evidenceRef)
    ))
    .slice(0, 4);
  const earlyInterruptions = comparableOutcomes.filter(isMeaningfulEarlyInterruption);

  if (earlyInterruptions.length >= 2) {
    minutes = lowerDurationLevel(baseline);
    if (minutes !== baseline) source = "observed_outcome_adjustment";
    ruleTrace.push(durationRecommendationTrace({
      ruleId: "duration.recommendation.repeated_early_exits",
      result: minutes === baseline
        ? `retained_${minutes}_minute_minimum`
        : `lowered_to_${minutes}_minutes`,
      reason: "At least two recent comparable sessions ended before most planned work was reached, so YOVA lowers the next recommendation by one level. This is a feasibility adjustment, not a judgment about ability.",
      evidenceRefs: outcomeEvidenceRefs(earlyInterruptions),
    }));
  } else if (parsed.profile.fatigueRisk === "high") {
    minutes = lowerDurationLevel(baseline);
    source = "profile_recommendation";
    ruleTrace.push(durationRecommendationTrace({
      ruleId: "duration.recommendation.declared_fatigue_risk",
      result: minutes === baseline
        ? `retained_${minutes}_minute_minimum`
        : `lowered_to_${minutes}_minutes`,
      reason: "The learner reports that performance can fall during longer demanding sessions, so YOVA lowers the starting recommendation by one level.",
      evidenceRefs: unique(parsed.profile.evidenceRefs.fatigueRisk),
    }));
  } else if (parsed.profile.startingFrictionRisk === "high") {
    minutes = lowerDurationLevel(baseline);
    source = "profile_recommendation";
    ruleTrace.push(durationRecommendationTrace({
      ruleId: "duration.recommendation.declared_starting_friction",
      result: minutes === baseline
        ? `retained_${minutes}_minute_minimum`
        : `lowered_to_${minutes}_minutes`,
      reason: "The learner reports recurring difficulty beginning, so YOVA lowers the starting recommendation by one level while keeping the learning target intact.",
      evidenceRefs: unique(parsed.profile.evidenceRefs.startingFrictionRisk),
    }));
  } else if (hasDeclaredWindowMismatch(parsed.profile.preferredWindow, parsed.schedule.window)) {
    minutes = lowerDurationLevel(baseline);
    source = "profile_recommendation";
    ruleTrace.push(durationRecommendationTrace({
      ruleId: "duration.recommendation.declared_window_fit",
      result: minutes === baseline
        ? `retained_${minutes}_minute_minimum`
        : `lowered_to_${minutes}_minutes`,
      reason: `This session is scheduled for ${windowLabel(parsed.schedule.window)}, outside the learner's declared ${windowLabel(parsed.profile.preferredWindow)} planning window, so YOVA lowers the recommendation by one level.`,
      evidenceRefs: unique(parsed.profile.evidenceRefs.preferredWindow),
    }));
  } else {
    const stableCompletions = comparableOutcomes.filter(isStableCompletion);
    if (stableCompletions.length >= 4) {
      minutes = raiseDurationLevel(baseline);
      if (minutes !== baseline) source = "observed_outcome_adjustment";
      ruleTrace.push(durationRecommendationTrace({
        ruleId: "duration.recommendation.repeated_stable_completions",
        result: minutes === baseline
          ? `retained_${minutes}_minute_maximum`
          : `raised_to_${minutes}_minutes`,
        reason: "Four recent comparable normal sessions were completed near their planned time, with at least three scored answers and maintained performance in each, so YOVA raises the next recommendation by one level.",
        evidenceRefs: outcomeEvidenceRefs(stableCompletions),
      }));
    }
  }

  return deepFreeze({ minutes, source, ruleTrace });
}

function isMeaningfulEarlyInterruption(outcome: z.infer<typeof NormalDurationOutcomeSchema>) {
  if (outcome.kind !== "interruption") return false;
  if (outcome.completedSteps !== undefined && outcome.totalSteps !== undefined) {
    return outcome.completedSteps / outcome.totalSteps < 0.75;
  }
  return outcome.actualMinutes / outcome.plannedMinutes < 0.75;
}

function isStableCompletion(outcome: z.infer<typeof NormalDurationOutcomeSchema>) {
  if (
    outcome.kind !== "completion"
    || outcome.feedback !== "about_right"
    || outcome.correctAnswers === undefined
    || outcome.totalAnswers === undefined
    || outcome.totalAnswers < 3
  ) return false;
  const timeRatio = outcome.actualMinutes / outcome.plannedMinutes;
  return timeRatio >= 0.75
    && timeRatio <= 1.25
    && outcome.correctAnswers / outcome.totalAnswers >= 0.8;
}

function hasDeclaredWindowMismatch(
  preferredWindow: DurationPlanningWindow | null,
  scheduledWindow: DurationPlanningWindow | null,
) {
  return preferredWindow !== null
    && scheduledWindow !== null
    && preferredWindow !== "varies"
    && scheduledWindow !== "varies"
    && preferredWindow !== scheduledWindow;
}

function lowerDurationLevel(minutes: NormalStudyDurationMinutes) {
  const index = NORMAL_STUDY_DURATION_LEVELS.indexOf(minutes);
  return NORMAL_STUDY_DURATION_LEVELS[Math.max(0, index - 1)]!;
}

function raiseDurationLevel(minutes: NormalStudyDurationMinutes) {
  const index = NORMAL_STUDY_DURATION_LEVELS.indexOf(minutes);
  return NORMAL_STUDY_DURATION_LEVELS[Math.min(NORMAL_STUDY_DURATION_LEVELS.length - 1, index + 1)]!;
}

function outcomeEvidenceRefs(outcomes: readonly z.infer<typeof NormalDurationOutcomeSchema>[]) {
  return unique(outcomes.flatMap((outcome) => [
    outcome.evidenceRef,
    `route-revision:${outcome.routeRevisionId}`,
  ])).slice(0, 40);
}

function durationRecommendationTrace({
  ruleId,
  result,
  reason,
  evidenceRefs,
}: StudyRouteRuleTraceEntry) {
  return StudyRouteRuleTraceEntrySchema.parse({ ruleId, result, reason, evidenceRefs });
}

function plainContext(context: { taskFamily: LearningTaskType; mode: StudyRouteMode }) {
  return `${context.mode} ${context.taskFamily.replaceAll("_", " ")}`;
}

function windowLabel(window: DurationPlanningWindow | null) {
  return (window ?? "unknown").replaceAll("_", " ");
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

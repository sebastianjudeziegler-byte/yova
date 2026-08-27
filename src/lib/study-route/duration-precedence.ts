import {
  StudyRouteDurationSourceSchema,
  StudyRouteRuleTraceEntrySchema,
  StudyRouteTimingSchema,
  type StudyRouteDurationSource,
  type StudyRouteRuleTraceEntry,
  type StudyRouteTiming,
} from "@/lib/study-route/schema";
import {
  NORMAL_STUDY_DURATION_LEVELS,
  type NormalStudyDurationMinutes,
} from "@/lib/study-route/duration-levels";

export {
  NORMAL_STUDY_DURATION_LEVELS,
  type NormalStudyDurationMinutes,
} from "@/lib/study-route/duration-levels";

/**
 * The learner-facing duration choices for an ordinary Learn or Practice
 * session. Lightweight reviews keep their separate contract (currently five
 * or ten minutes) and must not pass through this resolver.
 */
type SystemDurationSource = Extract<
  StudyRouteDurationSource,
  "router_default" | "profile_recommendation" | "observed_outcome_adjustment"
>;

export type NormalStudyDurationPrecedenceInput = {
  /**
   * The deterministic system recommendation produced before agency and
   * availability are applied. Task, profile, time-of-day, and outcome scoring
   * belong in that upstream recommendation, not in this precedence boundary.
   */
  systemRecommendation: {
    minutes: NormalStudyDurationMinutes;
    source: SystemDurationSource;
    ruleTrace: readonly DeepReadonly<StudyRouteRuleTraceEntry>[];
  };
  /** A one-session learner choice. It never rewrites the durable profile. */
  learnerOverrideMinutes?: NormalStudyDurationMinutes | null;
  /** Exact available time. It is always a hard elapsed-time maximum. */
  hardMaximumMinutes?: number | null;
};

export type ResolvedNormalStudyDuration = {
  readonly status: "resolved";
  readonly timing: DeepReadonly<StudyRouteTiming>;
  readonly ruleTrace: readonly DeepReadonly<StudyRouteRuleTraceEntry>[];
};

export type InsufficientNormalStudyDuration = {
  readonly status: "insufficient_time";
  readonly minimumMinutes: typeof NORMAL_STUDY_DURATION_LEVELS[0];
  readonly hardMaximumMinutes: number;
  readonly ruleTrace: readonly DeepReadonly<StudyRouteRuleTraceEntry>[];
};

export type NormalStudyDurationPrecedenceResult =
  | ResolvedNormalStudyDuration
  | InsufficientNormalStudyDuration;

const SYSTEM_DURATION_SOURCES = new Set<SystemDurationSource>([
  "router_default",
  "profile_recommendation",
  "observed_outcome_adjustment",
]);

// A StudyRoute permits at most 200 provenance entries. This resolver can add
// one learner-override entry and one availability entry.
const MAX_INPUT_RULE_TRACE_ENTRIES = 198;

/**
 * Applies agency and hard availability to an already-computed normal-session
 * recommendation. It does not score task/profile/history signals, allocate
 * phases, defer targets, insert breaks, or handle scheduled reviews.
 */
export function resolveNormalStudyDurationPrecedence(
  input: NormalStudyDurationPrecedenceInput,
): NormalStudyDurationPrecedenceResult {
  const systemMinutes = requireNormalDuration(
    input.systemRecommendation.minutes,
    "The system duration recommendation",
  );
  const parsedSource = StudyRouteDurationSourceSchema.parse(
    input.systemRecommendation.source,
  );
  if (!SYSTEM_DURATION_SOURCES.has(parsedSource as SystemDurationSource)) {
    throw new Error(
      "A system duration recommendation must come from the router default, the learner profile, or comparable observed outcomes.",
    );
  }

  if (input.systemRecommendation.ruleTrace.length === 0) {
    throw new Error("A duration recommendation must supply at least one rule-trace entry.");
  }
  if (input.systemRecommendation.ruleTrace.length > MAX_INPUT_RULE_TRACE_ENTRIES) {
    throw new Error(
      `A duration recommendation may supply at most ${MAX_INPUT_RULE_TRACE_ENTRIES} prior rule-trace entries.`,
    );
  }
  const ruleTrace = input.systemRecommendation.ruleTrace.map((entry) => (
    StudyRouteRuleTraceEntrySchema.parse(entry)
  ));

  let selectedMinutes = systemMinutes;
  let durationSource: StudyRouteDurationSource = parsedSource;
  const learnerOverride = input.learnerOverrideMinutes;
  if (learnerOverride !== undefined && learnerOverride !== null) {
    selectedMinutes = requireNormalDuration(
      learnerOverride,
      "The learner duration override",
    );
    durationSource = "learner_override";
    ruleTrace.push(durationRuleTrace({
      ruleId: "duration.learner_override",
      result: `selected_${selectedMinutes}_minutes`,
      reason: `The learner selected ${selectedMinutes} minutes for this session only.`,
    }));
  }

  const hardMaximum = input.hardMaximumMinutes;
  if (hardMaximum === undefined || hardMaximum === null) {
    return immutableResolvedResult({
      activeMinutes: selectedMinutes,
      elapsedMinutes: selectedMinutes,
      durationSource,
    }, ruleTrace);
  }

  requireHardMaximum(hardMaximum);
  if (hardMaximum < NORMAL_STUDY_DURATION_LEVELS[0]) {
    ruleTrace.push(durationRuleTrace({
      ruleId: "duration.availability_cap",
      result: "insufficient_normal_session_time",
      reason: `${hardMaximum} available minutes cannot hold YOVA's minimum 10-minute normal session.`,
    }));
    return deepFreeze({
      status: "insufficient_time",
      minimumMinutes: NORMAL_STUDY_DURATION_LEVELS[0],
      hardMaximumMinutes: hardMaximum,
      ruleTrace,
    });
  }

  const maximumPermitted = Math.min(selectedMinutes, hardMaximum);
  const cappedMinutes = largestNormalDurationAtMost(maximumPermitted);
  const availabilityChangedDuration = cappedMinutes < selectedMinutes;
  if (availabilityChangedDuration) durationSource = "availability_cap";
  ruleTrace.push(durationRuleTrace({
    ruleId: "duration.availability_cap",
    result: availabilityChangedDuration
      ? `capped_to_${cappedMinutes}_minutes`
      : "recommended_duration_fits",
    reason: availabilityChangedDuration
      ? `The learner has ${hardMaximum} minutes available, so YOVA reduced the session to the largest normal duration that fits.`
      : `The selected ${selectedMinutes}-minute session fits within the learner's ${hardMaximum}-minute maximum.`,
  }));

  return immutableResolvedResult({
    activeMinutes: cappedMinutes,
    elapsedMinutes: cappedMinutes,
    durationSource,
    hardMaximumMinutes: hardMaximum,
  }, ruleTrace);
}

function immutableResolvedResult(
  timing: StudyRouteTiming,
  ruleTrace: StudyRouteRuleTraceEntry[],
): ResolvedNormalStudyDuration {
  return deepFreeze({
    status: "resolved",
    timing: StudyRouteTimingSchema.parse(timing),
    ruleTrace,
  });
}

function requireNormalDuration(value: unknown, label: string): NormalStudyDurationMinutes {
  if (
    typeof value !== "number"
    || !NORMAL_STUDY_DURATION_LEVELS.some((minutes) => minutes === value)
  ) {
    throw new Error(
      `${label} must be one of ${NORMAL_STUDY_DURATION_LEVELS.join(", ")} minutes.`,
    );
  }
  return value as NormalStudyDurationMinutes;
}

function requireHardMaximum(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 240) {
    throw new Error("The hard duration maximum must be a whole number from 1 to 240 minutes.");
  }
}

function largestNormalDurationAtMost(maximumMinutes: number): NormalStudyDurationMinutes {
  for (let index = NORMAL_STUDY_DURATION_LEVELS.length - 1; index >= 0; index -= 1) {
    const candidate = NORMAL_STUDY_DURATION_LEVELS[index]!;
    if (candidate <= maximumMinutes) return candidate;
  }
  throw new Error("No normal study duration fits the supplied maximum.");
}

function durationRuleTrace({
  ruleId,
  result,
  reason,
}: {
  ruleId: string;
  result: string;
  reason: string;
}) {
  return StudyRouteRuleTraceEntrySchema.parse({
    ruleId,
    result,
    reason,
    evidenceRefs: [],
  });
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

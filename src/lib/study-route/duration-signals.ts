import { z } from "zod";
import type {
  LearningPlanSession,
  SessionCompletion,
  SessionInterruption,
} from "@/lib/domain";
import {
  type PersonalizationSignalCorrection,
  type PersonalizationState,
  readPersonalizationStateFromAnswers,
} from "@/lib/personalization/personalization-state";
import { onboardingAnswerId } from "@/lib/sample-data";
import {
  type DurationPlanningWindow,
  type DurationRiskLevel,
  type NormalDurationOutcome,
  type NormalStudyDurationRecommendationInput,
} from "@/lib/study-route/duration-recommendation";
import type { NormalStudyDurationMinutes } from "@/lib/study-route/duration-precedence";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import { classifyStudyProfileScore } from "@/lib/study-profile/scoring";
import type { StudyProfileDimension } from "@/lib/study-profile/types";

export const DURATION_PROFILE_SIGNAL_IDS = Object.freeze({
  sustainableMinutes: "signal:sustainable_duration",
  startingFrictionRisk: "signal:starting_friction",
  fatigueRisk: "signal:cognitive_stamina",
  preferredWindow: "signal:energy_window",
} as const);

export const DURATION_SIGNAL_ADAPTER_VERSION = "duration_signal_adapter_v1" as const;

export type AuthorizedNormalDurationProfile =
  NormalStudyDurationRecommendationInput["profile"];

export type NormalDurationEvidenceSession = Pick<
  LearningPlanSession,
  "id" | "estimatedMinutes" | "reviewType" | "reviewConcept" | "resource" | "studyRoute"
>;

export type NormalDurationEvidencePlan = {
  id: string;
  sessions: readonly NormalDurationEvidenceSession[];
};

export type AuthorizedNormalDurationOutcomeInput = {
  answers: readonly string[];
  plans: readonly NormalDurationEvidencePlan[];
  completions: readonly SessionCompletion[];
  interruptions: readonly SessionInterruption[];
};

type ProfileSignal<Value> = {
  value: Value;
  evidenceRefs: string[];
};

type NormalSessionAuthority = {
  planId: string;
  sessionId: string;
  route: StudyRoute;
};

const IsoTimestampSchema = z.string().datetime({ offset: true });

const SUSTAINABLE_DURATION_CORRECTIONS = new Map<string, NormalStudyDurationMinutes>([
  ["10", 10],
  ["10 minutes", 10],
  ["15", 15],
  ["15 minutes", 15],
  ["25", 25],
  ["25 minutes", 25],
  ["45", 45],
  ["45 minutes", 45],
  ["60", 60],
  ["60 minutes", 60],
  ["minutes_10_15", 15],
  ["10 to 15 minutes", 15],
  ["minutes_20_30", 25],
  ["20 to 30 minutes", 25],
  ["minutes_30_45", 45],
  ["30 to 45 minutes", 45],
  ["minutes_45_60", 60],
  ["45 to 60 minutes", 60],
]);

const STARTING_FRICTION_CORRECTIONS = new Map<string, DurationRiskLevel>([
  ["low", "low"],
  ["usually easy to begin", "low"],
  ["moderate", "moderate"],
  ["some trouble beginning", "moderate"],
  ["high", "high"],
  ["higher starting friction", "high"],
  ["hard to begin", "high"],
]);

const FATIGUE_RISK_CORRECTIONS = new Map<string, DurationRiskLevel>([
  ["stable", "low"],
  ["longer blocks can work", "low"],
  ["moderate decline", "moderate"],
  ["energy fades over time", "moderate"],
  ["fast decline", "high"],
  ["short blocks work best", "high"],
]);

const PLANNING_WINDOW_CORRECTIONS = new Map<string, DurationPlanningWindow>([
  ["morning", "morning"],
  ["afternoon", "afternoon"],
  ["evening", "evening"],
  ["late_night", "late_night"],
  ["late night", "late_night"],
  ["varies", "varies"],
  ["it changes", "varies"],
]);

/**
 * Projects only learner-authorized, structured profile evidence into the
 * normal-duration recommender. Unsupported free text never becomes a signal.
 */
export function buildAuthorizedNormalDurationProfile(
  answers: readonly string[],
): AuthorizedNormalDurationProfile {
  const state = readPersonalizationStateFromAnswers(answers);
  const sustainable = state.controls.selfReport
    ? controlledProfileSignal({
        state,
        signalId: DURATION_PROFILE_SIGNAL_IDS.sustainableMinutes,
        correctionValues: SUSTAINABLE_DURATION_CORRECTIONS,
        fallback: () => sustainableDurationFromOnboarding(answers, state),
      })
    : null;
  const startingFriction = state.controls.selfReport
    ? controlledProfileSignal({
        state,
        signalId: DURATION_PROFILE_SIGNAL_IDS.startingFrictionRisk,
        correctionValues: STARTING_FRICTION_CORRECTIONS,
        fallback: () => startingFrictionFromProfile(answers, state),
      })
    : null;
  const fatigueRisk = state.controls.selfReport
    ? controlledProfileSignal({
        state,
        signalId: DURATION_PROFILE_SIGNAL_IDS.fatigueRisk,
        correctionValues: FATIGUE_RISK_CORRECTIONS,
        fallback: () => studyProfileRisk("cognitive_stamina", state),
      })
    : null;
  const preferredWindow = state.controls.timing
    ? controlledProfileSignal({
        state,
        signalId: DURATION_PROFILE_SIGNAL_IDS.preferredWindow,
        correctionValues: PLANNING_WINDOW_CORRECTIONS,
        fallback: () => preferredWindowFromOnboarding(answers, state),
      })
    : null;

  return deepFreeze({
    sustainableMinutes: sustainable?.value ?? null,
    startingFrictionRisk: startingFriction?.value ?? null,
    fatigueRisk: fatigueRisk?.value ?? null,
    preferredWindow: preferredWindow?.value ?? null,
    evidenceRefs: {
      sustainableMinutes: stableRefs(sustainable?.evidenceRefs ?? []),
      startingFrictionRisk: stableRefs(startingFriction?.evidenceRefs ?? []),
      fatigueRisk: stableRefs(fatigueRisk?.evidenceRefs ?? []),
      preferredWindow: stableRefs(preferredWindow?.evidenceRefs ?? []),
    },
  });
}

/**
 * Converts only exact, committed, normal StudyRoute outcomes into bounded
 * duration evidence. Legacy, review, excluded, duplicated, or mismatched rows
 * are omitted instead of being guessed back into shape.
 */
export function buildAuthorizedNormalDurationOutcomes({
  answers,
  plans,
  completions,
  interruptions,
}: AuthorizedNormalDurationOutcomeInput): readonly NormalDurationOutcome[] {
  const state = readPersonalizationStateFromAnswers(answers);
  if (!state.controls.behavior) return deepFreeze([]);

  const authorities = normalSessionAuthorities(plans);
  const rawEvidenceRefCounts = countEvidenceRefs(completions, interruptions);
  const excluded = new Set(state.excludedEvidenceRefs);
  const outcomes = [
    ...completions.flatMap((completion) => {
      const evidenceRef = validEvidenceRef(completion.id);
      if (
        !evidenceRef
        || rawEvidenceRefCounts.get(evidenceRef) !== 1
        || excluded.has(evidenceRef)
      ) return [];
      const authority = authorities.get(sessionKey(completion.planId, completion.planSessionId));
      if (authority && excluded.has(routeEvidenceRef(authority.route.identity.routeRevisionId))) {
        return [];
      }
      const outcome = authority
        ? completionOutcome(completion, authority, evidenceRef)
        : null;
      return outcome ? [outcome] : [];
    }),
    ...interruptions.flatMap((interruption) => {
      const evidenceRef = validEvidenceRef(interruption.id);
      if (
        !evidenceRef
        || rawEvidenceRefCounts.get(evidenceRef) !== 1
        || excluded.has(evidenceRef)
      ) return [];
      const authority = authorities.get(sessionKey(interruption.planId, interruption.planSessionId));
      if (authority && excluded.has(routeEvidenceRef(authority.route.identity.routeRevisionId))) {
        return [];
      }
      const outcome = authority
        ? interruptionOutcome(interruption, authority, evidenceRef)
        : null;
      return outcome ? [outcome] : [];
    }),
  ].sort((left, right) => (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || left.evidenceRef.localeCompare(right.evidenceRef)
    || left.kind.localeCompare(right.kind)
  )).slice(0, 100);

  return deepFreeze(outcomes);
}

function controlledProfileSignal<Value>({
  state,
  signalId,
  correctionValues,
  fallback,
}: {
  state: PersonalizationState;
  signalId: string;
  correctionValues: ReadonlyMap<string, Value>;
  fallback: () => ProfileSignal<Value> | null;
}): ProfileSignal<Value> | null {
  if (state.pausedSignalIds.includes(signalId)) return null;
  const correction = state.corrections.find((item) => item.signalId === signalId);
  if (correction?.doNotInfer) return null;
  const correctedValue = normalizedCorrectionValue(correction);
  if (correctedValue && correction) {
    const value = correctionValues.get(correctedValue);
    const evidenceRef = correctionEvidenceRef(signalId, correction);
    return value === undefined || state.excludedEvidenceRefs.includes(evidenceRef)
      ? null
      : { value, evidenceRefs: [evidenceRef] };
  }
  return fallback();
}

function sustainableDurationFromOnboarding(
  answers: readonly string[],
  state: PersonalizationState,
): ProfileSignal<NormalStudyDurationMinutes> | null {
  const answerId = onboardingAnswerId(2, answers[2]);
  const minutes = answerId ? SUSTAINABLE_DURATION_CORRECTIONS.get(answerId) : undefined;
  const evidenceRef = "profile:onboarding:2";
  return minutes === undefined || state.excludedEvidenceRefs.includes(evidenceRef)
    ? null
    : { value: minutes, evidenceRefs: [evidenceRef] };
}

function startingFrictionFromProfile(
  answers: readonly string[],
  state: PersonalizationState,
): ProfileSignal<DurationRiskLevel> | null {
  const studyProfile = studyProfileRisk("starting_friction", state);
  if (studyProfile) return studyProfile;

  const blocker = onboardingAnswerId(0, answers[0]);
  const startingPattern = onboardingAnswerId(5, answers[5]);
  const highBlockers = new Set(["struggle_to_start", "unclear_first_step", "overwhelmed"]);
  const highPatterns = new Set(["often_delay", "deadline_pressure", "planning_avoidance"]);
  const evidenceRefs = [
    highBlockers.has(blocker ?? "") ? "profile:onboarding:0" : null,
    highPatterns.has(startingPattern ?? "") ? "profile:onboarding:5" : null,
  ].filter((reference): reference is string => Boolean(reference));
  if (evidenceRefs.length > 0 && evidenceRefs.every((reference) => (
    !state.excludedEvidenceRefs.includes(reference)
  ))) {
    return { value: "high", evidenceRefs };
  }
  const lowEvidenceRef = "profile:onboarding:5";
  return startingPattern === "on_time" && !state.excludedEvidenceRefs.includes(lowEvidenceRef)
    ? { value: "low", evidenceRefs: [lowEvidenceRef] }
    : null;
}

function studyProfileRisk(
  dimension: Extract<StudyProfileDimension, "starting_friction" | "cognitive_stamina">,
  state: PersonalizationState,
): ProfileSignal<DurationRiskLevel> | null {
  const questions = STUDY_PROFILE_QUESTIONS.filter((question) => (
    question.dimension === dimension
  ));
  if (questions.length !== 2) return null;
  const evidenceRefs = questions.map((question) => `profile:study-profile:${question.id}`);
  if (evidenceRefs.some((reference) => state.excludedEvidenceRefs.includes(reference))) {
    return null;
  }
  const scores = questions.flatMap((question) => {
    const answer = state.studyProfile.answers[question.id];
    const option = question.options.find((candidate) => candidate.id === answer);
    return option ? [option.score] : [];
  });
  return scores.length === questions.length
    ? {
        value: classifyStudyProfileScore(scores.reduce<number>((sum, score) => sum + score, 0)),
        evidenceRefs,
      }
    : null;
}

function preferredWindowFromOnboarding(
  answers: readonly string[],
  state: PersonalizationState,
): ProfileSignal<DurationPlanningWindow> | null {
  const answerId = onboardingAnswerId(6, answers[6]);
  const window = answerId ? PLANNING_WINDOW_CORRECTIONS.get(answerId) : undefined;
  const evidenceRef = "profile:onboarding:6";
  return window === undefined || state.excludedEvidenceRefs.includes(evidenceRef)
    ? null
    : { value: window, evidenceRefs: [evidenceRef] };
}

function normalSessionAuthorities(
  plans: readonly NormalDurationEvidencePlan[],
): Map<string, NormalSessionAuthority> {
  const rawKeyCounts = new Map<string, number>();
  for (const plan of plans) {
    if (!validIdentityPart(plan.id) || !Array.isArray(plan.sessions)) continue;
    for (const session of plan.sessions) {
      if (!validIdentityPart(session.id)) continue;
      const key = sessionKey(plan.id, session.id);
      rawKeyCounts.set(key, (rawKeyCounts.get(key) ?? 0) + 1);
    }
  }

  const authorities = new Map<string, NormalSessionAuthority>();
  for (const plan of plans) {
    if (!validIdentityPart(plan.id) || !Array.isArray(plan.sessions)) continue;
    for (const session of plan.sessions) {
      if (!validIdentityPart(session.id)) continue;
      const key = sessionKey(plan.id, session.id);
      if (rawKeyCounts.get(key) !== 1) continue;
      const authority = normalSessionAuthority(plan, session);
      if (authority) authorities.set(key, authority);
    }
  }
  return authorities;
}

function normalSessionAuthority(
  plan: NormalDurationEvidencePlan,
  session: NormalDurationEvidenceSession,
): NormalSessionAuthority | null {
  const parsed = StudyRouteSchema.safeParse(session.studyRoute);
  if (!parsed.success) return null;
  const route = parsed.data;
  if (
    route.identity.lifecycleStatus !== "committed"
    || route.identity.planId !== plan.id
    || route.identity.sessionId !== session.id
    || session.reviewType != null
    || Boolean(session.reviewConcept?.trim())
    || route.timing.durationSource === "scheduled_review"
    || route.timing.activeMinutes < 10
    || session.estimatedMinutes !== route.timing.activeMinutes
    || !resourceMatchesRoute(session, route.identity.routeRevisionId)
  ) return null;
  return { planId: plan.id, sessionId: session.id, route };
}

function resourceMatchesRoute(
  session: NormalDurationEvidenceSession,
  routeRevisionId: string,
) {
  if (!session.resource) return true;
  if (session.resource.routeRevisionId !== routeRevisionId) return false;
  return !session.resource.cacheContext
    || session.resource.cacheContext.routeRevisionId === routeRevisionId;
}

function completionOutcome(
  completion: SessionCompletion,
  authority: NormalSessionAuthority,
  evidenceRef: string,
): NormalDurationOutcome | null {
  if (
    !eventMatchesAuthority(completion, authority)
    || !validOutcomeTiming(completion.startedAt, completion.completedAt, completion.actualMinutes)
    || !validFeedback(completion.feedback)
    || !validAnswerCounts(completion.correctAnswers, completion.totalAnswers)
  ) return null;

  return {
    kind: "completion",
    sessionClass: "normal",
    taskFamily: authority.route.target.taskFamily,
    mode: authority.route.approach.mode,
    occurredAt: completion.completedAt,
    routeRevisionId: authority.route.identity.routeRevisionId,
    plannedMinutes: authority.route.timing.activeMinutes,
    actualMinutes: completion.actualMinutes,
    ...(completion.totalAnswers > 0 ? {
      correctAnswers: completion.correctAnswers,
      totalAnswers: completion.totalAnswers,
    } : {}),
    feedback: completion.feedback,
    evidenceRef,
  };
}

function interruptionOutcome(
  interruption: SessionInterruption,
  authority: NormalSessionAuthority,
  evidenceRef: string,
): NormalDurationOutcome | null {
  if (
    !eventMatchesAuthority(interruption, authority)
    || !validOutcomeTiming(interruption.startedAt, interruption.interruptedAt, interruption.actualMinutes)
    || !validStepCounts(interruption.completedSteps, interruption.totalSteps)
  ) return null;

  return {
    kind: "interruption",
    sessionClass: "normal",
    taskFamily: authority.route.target.taskFamily,
    mode: authority.route.approach.mode,
    occurredAt: interruption.interruptedAt,
    routeRevisionId: authority.route.identity.routeRevisionId,
    plannedMinutes: authority.route.timing.activeMinutes,
    actualMinutes: interruption.actualMinutes,
    ...(interruption.totalSteps > 0 ? {
      completedSteps: interruption.completedSteps,
      totalSteps: interruption.totalSteps,
    } : {}),
    evidenceRef,
  };
}

function eventMatchesAuthority(
  event: Pick<
    SessionCompletion | SessionInterruption,
    "planId" | "planSessionId" | "routeRevisionId" | "plannedMinutes"
  >,
  authority: NormalSessionAuthority,
) {
  return event.planId === authority.planId
    && event.planSessionId === authority.sessionId
    && event.routeRevisionId === authority.route.identity.routeRevisionId
    && event.plannedMinutes === authority.route.timing.activeMinutes;
}

function validOutcomeTiming(
  startedAt: string,
  occurredAt: string,
  actualMinutes: number,
) {
  if (
    !IsoTimestampSchema.safeParse(startedAt).success
    || !IsoTimestampSchema.safeParse(occurredAt).success
    || !Number.isInteger(actualMinutes)
    || actualMinutes < 0
    || actualMinutes > 240
  ) return false;
  return Date.parse(startedAt) <= Date.parse(occurredAt);
}

function validAnswerCounts(correct: number, total: number) {
  return Number.isInteger(correct)
    && Number.isInteger(total)
    && total >= 0
    && total <= 500
    && correct >= 0
    && correct <= total;
}

function validStepCounts(completed: number, total: number) {
  return Number.isInteger(completed)
    && Number.isInteger(total)
    && total >= 0
    && total <= 500
    && completed >= 0
    && completed <= total;
}

function validFeedback(value: string) {
  return value === "too_easy" || value === "about_right" || value === "too_difficult";
}

function countEvidenceRefs(
  completions: readonly SessionCompletion[],
  interruptions: readonly SessionInterruption[],
) {
  const counts = new Map<string, number>();
  for (const event of [...completions, ...interruptions]) {
    const evidenceRef = validEvidenceRef(event.id);
    if (evidenceRef) counts.set(evidenceRef, (counts.get(evidenceRef) ?? 0) + 1);
  }
  return counts;
}

function validEvidenceRef(value: string) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && value.trim() === value
    ? value
    : null;
}

function validIdentityPart(value: string) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function sessionKey(planId: string, sessionId: string) {
  return `${planId}\u0000${sessionId}`;
}

function routeEvidenceRef(routeRevisionId: string) {
  return `route-revision:${routeRevisionId}`;
}

function normalizedCorrectionValue(
  correction: PersonalizationSignalCorrection | undefined,
) {
  const value = correction?.correctedValue?.trim().toLowerCase() ?? "";
  return value || null;
}

function correctionEvidenceRef(
  signalId: string,
  correction: PersonalizationSignalCorrection,
) {
  return `profile:correction:${signalId.replace(/^signal:/, "")}:${correction.updatedAt}`;
}

function stableRefs(values: readonly string[]) {
  return [...new Set(values)].sort();
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

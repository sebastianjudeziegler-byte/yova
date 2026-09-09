import { expect } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { createCanonicalLearnerProfile, type CanonicalProfileSignal } from "@/lib/personalization/canonical-profile-schema";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { resolvePersonalizationRollout } from "@/lib/study-route/personalization-rollout";

export const DELTA_NOW = new Date("2026-09-07T08:00:00.000Z");
export const PROFILE_1 = "I lose focus after 20 minutes. Show me an example before asking me anything. Give me hints before explanations. I'm stuck on the electron transport chain.";
export const PROFILE_2 = "I can study for an hour straight. I like to explain things in my own words first and then check. Give me the explanation directly.";
export const DELTA_TITLES = ["ATP and energy transfer", "Enzymes and activation energy", "Glycolysis", "Krebs cycle", "Electron transport chain", "Photosynthesis"];
export const deltaTopicId = (index: number) => `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

export function deltaFixture(profile: 1 | 2, overrides: { goal?: string; startingContext?: string; signals?: CanonicalProfileSignal[] } = {}) {
  const values: Array<Pick<CanonicalProfileSignal, "signalId" | "value">> = profile === 1 ? [
    { signalId: "unfamiliar_entry", value: "concrete_example" },
    { signalId: "first_repair", value: "hint_first" },
    { signalId: "realistic_session_length", value: "minutes_20_30" },
    { signalId: "focus_pacing", value: "shorter_blocks" },
  ] : [
    { signalId: "successful_approach", value: "explain_from_memory" },
    { signalId: "first_repair", value: "direct_correction" },
    { signalId: "realistic_session_length", value: "minutes_45_60" },
    { signalId: "focus_pacing", value: "steady_block" },
  ];
  const canonicalProfile = createCanonicalLearnerProfile(overrides.signals ?? values.map(value => ({ ...value, source: "canonical_questionnaire", sourceQuestionId: `profile_${value.signalId}`, provenance: "direct_answer" })));
  const request = PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: "learn",
    goal: overrides.goal ?? "Understand AP Biology cellular energetics, including ATP, enzymes, respiration and photosynthesis.",
    startingContext: overrides.startingContext ?? (profile === 1 ? "The ETC confuses me." : "I am beginning this unit."),
    profileSummary: profile === 1 ? PROFILE_1 : PROFILE_2,
    materialMode: "none", materials: [], studyMode: "inside",
    deadline: "2026-09-28T20:00:00.000Z", timeZone: "UTC", diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Morning", minutes: 120 }],
    knowledgeMap: {
      version: 1,
      scopeJudgment: { band: "unit_or_exam", label: "AP Biology cellular energetics", minimumSessions: 12, recommendedSessions: 12, maximumSessions: 12, minimumTeachingSessions: 6, explanation: "Learn each of the six topics and then apply each independently." },
      topics: DELTA_TITLES.map((title, index) => ({
        id: deltaTopicId(index), title, description: `Explain ${title} in cellular energetics.`, subtopics: [],
        prerequisiteTopicIds: index === 4 ? [deltaTopicId(0)] : [], status: "not_started", initialEvidence: null,
        sourceReferences: [], origin: "ai_generated", deferred: null,
      })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
  const methodContext = {
    profileVersion: `delta_saved_profile_${profile}`,
    personalization: { canonicalProfile, decisions: [], methodTie: { state: { controls: { experiments: false }, activeExperiment: null, experimentHistory: [] }, signals: [] } },
    observedEvidence: [], rolloutDecision: resolvePersonalizationRollout({ rolloutPercent: 100, subjectKey: `delta_learner_${profile}` }),
  };
  const durationContext = { profileVersion: `delta_saved_duration_${profile}`, profile: {
    sustainableMinutes: profile === 1 ? 25 as const : 60 as const,
    startingFrictionRisk: null, fatigueRisk: null, preferredWindow: null,
    evidenceRefs: { sustainableMinutes: ["canonical-profile:realistic_session_length"], startingFrictionRisk: [], fatigueRisk: [], preferredWindow: [] },
  }, recentOutcomes: [] };
  const composition = composeNormalPlanEnvelopes({ request, now: DELTA_NOW, durationContext, learningIntentRecommendation: { intent: "learn", basis: "Teach the accepted topics before independent practice." } });
  return { request, composition, methodContext, now: DELTA_NOW, durationContext };
}

export function deterministicDeltaPlan(profile: 1 | 2) {
  const fixture = deltaFixture(profile);
  return buildNormalPlanFromFixedEnvelope({ ...fixture, fill: buildNormalPlanFallbackFill(fixture) });
}

export function learnerPrintout(plan: LearningPlan) {
  return { title: plan.title, rationale: plan.rationale, sessions: plan.sessions.map(({ title, method, methodReason, objective, estimatedMinutes, amountLabel, completionEvidence, topicIds }) => ({ title, method, methodReason, objective, estimatedMinutes, amountLabel, completionEvidence, topicIds })) };
}

export function assertPersonalizationDelta(first: LearningPlan, second: LearningPlan) {
  const learn1 = first.sessions.find(session => session.learningMode === "learn")!;
  const learn2 = second.sessions.find(session => session.learningMode === "learn")!;
  const differences = [
    learn1.method !== learn2.method,
    learn1.estimatedMinutes !== learn2.estimatedMinutes,
    first.sessions.findIndex(s => s.topicIds?.includes(deltaTopicId(4))) !== second.sessions.findIndex(s => s.topicIds?.includes(deltaTopicId(4))),
    /example|hint|focus|short/i.test(learn1.methodReason) && /own words|explain|direct|hour|reflect/i.test(learn2.methodReason) && learn1.methodReason !== learn2.methodReason,
    learn1.objective !== learn2.objective,
  ];
  expect(differences.filter(Boolean).length, JSON.stringify({ differences, P1: learnerPrintout(first), P2: learnerPrintout(second) }, null, 2)).toBeGreaterThanOrEqual(3);
  for (const plan of [first, second]) {
    expect(new Set(plan.sessions.map(s => s.methodReason)).size).toBe(plan.sessions.length);
    expect(plan.sessions).toHaveLength(12);
    expect(plan.sessions.every(s => s.completionEvidence?.length === s.topicIds?.length)).toBe(true);
    expect(JSON.stringify(learnerPrintout(plan))).not.toMatch(/evidence check \d|\btargets?\b|\benvelope\b/i);
  }
}

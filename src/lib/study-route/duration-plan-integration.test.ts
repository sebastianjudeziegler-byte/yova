import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
  legacyPlanSessionToStudyRoute,
} from "@/lib/study-route/adapters";
import {
  integrateStudyNowDurationDecision,
  parseStudyNowDurationDecision,
  STUDY_NOW_DURATION_PLAN_INTEGRATION_VERSION,
  type StudyNowDurationDecision,
} from "@/lib/study-route/duration-plan-integration";
import { resolveNormalStudyDurationPrecedence } from "@/lib/study-route/duration-precedence";
import { NORMAL_DURATION_RECOMMENDER_VERSION } from "@/lib/study-route/duration-recommendation";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-23T10:00:00.000Z";

function session(): LearningPlanSession {
  return {
    id: SESSION_ID,
    sequence: 1,
    title: "Learn photosynthesis",
    objective: "Explain how light energy becomes stored chemical energy.",
    method: "Self-explanation with worked example fading",
    methodReason: "A model and reduced-support explanation expose gaps in the mechanism.",
    scheduledFor: NOW,
    estimatedMinutes: 15,
    amountLabel: "Focused session · about 15 min",
    learningMode: "learn",
    topicIds: [TARGET_ID],
    contentTargets: ["Trace energy through photosynthesis"],
    completionEvidence: ["Explain the mechanism without the model visible"],
    status: "ready",
  };
}

function plan(currentSession = session()): LearningPlan {
  return {
    id: PLAN_ID,
    learningItemId: "44444444-4444-4444-8444-444444444444",
    title: "Photosynthesis",
    topic: "Photosynthesis",
    kind: "topic",
    deadline: null,
    status: "draft",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    creationIntent: "study_now",
    rationale: "Build and independently explain the mechanism.",
    createdAt: NOW,
    sessions: [currentSession],
  };
}

function freshRoute(currentSession = session()) {
  const route = legacyPlanSessionToStudyRoute({
    plan: plan(currentSession),
    session: currentSession,
    adaptedAt: NOW,
    identity: {
      routeLineageId: "55555555-5555-4555-8555-555555555555",
      routeRevisionId: "66666666-6666-4666-8666-666666666666",
      lifecycleStatus: "provisional",
      createdAt: NOW,
    },
  });
  if (!route) throw new Error("The fixture must create a canonical route.");
  return route;
}

function durationDecision(): StudyNowDurationDecision {
  const resolved = resolveNormalStudyDurationPrecedence({
    systemRecommendation: {
      minutes: 25,
      source: "profile_recommendation",
      ruleTrace: [{
        ruleId: "duration.recommendation.sustainable_baseline",
        result: "baseline_25_minutes",
        reason: "The learner's authorized sustainable-duration answer sets the baseline.",
        evidenceRefs: ["profile:sustainable-duration"],
      }],
    },
    learnerOverrideMinutes: null,
    hardMaximumMinutes: 20,
  });
  if (resolved.status !== "resolved") throw new Error("The fixture must resolve.");
  return {
    timing: resolved.timing,
    ruleTrace: resolved.ruleTrace,
    routerVersion: NORMAL_DURATION_RECOMMENDER_VERSION,
    profileVersion: "authorized_profile_snapshot:duration-v1",
  };
}

describe("Study Now duration plan integration", () => {
  it("binds resolved timing to the scalar and phases while preserving honest mixed provenance", () => {
    const currentSession = session();
    const original = freshRoute(currentSession);
    const decision = durationDecision();
    const integrated = integrateStudyNowDurationDecision({
      creationIntent: "study_now",
      hardMaximumMinutes: 20,
      session: currentSession,
      route: original,
      decision,
    });

    expect(integrated.timing).toEqual({
      activeMinutes: 15,
      elapsedMinutes: 15,
      durationSource: "availability_cap",
      hardMaximumMinutes: 20,
    });
    expect(integrated.execution.orderedPhases.reduce((sum, phase) => (
      sum + phase.activeMinutes
    ), 0)).toBe(currentSession.estimatedMinutes);
    expect(integrated.provenance).toMatchObject({
      routerVersion: [
        LEGACY_STUDY_ROUTE_ADAPTER_VERSION,
        STUDY_NOW_DURATION_PLAN_INTEGRATION_VERSION,
        NORMAL_DURATION_RECOMMENDER_VERSION,
      ].join("+"),
      profileVersion: "authorized_profile_snapshot:duration-v1",
      evidenceRefs: ["profile:sustainable-duration"],
    });
    expect(integrated.provenance.ruleTrace[0]?.ruleId).toBe(
      "study_route.legacy_plan_adapter",
    );
    expect(integrated.provenance.ruleTrace.slice(1)).toEqual(decision.ruleTrace);
    expect(integrated.provenance.ruleTrace.map((entry) => entry.ruleId)).toEqual(
      expect.arrayContaining([
        "duration.recommendation.sustainable_baseline",
        "duration.availability_cap",
      ]),
    );
    expect(integrated.explanation.uncertainties).not.toContain(
      "The duration is preserved, but the legacy record does not show how it was chosen.",
    );
    expect(integrated.explanation.uncertainties).toContain(
      "The legacy record does not show who selected the route or which control mode was active.",
    );
    expect(original.timing.durationSource).toBe("legacy_reconstruction");
    expect(original.provenance.routerVersion).toBe(LEGACY_STUDY_ROUTE_ADAPTER_VERSION);
    expect(() => StudyRouteSchema.parse(integrated)).not.toThrow();
  });

  it("rejects decisions whose hard maximum is not the exact request maximum", () => {
    expect(() => parseStudyNowDurationDecision(durationDecision(), 25)).toThrow(
      "exact hard maximum",
    );
  });

  it("rejects normal-plan, committed, review, stored-route, and scalar-only applications", () => {
    const currentSession = session();
    const route = freshRoute(currentSession);
    const decision = durationDecision();

    expect(() => integrateStudyNowDurationDecision({
      creationIntent: "plan",
      hardMaximumMinutes: 20,
      session: currentSession,
      route,
      decision,
    })).toThrow("normal plan");

    const committed = StudyRouteSchema.parse({
      ...route,
      identity: {
        ...route.identity,
        lifecycleStatus: "committed",
        committedAt: NOW,
      },
    });
    expect(() => integrateStudyNowDurationDecision({
      creationIntent: "study_now",
      hardMaximumMinutes: 20,
      session: currentSession,
      route: committed,
      decision,
    })).toThrow("before a StudyRoute is committed");

    expect(() => integrateStudyNowDurationDecision({
      creationIntent: "study_now",
      hardMaximumMinutes: 20,
      session: { ...currentSession, reviewType: "verify" },
      route,
      decision,
    })).toThrow("lightweight duration contract");

    const storedRoute = StudyRouteSchema.parse({
      ...route,
      provenance: {
        ...route.provenance,
        routerVersion: "some_previous_router_v1",
      },
    });
    expect(() => integrateStudyNowDurationDecision({
      creationIntent: "study_now",
      hardMaximumMinutes: 20,
      session: currentSession,
      route: storedRoute,
      decision,
    })).toThrow("fresh materialization route");

    expect(() => integrateStudyNowDurationDecision({
      creationIntent: "study_now",
      hardMaximumMinutes: 20,
      session: { ...currentSession, estimatedMinutes: 10 },
      route,
      decision,
    })).toThrow("scalar, content budget, phases, and route together");
  });
});

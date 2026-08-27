import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { materialStudyRouteChanges } from "@/lib/study-route/revisions";
import {
  createCommittedInitialSessionStudyRoute,
  createCommittedScalarSuccessorStudyRoute,
  POST_ACTIVATION_ROUTE_BUILDER_VERSION,
} from "@/lib/study-route/session-route-creation";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const FIRST_NOW = "2026-08-23T10:00:00.000Z";
const NEXT_NOW = "2026-08-23T11:00:00.000Z";

function session(): LearningPlanSession {
  return {
    id: SESSION_ID,
    sequence: 2,
    title: "Explain the photosynthesis mechanism",
    objective: "Explain how light energy is converted into stored chemical energy.",
    method: "Self-explanation (Feynman Technique)",
    methodReason: "Explaining the mechanism exposes gaps in the causal model.",
    scheduledFor: "2026-08-24T10:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "Focused session · about 15 min",
    learningMode: "learn",
    topicIds: [TARGET_ID],
    contentTargets: ["Trace energy through the mechanism."],
    completionEvidence: ["Explain the mechanism without notes."],
    status: "upcoming",
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
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build and independently explain the mechanism.",
    createdAt: "2026-08-22T10:00:00.000Z",
    sessions: [currentSession],
  };
}

describe("post-activation StudyRoute creation", () => {
  it("commits an initial route with fresh identity, exact binding, time, and origin provenance", () => {
    const currentSession = session();
    const route = createCommittedInitialSessionStudyRoute({
      plan: plan(currentSession),
      session: currentSession,
      now: FIRST_NOW,
      origin: {
        source: "completion_review",
        reason: "A completed session scheduled a short follow-up review.",
        evidenceRefs: ["completion:previous-session"],
      },
    });

    expect(route.identity).toMatchObject({
      revisionNumber: 1,
      lifecycleStatus: "committed",
      planId: PLAN_ID,
      sessionId: SESSION_ID,
      createdAt: FIRST_NOW,
      committedAt: FIRST_NOW,
    });
    expect(route.identity.routeLineageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(route.identity.routeRevisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(route.identity.routeLineageId).not.toBe(route.identity.routeRevisionId);
    expect(route.provenance.routerVersion).toBe(POST_ACTIVATION_ROUTE_BUILDER_VERSION);
    expect(route.provenance.evidenceRefs).toContain("completion:previous-session");
    expect(route.provenance.ruleTrace.at(-1)).toEqual({
      ruleId: "study_route.initial_post_activation_origin",
      result: "completion_review",
      reason: "A completed session scheduled a short follow-up review.",
      evidenceRefs: ["completion:previous-session"],
    });
  });

  it("creates and commits a material scalar successor in the same lineage", () => {
    const originalSession = session();
    const original = createCommittedInitialSessionStudyRoute({
      plan: plan(originalSession),
      session: originalSession,
      now: FIRST_NOW,
      origin: {
        source: "completion_review",
        reason: "A completed session scheduled this follow-up.",
      },
    });
    const adaptedSession = {
      ...originalSession,
      estimatedMinutes: 25,
      amountLabel: "Focused session · about 25 min",
    };

    const successor = createCommittedScalarSuccessorStudyRoute({
      plan: plan(adaptedSession),
      session: adaptedSession,
      previousRoute: original,
      now: NEXT_NOW,
      changeReason: "The learner extended the available session window.",
      origin: {
        source: "availability_adjustment",
        reason: "The current availability now supports a longer session.",
      },
      durationDecision: {
        source: "learner_override",
        profileVersion: original.provenance.profileVersion,
        ruleTrace: [{
          ruleId: "duration.learner_override",
          result: "selected_25_minutes",
          reason: "The learner selected 25 minutes for this rebuilt session.",
          evidenceRefs: [],
        }],
      },
    });

    expect(successor.identity).toMatchObject({
      routeLineageId: original.identity.routeLineageId,
      revisionNumber: 2,
      lifecycleStatus: "committed",
      planId: PLAN_ID,
      sessionId: SESSION_ID,
      createdAt: NEXT_NOW,
      committedAt: NEXT_NOW,
      supersedesRevisionId: original.identity.routeRevisionId,
    });
    expect(successor.identity.routeRevisionId).not.toBe(original.identity.routeRevisionId);
    expect(successor.timing.activeMinutes).toBe(25);
    expect(successor.timing.durationSource).toBe("learner_override");
    expect(materialStudyRouteChanges(original, successor)).toContain("duration");
    expect(successor.provenance.ruleTrace).toContainEqual({
      ruleId: "study_route.scalar_adaptation_origin",
      result: "availability_adjustment",
      reason: "The current availability now supports a longer session.",
      evidenceRefs: [],
    });
    expect(successor.provenance.ruleTrace.at(-1)).toMatchObject({
      ruleId: "study_route.material_successor",
      reason: "The learner extended the available session window.",
    });
  });

  it("rejects a changed duration when the caller supplies no current authority or trace", () => {
    const originalSession = session();
    const original = createCommittedInitialSessionStudyRoute({
      plan: plan(originalSession),
      session: originalSession,
      now: FIRST_NOW,
      origin: { source: "activation", reason: "Create the original session route." },
    });
    const adaptedSession = {
      ...originalSession,
      estimatedMinutes: 25,
      amountLabel: "Focused session · about 25 min",
    };

    expect(() => createCommittedScalarSuccessorStudyRoute({
      plan: plan(adaptedSession),
      session: adaptedSession,
      previousRoute: original,
      now: NEXT_NOW,
      changeReason: "An unclassified scalar writer changed the duration.",
      origin: { source: "unknown_writer", reason: "No duration authority was supplied." },
    })).toThrow("requires an explicit duration decision");
  });

  it("rejects a predecessor bound to a different exact session identity", () => {
    const originalSession = session();
    const original = createCommittedInitialSessionStudyRoute({
      plan: plan(originalSession),
      session: originalSession,
      now: FIRST_NOW,
      origin: { source: "review", reason: "Create a follow-up review route." },
    });
    const otherSession = {
      ...originalSession,
      id: "55555555-5555-4555-8555-555555555555",
    };

    expect(() => createCommittedScalarSuccessorStudyRoute({
      plan: plan(otherSession),
      session: otherSession,
      previousRoute: original,
      now: NEXT_NOW,
      changeReason: "This must not cross session identities.",
      origin: { source: "test", reason: "Attempt a cross-session adaptation." },
    })).toThrow("does not match the exact plan and session IDs");
  });

  it("rejects scalar adaptation when it makes no material route change", () => {
    const currentSession = session();
    const original = createCommittedInitialSessionStudyRoute({
      plan: plan(currentSession),
      session: currentSession,
      now: FIRST_NOW,
      origin: { source: "review", reason: "Create a follow-up review route." },
    });

    expect(() => createCommittedScalarSuccessorStudyRoute({
      plan: plan(currentSession),
      session: currentSession,
      previousRoute: original,
      now: NEXT_NOW,
      changeReason: "Only provenance changed, not the learning decision.",
      origin: { source: "no_op", reason: "The scalar session promise is unchanged." },
    })).toThrow("material route change");
  });
});

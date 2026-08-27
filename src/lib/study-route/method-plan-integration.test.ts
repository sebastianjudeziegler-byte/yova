import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  selectCanonicalStudyMethod,
  type CanonicalMethodSelectionResult,
} from "@/lib/learning/canonical-method-selection";
import {
  LEARNING_TASK_TYPES,
  METHOD_PRESENTATION_POLICY_VERSION,
} from "@/lib/learning/method-catalog";
import { KNOWLEDGE_STAGES } from "@/lib/learning/method-eligibility";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import { METHOD_RUNTIME_CAPABILITY_POLICY_VERSION } from "@/lib/session-generation/method-runtime-capability";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";
import {
  legacyPlanSessionToStudyRoute,
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";
import {
  integrateStudyRouteMethodDecision,
  methodSelectionContextForStudyRoute,
  STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION,
} from "@/lib/study-route/method-plan-integration";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const ROUTE_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-24T08:00:00.000Z";

function session(): LearningPlanSession {
  return {
    id: SESSION_ID,
    sequence: 1,
    title: "Memorize the core biology terms",
    objective: "Recall every core term and distinguish similar definitions.",
    method: "Retrieval practice",
    methodReason: "Produce each definition before checking the source.",
    scheduledFor: NOW,
    estimatedMinutes: 15,
    amountLabel: "Focused session · about 15 min",
    learningMode: "study",
    topicIds: [TARGET_ID],
    contentTargets: ["Recall and distinguish the core biology terms"],
    completionEvidence: ["Recall every target without notes and correct each gap"],
    status: "ready",
  };
}

function plan(currentSession = session()): LearningPlan {
  return {
    id: PLAN_ID,
    learningItemId: "66666666-6666-4666-8666-666666666666",
    title: "Biology terms",
    topic: "Biology vocabulary and definitions",
    kind: "test",
    deadline: null,
    status: "draft",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    creationIntent: "study_now",
    rationale: "Build reliable recall before the assessment.",
    createdAt: NOW,
    sessions: [currentSession],
  };
}

function freshRoute(): StudyRoute {
  const currentSession = session();
  const route = legacyPlanSessionToStudyRoute({
    plan: plan(currentSession),
    session: currentSession,
    adaptedAt: NOW,
    identity: {
      routeLineageId: LINEAGE_ID,
      routeRevisionId: ROUTE_ID,
      lifecycleStatus: "provisional",
      createdAt: NOW,
    },
  });
  if (!route) throw new Error("The fixture must create a route.");
  return route;
}

function declaredProfile(): GenerationPersonalizationContext {
  return {
    decisions: [],
    methodTie: {
      state: {
        controls: { experiments: false },
        activeExperiment: null,
        experimentHistory: [],
      },
      signals: [{
        id: "signal:memory_breakdown",
        key: "memory_breakdown",
        title: "Memory breakdown",
        code: "delayed_forgetting",
        evidenceLabel: "You told YOVA",
        paused: false,
      }],
    },
  };
}

describe("StudyRoute method plan integration", () => {
  it("turns a typed declaration into one fixed method recipe and honest provenance", () => {
    const original = freshRoute();
    const context = methodSelectionContextForStudyRoute(original);
    const selection = selectCanonicalStudyMethod({
      ...context,
      personalization: declaredProfile(),
    });
    const integrated = integrateStudyRouteMethodDecision({
      route: original,
      decision: {
        selection,
        profileVersion: "authorized_method_context_v1:profile-revision-7",
      },
    });

    expect(selection.selectedMethodId).toBe("spaced_retrieval");
    expect(integrated.approach).toMatchObject({
      primaryMethodId: "spaced_retrieval",
      visibleMethodName: "Spaced Repetition",
    });
    expect(integrated.execution.orderedPhases.map((phase) => phase.methodPhase)).toEqual([
      "retrieve",
      "schedule_return",
    ]);
    expect(integrated.execution.orderedPhases.reduce((sum, phase) => (
      sum + phase.activeMinutes
    ), 0)).toBe(integrated.timing.activeMinutes);
    expect(integrated.agency).toMatchObject({
      controlMode: "yova_decides",
      selectedBy: "yova",
    });
    expect(integrated.agency.alternatives.map((item) => item.primaryMethodId)).toEqual([
      "retrieval_practice",
      "interleaved_practice",
    ]);
    expect(integrated.explanation.learnerDeclarations[0])
      .toMatch(/you told yova.*delayed forgetting/i);
    expect(integrated.explanation.uncertainties).not.toContain(
      "The legacy record does not show who selected the route or which control mode was active.",
    );
    expect(integrated.explanation.uncertainties).toContain(
      "The task family is derived from legacy task text rather than a stored routing decision.",
    );
    expect(integrated.provenance).toMatchObject({
      profileVersion: "authorized_method_context_v1:profile-revision-7",
      evidenceRefs: ["signal:memory_breakdown"],
    });
    expect(integrated.provenance.routerVersion).toContain(
      STUDY_ROUTE_METHOD_PLAN_INTEGRATION_VERSION,
    );
    expect(integrated.provenance.routerVersion.split("+")).toContain(
      METHOD_PRESENTATION_POLICY_VERSION,
    );
    expect(integrated.provenance.routerVersion.length).toBeLessThanOrEqual(256);
    expect(integrated.provenance.ruleTrace.map((entry) => entry.ruleId)).toEqual(
      expect.arrayContaining([
        "method_decision_evidence_adapter_v1",
        "method_eligibility_v1",
        "canonical_method_selection_v1",
        METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
        METHOD_PRESENTATION_POLICY_VERSION,
      ]),
    );
    expect(integrated.provenance.ruleTrace.filter((entry) => (
      entry.ruleId === METHOD_PRESENTATION_POLICY_VERSION
    ))).toEqual([expect.objectContaining({
      result: "recognizable_method_names",
      evidenceRefs: [],
    })]);
    expect(studyRouteToLegacySessionProjection(integrated)).toMatchObject({
      method: "Spaced Repetition",
      estimatedMinutes: 15,
      learningMode: "study",
    });
    expect(original.approach.primaryMethodId).toBe("retrieval_practice");
    expect(() => StudyRouteSchema.parse(integrated)).not.toThrow();
  });

  it("records an eligible current-session learner choice without losing alternatives", () => {
    const route = freshRoute();
    const selection = selectCanonicalStudyMethod({
      ...methodSelectionContextForStudyRoute(route),
      learnerChoice: {
        methodId: "interleaved_practice",
        evidenceRef: "learner-choice:setup",
      },
    });
    const integrated = integrateStudyRouteMethodDecision({
      route,
      decision: {
        selection,
        profileVersion: "authorized_method_context_v1:empty",
      },
    });

    expect(integrated.agency).toMatchObject({
      controlMode: "learner_customizes",
      selectedBy: "learner",
      override: {
        changedFields: ["primary_method"],
      },
    });
    expect(integrated.agency.alternatives[0]?.primaryMethodId).toBe(
      "retrieval_practice",
    );
    expect(integrated.explanation.learnerDeclarations[0]).toMatch(/^You chose/);
  });

  it("preserves prior duration-profile provenance when method context is added later", () => {
    const route = structuredClone(freshRoute());
    route.provenance.profileVersion = "duration_context_v1+profile_revision:7";
    const selection = selectCanonicalStudyMethod({
      ...methodSelectionContextForStudyRoute(route),
      personalization: declaredProfile(),
    });
    const integrated = integrateStudyRouteMethodDecision({
      route: StudyRouteSchema.parse(route),
      decision: {
        selection,
        profileVersion: "method_context_v1+profile_revision:7",
      },
    });

    expect(integrated.provenance.profileVersion).toBe(
      "duration_context_v1+profile_revision:7+method_context_v1",
    );
  });

  it("uses the most support-requiring active target stage for a mixed route", () => {
    const route = structuredClone(freshRoute());
    route.target.targetStates[0]!.stage = "retrieval_ready";
    route.target.targetStates.push({
      targetId: "77777777-7777-4777-8777-777777777777",
      stage: "novice",
      uncertainty: "high",
      evidenceRefs: [],
    });
    for (const phase of route.execution.orderedPhases) {
      phase.targetIds.push("77777777-7777-4777-8777-777777777777");
    }
    for (const evidence of route.execution.completionEvidence) {
      evidence.targetIds.push("77777777-7777-4777-8777-777777777777");
    }

    expect(methodSelectionContextForStudyRoute(StudyRouteSchema.parse(route))).toEqual({
      taskType: "memorization",
      knowledgeStage: "novice",
      learningMode: "study",
    });
  });

  it("composes a valid fixed phase recipe for every task, stage, and mode", () => {
    for (const taskType of LEARNING_TASK_TYPES) {
      for (const knowledgeStage of KNOWLEDGE_STAGES) {
        for (const learningMode of ["learn", "study"] as const) {
          const route = structuredClone(freshRoute());
          route.target.taskFamily = taskType;
          route.target.targetStates[0]!.stage = knowledgeStage;
          route.approach.mode = learningMode === "learn" ? "learn" : "practice";
          const parsedRoute = StudyRouteSchema.parse(route);
          const selection = selectCanonicalStudyMethod({
            taskType,
            knowledgeStage,
            learningMode,
          });
          const integrated = integrateStudyRouteMethodDecision({
            route: parsedRoute,
            decision: {
              selection,
              profileVersion: "authorized_method_context_v1:empty",
            },
          });

          expect(
            integrated.execution.orderedPhases.map((phase) => phase.methodPhase),
            `${taskType}/${knowledgeStage}/${learningMode}`,
          ).toEqual(
            methodFidelityContractForPrompt(
              selection.selectedMethodId,
              learningMode,
            ).orderedPhases,
          );
          expect(integrated.execution.orderedPhases.reduce((sum, phase) => (
            sum + phase.activeMinutes
          ), 0)).toBe(15);
        }
      }
    }
  });

  it("rejects committed routes, scheduled reviews, stale contexts, and forged selections", () => {
    const route = freshRoute();
    const selection = selectCanonicalStudyMethod({
      ...methodSelectionContextForStudyRoute(route),
    });
    const decision = {
      selection,
      profileVersion: "authorized_method_context_v1:empty",
    };
    const committed = StudyRouteSchema.parse({
      ...route,
      identity: {
        ...route.identity,
        lifecycleStatus: "committed",
        committedAt: NOW,
      },
    });
    const review = StudyRouteSchema.parse({
      ...route,
      timing: {
        ...route.timing,
        durationSource: "scheduled_review",
      },
    });
    const staleSelection = selectCanonicalStudyMethod({
      taskType: "conceptual_learning",
      knowledgeStage: "developing",
      learningMode: "study",
    });
    const forged = structuredClone(selection) as CanonicalMethodSelectionResult;
    (forged.eligibleMethodIds as string[]).reverse();

    expect(() => integrateStudyRouteMethodDecision({ route: committed, decision })).toThrow(
      /before a StudyRoute is committed/i,
    );
    expect(() => integrateStudyRouteMethodDecision({ route: review, decision })).toThrow(
      /scheduled reviews/i,
    );
    expect(() => integrateStudyRouteMethodDecision({
      route,
      decision: { ...decision, selection: staleSelection },
    })).toThrow(/context does not match/i);
    expect(() => integrateStudyRouteMethodDecision({
      route,
      decision: { ...decision, selection: forged },
    })).toThrow(/eligible set does not match/i);
    expect(() => integrateStudyRouteMethodDecision({
      route,
      decision: { ...decision, profileVersion: "legacy_unknown" },
    })).toThrow(/authorized profile context/i);
  });
});

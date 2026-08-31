import { describe, expect, it } from "vitest";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import {
  eligibleMethodIdsFor,
  eligibleMethodIdsForPolicyVersion,
  LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
  METHOD_ELIGIBILITY_POLICY_VERSION,
} from "@/lib/learning/method-eligibility";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import {
  STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
  agencyModeForStudyRouteControlMode,
  boundedAgencyMethodAlternatives,
  boundedOtherAgencyMethodOptions,
  immutableStudyRouteMethodEligibility,
  isExactStoredAgencyMethodChoice,
  resolveAgencyMethodRequest,
  resolveBoundedOtherMethodRequest,
  resolveStudyRouteAgencyMode,
  resolveStudyRouteAgencyChange,
  studyRouteControlModeForAgencyMode,
} from "@/lib/study-route/agency-mode-controller";
import { createSuccessorStudyRoute } from "@/lib/study-route/revisions";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";
import {
  VISIBLE_STUDY_ROUTE_RECIPE_VERSION,
  visibleStudyRouteRecipe,
} from "@/lib/study-route/visible-recipe";

const REVISION_1 = "22222222-2222-4222-8222-222222222222";
const REVISION_2 = "77777777-7777-4777-8777-777777777777";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const DECIDED_AT = "2026-08-23T09:05:00.000Z";
const CONFIRMED_AT = "2026-08-23T09:06:00.000Z";

describe("versioned StudyRoute agency controller", () => {
  it("adapts all three modes without inventing a legacy learner choice", () => {
    expect(agencyModeForStudyRouteControlMode("yova_decides")).toEqual({
      mode: "yova_decides",
      source: "exact",
      uncertainty: null,
    });
    expect(agencyModeForStudyRouteControlMode("help_me_choose").mode)
      .toBe("help_me_choose");
    expect(agencyModeForStudyRouteControlMode("learner_customizes").mode)
      .toBe("ill_customize");
    expect(studyRouteControlModeForAgencyMode("ill_customize"))
      .toBe("learner_customizes");
    expect(agencyModeForStudyRouteControlMode("legacy_unknown")).toMatchObject({
      mode: "help_me_choose",
      source: "legacy_default",
      uncertainty: expect.stringContaining("explicit confirmation"),
    });
  });

  it("resolves exact canonical control modes and keeps uncertain defaults truthful", () => {
    const help = resolveStudyRouteAgencyMode(createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]));
    const depends = resolveStudyRouteAgencyMode(createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "depends",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]));

    expect(help).toEqual({
      mode: "help_me_choose",
      source: "canonical_profile",
      uncertainty: null,
      evidenceRefs: ["canonical-profile:control_mode:profile_control_mode"],
    });
    expect(depends).toMatchObject({
      mode: "yova_decides",
      source: "uncertain_profile_default",
      uncertainty: expect.stringContaining("depends"),
      evidenceRefs: ["canonical-profile:control_mode:profile_control_mode"],
    });
    expect(resolveStudyRouteAgencyMode()).toMatchObject({
      mode: "yova_decides",
      source: "missing_profile_default",
      uncertainty: expect.stringContaining("No authorized"),
      evidenceRefs: [],
    });
  });

  it("builds at most two deterministic, eligible alternatives with task-specific tradeoffs", () => {
    const route = committedRoute();
    const first = boundedAgencyMethodAlternatives({ route });
    const second = boundedAgencyMethodAlternatives({ route });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(2);
    expect(first.every((alternative) => (
      alternative.primaryMethodId !== route.approach.primaryMethodId
      && alternative.mode === route.approach.mode
      && alternative.executionEnvironment === route.approach.executionEnvironment
      && alternative.activeMinutes === route.timing.activeMinutes
      && alternative.tradeoff.includes("conceptual learning Learn session")
    ))).toBe(true);
    expect(isExactStoredAgencyMethodChoice(
      StudyRouteSchema.parse({
        ...route,
        agency: { ...route.agency, alternatives: first },
      }),
      first[0]!.primaryMethodId,
    )).toBe(true);
    expect(isExactStoredAgencyMethodChoice(
      StudyRouteSchema.parse({
        ...route,
        agency: {
          ...route.agency,
          alternatives: first.map((alternative, index) => (
            index === 0
              ? { ...alternative, tradeoff: "This forged tradeoff is structurally valid but not controller-authored." }
              : alternative
          )),
        },
      }),
      first[0]!.primaryMethodId,
    )).toBe(false);
  });

  it("never widens an immutable predecessor choice set", () => {
    const route = committedRoute();
    const alternatives = boundedAgencyMethodAlternatives({
      route,
      selectedMethodId: route.approach.primaryMethodId,
      orderedMethodIds: [
        route.approach.primaryMethodId,
        "pretesting",
        "concept_mapping",
      ],
      allowedMethodIds: [route.approach.primaryMethodId, "pretesting"],
    });

    expect(alternatives.map((alternative) => alternative.primaryMethodId))
      .toEqual(["pretesting"]);
  });

  it("accepts eligible choices and maps aliases, timing systems, and unsafe methods without a dead end", () => {
    const route = committedRoute();
    const exact = resolveAgencyMethodRequest({
      route,
      requestedMethod: route.approach.visibleMethodName,
    });
    const alias = resolveAgencyMethodRequest({ route, requestedMethod: "Flashcards" });
    const timing = resolveAgencyMethodRequest({ route, requestedMethod: "Pomodoro" });
    const unsupported = resolveAgencyMethodRequest({
      route,
      requestedMethod: "Passive colour highlighting",
    });

    expect(exact).toMatchObject({
      status: "accepted",
      mappingKind: "exact_method",
      selectedMethodId: route.approach.primaryMethodId,
      conflictExplanation: null,
    });
    expect(alias).toMatchObject({
      status: "mapped",
      mappingKind: "recipe_alias",
      conflictExplanation: expect.stringContaining("maps it to"),
    });
    expect(timing).toMatchObject({
      status: "mapped",
      mappingKind: "timing_only",
      selectedMethodId: route.approach.primaryMethodId,
      conflictExplanation: expect.stringContaining("timing option"),
    });
    expect(unsupported).toMatchObject({
      status: "mapped",
      mappingKind: "unsupported_fallback",
      conflictExplanation: expect.stringContaining("could not verify"),
    });
    for (const result of [alias, timing, unsupported]) {
      expect(result.selectedMethodName).toBe(
        CORE_METHOD_CATALOG[result.selectedMethodId].name,
      );
    }
  });

  it("bounds I'll Customize Other methods mappings to the immutable eligibility cohort", () => {
    const base = committedRoute();
    const eligible = eligibleMethodIdsFor({
      taskType: base.target.taskFamily,
      knowledgeStage: "novice",
      learningMode: "learn",
    });
    const route = StudyRouteSchema.parse({
      ...base,
      agency: {
        controlMode: "learner_customizes",
        selectedBy: "learner",
        alternatives: boundedAgencyMethodAlternatives({ route: base }),
        override: {
          requestedAt: base.identity.committedAt,
          changedFields: ["primary_method"],
          reason: "The learner selected this eligible method.",
        },
      },
      provenance: {
        ...base.provenance,
        ruleTrace: [...base.provenance.ruleTrace, {
          ruleId: METHOD_ELIGIBILITY_POLICY_VERSION,
          result: eligible.join(","),
          reason: `Task, knowledge stage, and Learn mode limited selection to ${eligible.map((methodId) => CORE_METHOD_CATALOG[methodId].name).join(", ")}.`,
          evidenceRefs: [],
        }],
      },
    });
    const allowed = new Set(eligible);
    const questionable = resolveBoundedOtherMethodRequest({
      route,
      requestedMethod: "Flashcards",
    });
    const stored = new Set([
      route.approach.primaryMethodId,
      ...route.agency.alternatives.map((alternative) => alternative.primaryMethodId),
    ]);
    const otherOptions = boundedOtherAgencyMethodOptions(route);
    const hiddenEligible = eligible.find((methodId) => !stored.has(methodId));
    expect(hiddenEligible).toBeDefined();
    const exactHidden = resolveBoundedOtherMethodRequest({
      route,
      requestedMethod: CORE_METHOD_CATALOG[hiddenEligible!].name,
    });
    const unknown = resolveBoundedOtherMethodRequest({
      route,
      requestedMethod: "Passive colour highlighting",
    });

    expect(allowed.has(questionable.selectedMethodId)).toBe(true);
    expect(exactHidden).toMatchObject({
      status: "accepted",
      selectedMethodId: hiddenEligible,
      conflictExplanation: null,
    });
    expect(questionable).toMatchObject({
      status: "mapped",
      mappingKind: "recipe_alias",
      conflictExplanation: expect.stringContaining("maps it to"),
    });
    expect(allowed.has(unknown.selectedMethodId)).toBe(true);
    expect(unknown.conflictExplanation).toContain("could not verify");
    expect(otherOptions).toEqual(eligible
      .filter((methodId) => !stored.has(methodId))
      .map((methodId) => ({
        methodId,
        visibleMethodName: CORE_METHOD_CATALOG[methodId].name,
      })));
    expect(boundedOtherAgencyMethodOptions(base)).toEqual([]);
    expect(() => resolveBoundedOtherMethodRequest({
      route: base,
      requestedMethod: "Pomodoro",
    })).toThrow("only when the learner chose I'll Customize");
  });

  it("reads an old v2 cohort exactly instead of reinterpreting it as v3", () => {
    const base = committedRoute();
    const context = {
      taskType: "problem_solving" as const,
      knowledgeStage: "novice" as const,
      learningMode: "study" as const,
    };
    const v2MethodIds = eligibleMethodIdsForPolicyVersion(
      context,
      LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
    );
    const route = StudyRouteSchema.parse({
      ...base,
      target: { ...base.target, taskFamily: context.taskType },
      approach: {
        ...base.approach,
        mode: "practice",
        primaryMethodId: "worked_example_fading",
        visibleMethodName: CORE_METHOD_CATALOG.worked_example_fading.name,
      },
      agency: { ...base.agency, alternatives: [] },
      provenance: {
        ...base.provenance,
        ruleTrace: [{
          ruleId: LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
          result: v2MethodIds.join(","),
          reason: "The deployed v2 policy authorized this exact historical cohort.",
          evidenceRefs: [],
        }],
      },
    });

    expect(immutableStudyRouteMethodEligibility(route)).toEqual({
      policyVersion: LEGACY_METHOD_ELIGIBILITY_POLICY_VERSION,
      methodIds: ["worked_example_fading", "self_explanation"],
    });
    expect(eligibleMethodIdsFor(context)).toEqual(["practice_problems"]);
  });

  it("lets YOVA Decides apply only a sufficiently supported between-session successor", () => {
    const previous = committedRoute();
    const candidate = durationSuccessor(previous);
    const original = structuredClone(previous);

    const retained = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: candidate,
      mode: "yova_decides",
      changeKind: "system_recommendation",
      support: "insufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });
    expect(retained).toMatchObject({
      status: "retained",
      currentRoute: { identity: { routeRevisionId: REVISION_1 } },
      candidateRoute: null,
      reasonCode: "insufficient_support",
    });

    const applied = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: candidate,
      mode: "yova_decides",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });
    expect(applied).toMatchObject({
      policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
      status: "applied",
      currentRoute: {
        identity: {
          routeRevisionId: REVISION_2,
          lifecycleStatus: "committed",
          supersedesRevisionId: REVISION_1,
        },
        agency: { controlMode: "yova_decides", selectedBy: "yova" },
      },
      supersededRoute: {
        identity: { routeRevisionId: REVISION_1, lifecycleStatus: "superseded" },
      },
      explanation: {
        changedFields: ["duration", "phase_order"],
        summary: expect.stringContaining("Duration changed from 15"),
        recordedReason: "Recent comparable completion evidence supports a longer coherent recipe.",
        evidenceRefs: ["attempt:duration-signal"],
      },
    });
    expect(previous).toEqual(original);
    expect(previous.identity.lifecycleStatus).toBe("committed");
    expect(Object.isFrozen(applied.currentRoute)).toBe(true);
    expect(applied.currentRoute.provenance.ruleTrace.at(-1)).toMatchObject({
      ruleId: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
      result: expect.stringContaining("committed_direct_successor"),
    });
  });

  it("keeps the exact committed revision when no material candidate exists", () => {
    const previous = committedRoute();
    const result = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: null,
      mode: "yova_decides",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });

    expect(result).toMatchObject({
      status: "unchanged",
      currentRoute: { identity: { routeRevisionId: REVISION_1 } },
      candidateRoute: null,
      supersededRoute: null,
      explanation: null,
      reasonCode: "no_material_change",
    });
  });

  it("freezes in-session material changes until a later route decision", () => {
    const previous = committedRoute();
    const result = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: durationSuccessor(previous),
      mode: "yova_decides",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "in_session",
      decidedAt: DECIDED_AT,
    });

    expect(result).toMatchObject({
      status: "deferred",
      currentRoute: { identity: { routeRevisionId: REVISION_1 } },
      candidateRoute: {
        identity: { routeRevisionId: REVISION_2, lifecycleStatus: "provisional" },
      },
      supersededRoute: null,
      reasonCode: "active_session_frozen",
    });
  });

  it("requires Help Me Choose confirmation bound to both exact revision IDs", () => {
    const previous = committedRoute();
    const pending = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: durationSuccessor(previous),
      mode: "help_me_choose",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });

    expect(pending).toMatchObject({
      status: "confirmation_required",
      currentRoute: { identity: { routeRevisionId: REVISION_1 } },
      candidateRoute: {
        identity: { routeRevisionId: REVISION_2, lifecycleStatus: "provisional" },
        agency: { controlMode: "help_me_choose", selectedBy: "yova" },
      },
      requiredConfirmation: {
        policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
        expectedRouteRevisionId: REVISION_1,
        candidateRouteRevisionId: REVISION_2,
      },
    });

    const staleConfirmation = {
      policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
      expectedRouteRevisionId: "99999999-9999-4999-8999-999999999999",
      candidateRouteRevisionId: REVISION_2,
      confirmedAt: CONFIRMED_AT,
    } as const;
    expect(() => resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: StudyRouteSchema.parse(pending.candidateRoute),
      mode: "help_me_choose",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
      confirmation: staleConfirmation,
    })).toThrow("stale or belongs to another route candidate");

    const confirmed = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: StudyRouteSchema.parse(pending.candidateRoute),
      mode: "help_me_choose",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
      confirmation: {
        policyVersion: STUDY_ROUTE_AGENCY_MODE_CONTROLLER_VERSION,
        expectedRouteRevisionId: REVISION_1,
        candidateRouteRevisionId: REVISION_2,
        confirmedAt: CONFIRMED_AT,
      },
    });
    expect(confirmed).toMatchObject({
      status: "applied",
      currentRoute: {
        identity: { routeRevisionId: REVISION_2, committedAt: CONFIRMED_AT },
        agency: {
          controlMode: "help_me_choose",
          selectedBy: "learner",
          override: {
            requestedAt: CONFIRMED_AT,
            changedFields: ["duration", "phase_order"],
          },
        },
      },
    });
  });

  it("preserves an I'll Customize selection beside a recommendation but applies an explicit request", () => {
    const previous = StudyRouteSchema.parse({
      ...committedRoute(),
      agency: {
        controlMode: "learner_customizes",
        selectedBy: "learner",
        alternatives: [],
        override: {
          requestedAt: "2026-08-23T09:01:00.000Z",
          changedFields: ["primary_method"],
          reason: "The learner selected this eligible method.",
        },
      },
    });
    const recommendation = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: durationSuccessor(previous),
      mode: "ill_customize",
      changeKind: "system_recommendation",
      support: "sufficient",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });
    expect(recommendation).toMatchObject({
      status: "recommendation_available",
      currentRoute: { identity: { routeRevisionId: REVISION_1 } },
      candidateRoute: { identity: { routeRevisionId: REVISION_2 } },
      reasonCode: "learner_selection_preserved",
    });

    const explicit = resolveStudyRouteAgencyChange({
      previousRoute: previous,
      candidateRoute: durationSuccessor(previous),
      mode: "ill_customize",
      changeKind: "learner_request",
      support: "not_required",
      timing: "between_sessions",
      decidedAt: DECIDED_AT,
    });
    expect(explicit).toMatchObject({
      status: "applied",
      currentRoute: {
        identity: { routeRevisionId: REVISION_2 },
        agency: {
          controlMode: "learner_customizes",
          selectedBy: "learner",
          override: { requestedAt: DECIDED_AT },
        },
      },
    });
  });

  it("projects the collapsed card and expanded recipe from one exact route revision", () => {
    const base = committedRoute();
    const previous = StudyRouteSchema.parse({
      ...base,
      agency: {
        ...base.agency,
        alternatives: boundedAgencyMethodAlternatives({ route: base }),
      },
    });
    const route = durationSuccessor(previous);
    const recipe = visibleStudyRouteRecipe({ route, previousRoute: previous });

    expect(recipe).toMatchObject({
      version: VISIBLE_STUDY_ROUTE_RECIPE_VERSION,
      routeRevisionId: REVISION_2,
      routeLineageId: previous.identity.routeLineageId,
      lifecycleStatus: "provisional",
      collapsed: {
        sessionType: "Learn",
        primaryMethod: route.approach.visibleMethodName,
        totalMinutes: 25,
        shortReason: route.explanation.shortReason,
      },
      expanded: {
        phases: [
          { phaseId: "model", name: "Model", activeMinutes: 13 },
          { phaseId: "explain", name: "Explain", activeMinutes: 12 },
        ],
        activeMinutes: 25,
        elapsedMinutes: 25,
        timedBreak: null,
        taskRequirements: route.explanation.taskRequirements,
        learnerDeclarations: route.explanation.learnerDeclarations,
        observations: route.explanation.observations,
        uncertainties: route.explanation.uncertainties,
        alternatives: expect.arrayContaining([
          expect.objectContaining({ tradeoff: expect.stringContaining("also fits") }),
        ]),
        agency: { mode: "yova_decides", source: "exact" },
        changedSincePrevious: {
          previousRouteRevisionId: REVISION_1,
          candidateRouteRevisionId: REVISION_2,
          changedFields: ["duration", "phase_order"],
        },
      },
    });
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.expanded.phases)).toBe(true);
  });
});

function committedRoute(): StudyRoute {
  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: "11111111-1111-4111-8111-111111111111",
      routeRevisionId: REVISION_1,
      revisionNumber: 1,
      schemaVersion: 1,
      lifecycleStatus: "committed",
      planId: "33333333-3333-4333-8333-333333333333",
      sessionId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-08-23T09:00:00.000Z",
      committedAt: "2026-08-23T09:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Explain the mechanism independently.",
      targetStates: [{
        targetId: TARGET_ID,
        stage: "novice",
        uncertainty: "high",
        evidenceRefs: [],
      }],
      sourceRequirements: {
        sourceType: "yova_generated",
        requiredSourceIds: [],
        groundingRequired: false,
        instructions: [],
      },
    },
    approach: {
      mode: "learn",
      executionEnvironment: "inside_yova",
      primaryMethodId: "self_explanation",
      visibleMethodName: CORE_METHOD_CATALOG.self_explanation.name,
      confidenceLevel: "medium",
    },
    timing: {
      activeMinutes: 15,
      elapsedMinutes: 15,
      durationSource: "router_default",
      hardMaximumMinutes: 25,
    },
    execution: {
      orderedPhases: [
        { phaseId: "model", methodPhase: "model", activeMinutes: 8, targetIds: [TARGET_ID] },
        { phaseId: "explain", methodPhase: "explain", activeMinutes: 7, targetIds: [TARGET_ID] },
      ],
      difficultyTier: "foundational",
      initialSupport: "supported_start",
      activityLimit: 4,
      completionEvidence: [{
        evidenceId: "independent-explanation",
        targetIds: [TARGET_ID],
        kind: "explanation",
        description: "Explain the mechanism without looking at the model.",
        requiresIndependentAttempt: true,
      }],
      deferredTargets: [],
    },
    agency: {
      controlMode: "yova_decides",
      selectedBy: "yova",
      alternatives: [],
    },
    explanation: {
      shortReason: "A model followed by self-explanation fits this new concept.",
      taskRequirements: ["Build an accurate causal model."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: ["No independent target evidence exists yet."],
    },
    provenance: {
      routerVersion: "router-v1",
      profileVersion: "profile-v1",
      evidenceRefs: [],
      ruleTrace: [{
        ruleId: "task-stage-baseline",
        result: "selected",
        reason: "The novice conceptual target needs a teaching-first route.",
        evidenceRefs: [],
      }],
    },
  });
}

function durationSuccessor(previous: StudyRoute): StudyRoute {
  return StudyRouteSchema.parse(createSuccessorStudyRoute({
    previous,
    routeRevisionId: REVISION_2,
    createdAt: "2026-08-23T09:04:00.000Z",
    changeReason: "Recent comparable completion evidence supports a longer coherent recipe.",
    changes: {
      timing: {
        ...previous.timing,
        activeMinutes: 25,
        elapsedMinutes: 25,
        durationSource: "observed_outcome_adjustment",
      },
      execution: {
        ...previous.execution,
        orderedPhases: [
          { ...previous.execution.orderedPhases[0]!, activeMinutes: 13 },
          { ...previous.execution.orderedPhases[1]!, activeMinutes: 12 },
        ],
      },
      provenance: {
        evidenceRefs: ["attempt:duration-signal"],
        ruleTrace: [{
          ruleId: "duration.observed_outcome_adjustment",
          result: "15_to_25",
          reason: "Repeated comparable completions support moving one duration level.",
          evidenceRefs: ["attempt:duration-signal"],
        }],
      },
    },
  }));
}

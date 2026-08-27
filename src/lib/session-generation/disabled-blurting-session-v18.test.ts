import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  BLURTING_RUNTIME_FORMAT,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  selectMethodRecipe,
} from "@/lib/learning/method-recipes";
import {
  BLURTING_TARGET_EVALUATOR_VERSION,
  DisabledBlurtingRuntimeV18Schema,
  DisabledCachedBlurtingSessionV18Schema,
  readDisabledCachedBlurtingSessionV18,
  toDisabledCachedBlurtingSessionV18,
} from "@/lib/session-generation/disabled-blurting-session-v18";
import {
  CachedGeneratedSessionSchema,
  CachedGeneratedSessionV15Schema,
  CachedGeneratedSessionV16Schema,
  CachedGeneratedSessionV17Schema,
  GeneratedSessionDraftOutputSchema,
} from "@/lib/session-generation/schema";
import { readSessionResourceFromStepData } from "@/lib/session-generation/resource";
import {
  BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS,
  type BlurtingSessionRuntimeTargetContract,
} from "@/lib/study-route/blurting-session-generation-contract";
import {
  BLURTING_PHASE_IDS,
  BLURTING_RECIPE_RUNTIME_VERSION,
  blurtingFinalCheckEvidenceId,
  blurtingMethodRecipeTrace,
  blurtingRecipeRuntimeTrace,
} from "@/lib/study-route/method-recipe-contract";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

const IDS = {
  lineage: "92000000-0000-4000-8000-000000000001",
  revision: "92000000-0000-4000-8000-000000000002",
  plan: "92000000-0000-4000-8000-000000000003",
  session: "92000000-0000-4000-8000-000000000004",
  firstTarget: "92000000-0000-4000-8000-000000000005",
  secondTarget: "92000000-0000-4000-8000-000000000006",
  other: "92000000-0000-4000-8000-000000000007",
} as const;

describe("disabled Blurting cached-session V18 boundary", () => {
  it("truthfully represents both ordered multi-target and one-target sessions", () => {
    const multiTarget = convertFixture(2);
    expect(multiTarget).toMatchObject({
      schemaVersion: 18,
      boundaryStatus: "disabled_schema_only",
      sourceReadiness: "pending_runtime_source_validation",
      routeIdentity: {
        lifecycleStatus: "committed",
        planId: IDS.plan,
        sessionId: IDS.session,
        routeRevisionId: IDS.revision,
      },
      deliveryIdentity: {
        learningMode: "study",
        taskType: "conceptual_learning",
        methodId: "retrieval_practice",
        visibleMethodName: "Blurting",
        visibleSupportingTechniqueId: "blurting_v1",
      },
    });
    expect(multiTarget?.orderedTargets.map((target) => target.targetId)).toEqual([
      IDS.firstTarget,
      IDS.secondTarget,
    ]);
    expect(multiTarget?.phaseEnvelopes.map((phase) => ({
      phaseId: phase.phaseId,
      methodPhase: phase.methodPhase,
      activeMinutes: phase.activeMinutes,
      targetIds: phase.targetIds,
    }))).toEqual([{
      phaseId: BLURTING_PHASE_IDS[0],
      methodPhase: "retrieve",
      activeMinutes: 4,
      targetIds: [IDS.firstTarget, IDS.secondTarget],
    }, {
      phaseId: BLURTING_PHASE_IDS[1],
      methodPhase: "repair",
      activeMinutes: 4,
      targetIds: [IDS.firstTarget, IDS.secondTarget],
    }, {
      phaseId: BLURTING_PHASE_IDS[2],
      methodPhase: "transfer",
      activeMinutes: 4,
      targetIds: [IDS.firstTarget, IDS.secondTarget],
    }]);
    expect(multiTarget?.phaseEnvelopes.filter((phase) => "runtime" in phase))
      .toHaveLength(1);
    expect(multiTarget?.phaseEnvelopes[0].runtime).toMatchObject({
      kind: "retrieval_round",
      format: "broad_recall_v1",
      targetBindings: targetContracts(2),
    });
    expect(multiTarget?.completionContract).toEqual({
      kind: "target_bound_closed_source_transfer",
      evaluatorVersion: BLURTING_TARGET_EVALUATOR_VERSION,
      resultOrder: "ordered_targets",
      requiresIndependentAttempt: true,
      evaluatorUnavailableResult: "unverified",
      targetBindings: targetContracts(2).map(({ targetId, evidenceId }) => ({
        targetId,
        evidenceId,
      })),
    });

    const oneTarget = convertFixture(1);
    expect(oneTarget?.orderedTargets).toHaveLength(1);
    expect(oneTarget?.phaseEnvelopes.every((phase) => (
      phase.targetIds.length === 1 && phase.targetIds[0] === IDS.firstTarget
    ))).toBe(true);
    expect(oneTarget?.completionContract.targetBindings).toEqual([{
      targetId: IDS.firstTarget,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
    }]);
  });

  it("rejects route, target, phase, runtime, and evaluator tampering", () => {
    const exact = required(convertFixture(2));
    const route = blurtingRoute(2);
    const targets = targetContracts(2);

    const wrongRoute = mutableClone(exact);
    wrongRoute.routeIdentity.routeRevisionId = IDS.other;
    expect(readFixture(wrongRoute, route, targets)).toBeNull();

    const wrongTask = mutableClone(exact);
    wrongTask.deliveryIdentity.taskType = "reading_to_quiz";
    expect(DisabledCachedBlurtingSessionV18Schema.safeParse(wrongTask).success).toBe(true);
    expect(readFixture(wrongTask, route, targets)).toBeNull();

    const reversedTargets = mutableClone(exact);
    reversedTargets.orderedTargets.reverse();
    expect(readFixture(reversedTargets, route, targets)).toBeNull();

    const routeMismatchedMinutes = mutableClone(exact);
    routeMismatchedMinutes.phaseEnvelopes[0].activeMinutes = 5;
    expect(DisabledCachedBlurtingSessionV18Schema.safeParse(routeMismatchedMinutes).success)
      .toBe(true);
    expect(readFixture(routeMismatchedMinutes, route, targets)).toBeNull();

    const competingRuntime = mutableClone(exact);
    Object.assign(competingRuntime.phaseEnvelopes[1], {
      runtime: competingRuntime.phaseEnvelopes[0].runtime,
    });
    expect(readFixture(competingRuntime, route, targets)).toBeNull();

    const changedCriterion = mutableClone(exact);
    changedCriterion.phaseEnvelopes[0].runtime.targetBindings[0]!
      .comparisonCriterion = "A different but superficially plausible comparison criterion.";
    expect(readFixture(changedCriterion, route, targets)).toBeNull();

    const reversedCompletion = mutableClone(exact);
    reversedCompletion.completionContract.targetBindings.reverse();
    expect(readFixture(reversedCompletion, route, targets)).toBeNull();

    const wrongEvaluator = mutableClone(exact);
    (wrongEvaluator.completionContract as unknown as { evaluatorVersion: string })
      .evaluatorVersion = "blurting_target_evaluator_v2";
    expect(readFixture(wrongEvaluator, route, targets)).toBeNull();

    const wrongFormat = mutableClone(exact);
    (wrongFormat.phaseEnvelopes[0].runtime as unknown as { format: string }).format =
      "retrieval_prompt_set_v1";
    expect(readFixture(wrongFormat, route, targets)).toBeNull();
  });

  it("retains no scalar target, generic evidence, outcome, or learner-text fields", () => {
    const exact = required(convertFixture(2));
    const keys = collectKeys(exact);

    expect(keys).not.toContain("topicId");
    expect(keys).not.toContain("topicIds");
    expect(keys).not.toContain("activities");
    expect(keys).not.toContain("coverage");
    expect(keys).not.toContain("completionEvidence");
    expect(keys).not.toContain("outcome");
    expect(keys).not.toContain("correctAnswer");
    expect(keys).not.toContain("feedback");
    expect(keys).not.toContain("learnerAnswer");
    expect(keys).not.toContain("learnerText");
    expect(keys).toContain("evidenceId");

    const rootLearnerText = mutableClone(exact);
    Object.assign(rootLearnerText, { learnerText: "private learner draft" });
    expect(DisabledCachedBlurtingSessionV18Schema.safeParse(rootLearnerText).success)
      .toBe(false);

    const nestedLearnerText = mutableClone(exact);
    Object.assign(nestedLearnerText.phaseEnvelopes[0].runtime.prompts[0]!, {
      learnerAnswer: "private learner draft",
    });
    expect(DisabledCachedBlurtingSessionV18Schema.safeParse(nestedLearnerText).success)
      .toBe(false);

    const genericOutcome = mutableClone(exact);
    Object.assign(genericOutcome.completionContract, { outcome: "secure" });
    expect(DisabledCachedBlurtingSessionV18Schema.safeParse(genericOutcome).success)
      .toBe(false);
  });

  it("requires exact canonical instants and reject-only scalar text", () => {
    const exact = mutableClone(required(convertFixture(1)));
    const astralPrompt = "😀".repeat(320);
    exact.phaseEnvelopes[0].runtime.prompts[0]!.prompt = astralPrompt;
    const parsed = DisabledCachedBlurtingSessionV18Schema.safeParse(exact);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phaseEnvelopes[0].runtime.prompts[0]?.prompt)
        .toBe(astralPrompt);
    }

    for (const generatedAt of [
      "2026-08-24T15:00:00.000+01:00",
      "2026-08-24T14:00:00Z",
      `2026-08-24T14:00:00.${"0".repeat(100_000)}Z`,
    ]) {
      const invalidTimestamp = mutableClone(exact);
      invalidTimestamp.generatedAt = generatedAt;
      expect(DisabledCachedBlurtingSessionV18Schema.safeParse(invalidTimestamp).success)
        .toBe(false);
    }

    for (const invalidPrompt of [
      " padded prompt",
      "padded prompt ",
      "prompt\u0000value",
      "prompt\ud800value",
      "😀".repeat(321),
    ]) {
      const invalidText = mutableClone(exact);
      invalidText.phaseEnvelopes[0].runtime.prompts[0]!.prompt = invalidPrompt;
      expect(DisabledCachedBlurtingSessionV18Schema.safeParse(invalidText).success)
        .toBe(false);
    }
  });

  it("rejects uppercase, nil, and max UUIDs in nested V18 target bindings", () => {
    const exact = required(convertFixture(1));
    for (const invalidTargetId of [
      "ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]) {
      const runtime = mutableClone(exact.phaseEnvelopes[0].runtime);
      runtime.targetBindings[0]!.targetId = invalidTargetId;
      runtime.targetBindings[0]!.evidenceId = blurtingFinalCheckEvidenceId(
        invalidTargetId,
      );

      expect(DisabledBlurtingRuntimeV18Schema.safeParse(runtime).success).toBe(false);

      const session = mutableClone(exact);
      session.orderedTargets[0]!.targetId = invalidTargetId;
      session.orderedTargets[0]!.evidenceId = blurtingFinalCheckEvidenceId(
        invalidTargetId,
      );
      session.phaseEnvelopes[0].runtime.targetBindings[0] = {
        ...session.phaseEnvelopes[0].runtime.targetBindings[0]!,
        targetId: invalidTargetId,
        evidenceId: blurtingFinalCheckEvidenceId(invalidTargetId),
      };

      expect(DisabledCachedBlurtingSessionV18Schema.safeParse(session).success)
        .toBe(false);
    }
  });

  it("is deterministic, nonmutating, and deeply frozen after an exact read", () => {
    const route = blurtingRoute(2);
    const session = boundSession(2);
    const targets = targetContracts(2);
    const inputSnapshot = structuredClone({ route, session, targets });

    const first = toDisabledCachedBlurtingSessionV18({
      routeInput: route,
      sessionInput: session,
      expectedIdentity: expectedIdentity(),
      expectedTargetContracts: targets,
      model: "test-model",
      generatedAt: "2026-08-24T14:00:00.000Z",
    });
    const second = toDisabledCachedBlurtingSessionV18({
      routeInput: route,
      sessionInput: session,
      expectedIdentity: expectedIdentity(),
      expectedTargetContracts: targets,
      model: "test-model",
      generatedAt: "2026-08-24T14:00:00.000Z",
    });

    expect(first).not.toBeNull();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect({ route, session, targets }).toEqual(inputSnapshot);
    expectDeepFrozen(required(first));
  });

  it("does not bypass the existing fail-closed activity binding", () => {
    const route = blurtingRoute(2);
    const targets = targetContracts(2);

    const scalarActivity = mutableClone(boundSession(2));
    scalarActivity.activities[2]!.topicId = IDS.other;
    expect(convert(scalarActivity, route, targets)).toBeNull();

    const swappedRuntimeBindings = mutableClone(boundSession(2));
    const runtime = swappedRuntimeBindings.activities[0]?.methodRuntime;
    if (runtime?.kind !== "retrieval_round" || !runtime.targetBindings) {
      throw new Error("Expected a broad-recall runtime fixture.");
    }
    runtime.targetBindings.reverse();
    expect(convert(swappedRuntimeBindings, route, targets)).toBeNull();

    const superseded = mutableClone(route);
    superseded.identity.lifecycleStatus = "superseded";
    expect(convert(boundSession(2), superseded, targets)).toBeNull();
  });

  it("remains unreachable from every public V15-V17 cache/resource union", () => {
    const exact = required(convertFixture(2));

    expect(CachedGeneratedSessionV15Schema.safeParse(exact).success).toBe(false);
    expect(CachedGeneratedSessionV16Schema.safeParse(exact).success).toBe(false);
    expect(CachedGeneratedSessionV17Schema.safeParse(exact).success).toBe(false);
    expect(CachedGeneratedSessionSchema.safeParse(exact).success).toBe(false);
    expect(readSessionResourceFromStepData({ generatedSession: exact })).toBeUndefined();
  });
});

function convertFixture(targetCount: 1 | 2) {
  return convert(
    boundSession(targetCount),
    blurtingRoute(targetCount),
    targetContracts(targetCount),
  );
}

function convert(
  sessionInput: unknown,
  routeInput: unknown,
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[],
) {
  return toDisabledCachedBlurtingSessionV18({
    sessionInput,
    routeInput,
    expectedIdentity: expectedIdentity(),
    expectedTargetContracts,
    model: "test-model",
    generatedAt: "2026-08-24T14:00:00.000Z",
  });
}

function readFixture(
  input: unknown,
  routeInput: unknown,
  expectedTargetContracts: readonly BlurtingSessionRuntimeTargetContract[],
) {
  return readDisabledCachedBlurtingSessionV18(
    input,
    routeInput,
    expectedIdentity(),
    expectedTargetContracts,
  );
}

function expectedIdentity() {
  return {
    planId: IDS.plan,
    sessionId: IDS.session,
    routeRevisionId: IDS.revision,
  };
}

function targetContracts(targetCount: 1 | 2): BlurtingSessionRuntimeTargetContract[] {
  return [{
    targetId: IDS.firstTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
    concept: "First mechanism",
    comparisonCriterion: "Identifies the first mechanism and the condition it produces.",
    transferSuccessCriterion: "Predicts the immediate effect of interrupting the first mechanism.",
  }, {
    targetId: IDS.secondTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
    concept: "Second mechanism",
    comparisonCriterion: "Explains how the second mechanism depends on the produced condition.",
    transferSuccessCriterion: "Explains the downstream effect on the second mechanism.",
  }].slice(0, targetCount);
}

function boundSession(targetCount: 1 | 2) {
  const targets = targetContracts(targetCount);
  const targetIds = targets.map((target) => target.targetId);
  const activities = BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS.map((scaffold, index) => ({
    topicId: null,
    methodPhase: scaffold.methodPhase,
    estimatedMinutes: 4,
    requiredForCompletion: true,
    label: scaffold.label,
    title: scaffold.title,
    body: scaffold.body,
    teaching: null,
    type: "reflection" as const,
    concept: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
    practiceIntent: null,
    misconceptionSummary: null,
    methodRuntime: index === 0 ? broadRuntime(targets) : null,
  }));

  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: targetIds,
    rationale: "Broad recall exposes gaps before source comparison, repair, and a fresh transfer check.",
    coverage: {
      focus: "Recall the active mechanisms before checking the committed comparison source.",
      essentialIdeas: targets.map((target) => target.comparisonCriterion),
      completionEvidence: targets.map((target) => target.transferSuccessCriterion),
      evidenceMap: targets.map((target) => ({
        essentialIdea: target.comparisonCriterion,
        activityConcept: target.concept,
      })),
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "retrieval_practice",
      name: BLURTING_VISIBLE_METHOD_NAME,
      what: "Recall the complete target set before reopening the committed source.",
      why: "A minimally cued attempt makes omissions visible before repair and transfer.",
      how: [
        "Recall broadly with the committed source closed.",
        "Compare every configured gap and repair it before transfer.",
        "Close the source and complete the fresh target-bound check.",
      ],
      completion: "Every active target receives one result from the final transfer evaluator.",
      personalization: [
        "The committed route selected a bounded three-phase Blurting sequence for these active targets.",
      ],
    },
    sourceGrounding: null,
    activities,
  });
}

function broadRuntime(targets: readonly BlurtingSessionRuntimeTargetContract[]) {
  return {
    kind: "retrieval_round" as const,
    format: BLURTING_RUNTIME_FORMAT,
    sourceClosedReminder: "Close the source before reconstructing everything you can remember.",
    prompts: [{
      prompt: "Reconstruct the active mechanisms and their causal relationship from memory.",
      expectedAnswer: "The first mechanism produces the condition used by the downstream mechanism.",
      hint: null,
    }],
    comparisonInstructions: "Only after the broad attempt, reopen the source and compare every configured gap.",
    gapChecklist: targets.map((target) => target.comparisonCriterion),
    correctionInstruction: "Correct only the missing or inaccurate relationships in your own words.",
    transferPrompt: {
      sourceClosedReminder: "Close the source again before answering the transfer question.",
      prompt: "Predict the downstream change when the first mechanism is interrupted.",
      expectedAnswer: "The condition falls, so the downstream mechanism can no longer proceed normally.",
    },
    targetBindings: targets.map((target) => ({ ...target })),
  };
}

function blurtingRoute(targetCount: 1 | 2): StudyRoute {
  const targets = targetContracts(targetCount);
  const targetIds = targets.map((target) => target.targetId);
  const decision = selectMethodRecipe({
    blurtingEnabled: true,
    learningMode: "study",
    primaryMethodId: "retrieval_practice",
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    isReview: false,
    activeMinutes: 12,
    activeTargetCount: targetCount,
    comparisonSourceAvailable: true,
  });
  if (decision.kind !== "recipe") throw new Error("Expected an eligible Blurting fixture.");

  return StudyRouteSchema.parse({
    identity: {
      routeLineageId: IDS.lineage,
      routeRevisionId: IDS.revision,
      revisionNumber: 1,
      schemaVersion: 1,
      lifecycleStatus: "committed",
      planId: IDS.plan,
      sessionId: IDS.session,
      createdAt: "2026-08-24T12:00:00.000Z",
      committedAt: "2026-08-24T12:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Recall the active mechanisms, repair each gap, and verify every target independently.",
      targetStates: targets.map((target, index) => ({
        targetId: target.targetId,
        stage: index === 0 ? "developing" : "retrieval_ready",
        uncertainty: index === 0 ? "medium" : "low",
        evidenceRefs: [],
      })),
      sourceRequirements: {
        sourceType: "user_materials",
        requiredSourceIds: ["source:chapter-1"],
        groundingRequired: true,
        instructions: ["Compare the broad recall with the committed source before repairing gaps."],
      },
    },
    approach: {
      mode: "practice",
      executionEnvironment: "inside_yova",
      primaryMethodId: "retrieval_practice",
      visibleMethodName: BLURTING_VISIBLE_METHOD_NAME,
      visibleSupportingTechniqueId: BLURTING_SUPPORTING_TECHNIQUE_ID,
      confidenceLevel: "medium",
    },
    timing: {
      activeMinutes: 12,
      elapsedMinutes: 12,
      durationSource: "router_default",
    },
    execution: {
      orderedPhases: [{
        phaseId: BLURTING_PHASE_IDS[0],
        methodPhase: "retrieve",
        activeMinutes: 4,
        targetIds,
      }, {
        phaseId: BLURTING_PHASE_IDS[1],
        methodPhase: "repair",
        activeMinutes: 4,
        targetIds,
      }, {
        phaseId: BLURTING_PHASE_IDS[2],
        methodPhase: "transfer",
        activeMinutes: 4,
        targetIds,
      }],
      difficultyTier: "standard",
      initialSupport: "independent_start",
      activityLimit: 3,
      completionEvidence: targets.map((target) => ({
        evidenceId: target.evidenceId,
        targetIds: [target.targetId],
        kind: "verification",
        description: `Answer a fresh closed-source check for ${target.concept} independently.`,
        requiresIndependentAttempt: true,
      })),
      deferredTargets: [],
    },
    agency: {
      controlMode: "yova_decides",
      selectedBy: "yova",
      alternatives: [],
    },
    explanation: {
      shortReason: "Broad recall followed by source comparison and a fresh check fits these targets.",
      taskRequirements: ["Recall broadly before comparing with the source."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      routerVersion: `base-router-v1+${BLURTING_RECIPE_RUNTIME_VERSION}`,
      profileVersion: "profile-v1",
      evidenceRefs: [],
      ruleTrace: [
        blurtingMethodRecipeTrace(decision),
        blurtingRecipeRuntimeTrace("inside_yova"),
      ],
    },
  });
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, child]) => {
    keys.push(key);
    collectKeys(child, keys);
  });
  return keys;
}

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeepFrozen);
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a disabled V18 fixture.");
  return value;
}

type Mutable<T> = T extends object
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

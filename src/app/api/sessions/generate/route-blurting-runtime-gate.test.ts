import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLURTING_RUNTIME_FORMAT,
  BLURTING_SUPPORTING_TECHNIQUE_ID,
  BLURTING_VISIBLE_METHOD_NAME,
  selectMethodRecipe,
} from "@/lib/learning/method-recipes";
import {
  BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS,
  BLURTING_SESSION_DELIVERY_UNAVAILABLE_ISSUE,
  BLURTING_SESSION_GENERATION_CONTRACT_VERSION,
  BLURTING_SESSION_SOURCE_READINESS,
  blurtingSessionGenerationContract,
  blurtingSessionRuntimeBindingIssue,
  blurtingSessionRuntimeIssue,
} from "@/lib/study-route/blurting-session-generation-contract";
import {
  GeneratedSessionDraftOutputSchema,
  GeneratedSessionDraftSchema,
  type GeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import {
  BLURTING_PHASE_IDS,
  BLURTING_RECIPE_RUNTIME_VERSION,
  blurtingFinalCheckEvidenceId,
  blurtingMethodRecipeTrace,
  blurtingRecipeRuntimeTrace,
} from "@/lib/study-route/method-recipe-contract";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  cacheRead: vi.fn(),
  createClient: vi.fn(),
  developmentPreview: true,
  generate: vi.fn(),
  isProviderConfigured: vi.fn(),
  rateLimit: vi.fn(),
  releaseClaim: vi.fn(),
  releaseReservation: vi.fn(),
  reserve: vi.fn(),
  settleClaim: vi.fn(),
  supabaseConfigured: false,
}));

vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservationAfterResponse: vi.fn(),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ model: "blurting-gate-test-model" }),
  isOpenAISessionConfigured: mocks.isProviderConfigured,
}));
vi.mock("@/lib/openai/session-generation-strategy", () => ({
  generateProductionSessionWithOpenAI: mocks.generate,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  releaseAIRequestClaim: mocks.releaseClaim,
  releaseAIRequestReservation: mocks.releaseReservation,
  reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: mocks.settleClaim,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => mocks.developmentPreview,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkSessionGenerationRateLimit: mocks.rateLimit,
  requestRateLimitKey: () => "blurting-gate-test",
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.supabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { POST } from "@/app/api/sessions/generate/route";

const IDS = {
  lineage: "91000000-0000-4000-8000-000000000001",
  revision: "91000000-0000-4000-8000-000000000002",
  plan: "91000000-0000-4000-8000-000000000003",
  session: "91000000-0000-4000-8000-000000000004",
  firstTarget: "91000000-0000-4000-8000-000000000005",
  secondTarget: "91000000-0000-4000-8000-000000000006",
} as const;

describe("Blurting session-generation route contract", () => {
  it("exports one frozen canonical target, phase, and evidence identity", () => {
    const route = blurtingRoute();
    route.execution.orderedPhases.forEach((phase) => {
      phase.targetIds = [IDS.secondTarget, IDS.firstTarget];
    });
    route.execution.completionEvidence.reverse();

    const contract = blurtingSessionGenerationContract(route, expectedIdentity());

    expect(contract).toEqual({
      version: BLURTING_SESSION_GENERATION_CONTRACT_VERSION,
      identity: expectedIdentity(),
      executionEnvironment: "inside_yova",
      runtimeFormat: BLURTING_RUNTIME_FORMAT,
      sourceReadiness: BLURTING_SESSION_SOURCE_READINESS,
      targetIds: [IDS.firstTarget, IDS.secondTarget],
      orderedPhases: [{
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
      }],
      completionEvidence: [{
        evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
        targetId: IDS.firstTarget,
        kind: "verification",
        description: "Answer a fresh closed-source check for the first target independently.",
        requiresIndependentAttempt: true,
      }, {
        evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
        targetId: IDS.secondTarget,
        kind: "verification",
        description: "Answer a fresh closed-source check for the second target independently.",
        requiresIndependentAttempt: true,
      }],
    });
    expect(contract).not.toHaveProperty("authorized");
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract?.identity)).toBe(true);
    expect(Object.isFrozen(contract?.targetIds)).toBe(true);
    expect(Object.isFrozen(contract?.orderedPhases)).toBe(true);
    expect(Object.isFrozen(contract?.orderedPhases[0]?.targetIds)).toBe(true);
    expect(Object.isFrozen(contract?.completionEvidence)).toBe(true);
    expect(Object.isFrozen(contract?.completionEvidence[0])).toBe(true);
  });

  it("accepts both delivery environments while leaving source readiness unresolved", () => {
    for (const environment of ["inside_yova", "outside_yova"] as const) {
      expect(blurtingSessionGenerationContract(
        blurtingRoute(environment),
        expectedIdentity(),
      )).toMatchObject({
        executionEnvironment: environment,
        sourceReadiness: "pending_runtime_source_validation",
      });
    }
  });

  it("rejects ordinary, uncommitted, malformed, and identity-mismatched routes", () => {
    const exact = blurtingRoute();
    expect(blurtingSessionGenerationContract(
      exact,
      { ...expectedIdentity(), planId: IDS.lineage },
    )).toBeNull();
    expect(blurtingSessionGenerationContract(
      exact,
      { ...expectedIdentity(), sessionId: IDS.lineage },
    )).toBeNull();
    expect(blurtingSessionGenerationContract(
      exact,
      { ...expectedIdentity(), routeRevisionId: IDS.lineage },
    )).toBeNull();

    const provisional = structuredClone(exact);
    provisional.identity.lifecycleStatus = "provisional";
    delete provisional.identity.committedAt;
    expect(blurtingSessionGenerationContract(provisional, expectedIdentity())).toBeNull();

    const superseded = structuredClone(exact);
    superseded.identity.lifecycleStatus = "superseded";
    expect(blurtingSessionGenerationContract(superseded, expectedIdentity())).toBeNull();

    expect(blurtingSessionGenerationContract(ordinaryRoute(), expectedIdentity())).toBeNull();
    expect(blurtingSessionGenerationContract({}, expectedIdentity())).toBeNull();
  });
});

describe("pure Blurting route/runtime compatibility", () => {
  it("separates exact route/runtime binding from unavailable learner delivery", () => {
    const session = exactBroadRecallSession();

    expect(runtimeBindingIssue(session)).toBeNull();
    expect(runtimeDeliveryIssue(session)).toBe(BLURTING_SESSION_DELIVERY_UNAVAILABLE_ISSUE);
    const genericDraft = GeneratedSessionDraftSchema.safeParse(session);
    expect(genericDraft.success).toBe(false);
    if (genericDraft.success) throw new Error("Expected the generic evidence schema to fail closed.");
    expect(genericDraft.error.issues.map((issue) => issue.message).join(" "))
      .toContain("knowledge-producing attempt");
  });

  it("rejects a broad runtime for an ordinary or noncommitted route", () => {
    const session = exactBroadRecallSession();
    expect(blurtingSessionRuntimeBindingIssue(
      session,
      ordinaryRoute(),
      expectedIdentity(),
      trustedTargetContracts(),
    )).toContain("exact committed Blurting");

    const superseded = structuredClone(blurtingRoute());
    superseded.identity.lifecycleStatus = "superseded";
    expect(blurtingSessionRuntimeBindingIssue(
      session,
      superseded,
      expectedIdentity(),
      trustedTargetContracts(),
    )).toContain("exact committed Blurting");
  });

  it("requires exact task, method, target, phase, and minute identity", () => {
    const wrongTask = exactBroadRecallSession();
    wrongTask.methodBriefing.taskType = "problem_solving";
    expect(runtimeBindingIssue(wrongTask)).toContain("task type");

    const wrongMethod = exactBroadRecallSession();
    wrongMethod.methodBriefing.name = "Active Recall";
    expect(runtimeBindingIssue(wrongMethod)).toContain("method identity");

    const reversedTargets = exactBroadRecallSession();
    reversedTargets.topicIds.reverse();
    expect(runtimeBindingIssue(reversedTargets)).toContain("route order");

    const wrongPhase = exactBroadRecallSession();
    wrongPhase.activities[1]!.methodPhase = "transfer";
    expect(runtimeBindingIssue(wrongPhase)).toContain("phase and minute order");

    const wrongMinutes = exactBroadRecallSession();
    wrongMinutes.activities[0]!.estimatedMinutes = 3;
    expect(runtimeBindingIssue(wrongMinutes)).toContain("phase and minute order");
  });

  it("keeps every phase required and free of scalar or generic evidence semantics", () => {
    const optionalRepair = exactBroadRecallSession();
    optionalRepair.activities[1]!.requiredForCompletion = false;
    expect(runtimeBindingIssue(optionalRepair)).toContain("Every broad-recall phase must be required");

    const scalarTarget = exactBroadRecallSession();
    scalarTarget.activities[2]!.topicId = IDS.lineage;
    expect(runtimeBindingIssue(scalarTarget)).toContain("cannot carry a scalar");

    const duplicatedPresentation = exactBroadRecallSession();
    duplicatedPresentation.activities[1]!.label = "Generic repair question";
    expect(runtimeBindingIssue(duplicatedPresentation)).toContain("exact non-evidence");
  });

  it("requires exactly one broad runtime on retrieve and no competing runtime", () => {
    const moved = exactBroadRecallSession();
    moved.activities[1]!.methodRuntime = moved.activities[0]!.methodRuntime;
    moved.activities[0]!.methodRuntime = null;
    expect(runtimeBindingIssue(moved)).toContain("canonical retrieve activity");

    const duplicate = exactBroadRecallSession();
    duplicate.activities[1]!.methodRuntime = duplicate.activities[0]!.methodRuntime;
    expect(runtimeBindingIssue(duplicate)).toContain("only broad-recall runtime");
  });

  it("rejects malformed, duplicate, and route-mismatched binding order", () => {
    const malformed = exactBroadRecallSession();
    const malformedRuntime = broadRuntime(malformed);
    malformedRuntime.targetBindings = [{
      ...malformedRuntime.targetBindings![0]!,
      evidenceId: "different-evidence",
    }];
    expect(runtimeBindingIssue(malformed)).toContain("structurally readable");

    const duplicate = exactBroadRecallSession();
    const duplicateRuntime = broadRuntime(duplicate);
    duplicateRuntime.targetBindings = [
      duplicateRuntime.targetBindings![0]!,
      duplicateRuntime.targetBindings![0]!,
    ];
    expect(runtimeBindingIssue(duplicate)).toContain("structurally readable");

    const reversed = exactBroadRecallSession();
    broadRuntime(reversed).targetBindings!.reverse();
    expect(runtimeBindingIssue(reversed)).toContain("trusted server-owned target contract");
  });

  it("requires the generated runtime to preserve each trusted target's criteria", () => {
    const swappedCriteria = exactBroadRecallSession();
    const swappedRuntime = broadRuntime(swappedCriteria);
    const firstCriterion = swappedRuntime.targetBindings![0]!.comparisonCriterion;
    swappedRuntime.targetBindings![0]!.comparisonCriterion =
      swappedRuntime.targetBindings![1]!.comparisonCriterion;
    swappedRuntime.targetBindings![1]!.comparisonCriterion = firstCriterion;
    expect(runtimeBindingIssue(swappedCriteria)).toContain("assessment criteria");

    const unboundExpected = trustedTargetContracts();
    unboundExpected[0] = {
      ...unboundExpected[0]!,
      targetId: IDS.secondTarget,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
    };
    expect(blurtingSessionRuntimeBindingIssue(
      exactBroadRecallSession(),
      blurtingRoute(),
      expectedIdentity(),
      unboundExpected,
    )).toContain("trusted broad-recall target contract");
  });
});

describe("guided-session Blurting delivery capability gate", () => {
  beforeEach(() => {
    mocks.cacheRead.mockReset();
    mocks.createClient.mockReset();
    mocks.developmentPreview = true;
    mocks.generate.mockReset();
    mocks.isProviderConfigured.mockReset().mockReturnValue(true);
    mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.releaseClaim.mockReset();
    mocks.releaseReservation.mockReset();
    mocks.reserve.mockReset();
    mocks.settleClaim.mockReset();
    mocks.supabaseConfigured = false;
  });

  it("stops an authenticated exact route before cache, allowance, or provider work", async () => {
    const client = authenticatedClient(blurtingRoute());
    mocks.developmentPreview = false;
    mocks.supabaseConfigured = true;
    mocks.createClient.mockResolvedValue(client);

    const response = await POST(generationRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "blurting_runtime_unavailable",
      error: "Blurting is saved for this session, but its dedicated runtime is not available yet. Choose another method before starting.",
      retryable: false,
    });
    expect(client.from.mock.calls.map(([table]) => table)).toEqual([
      "plan_sessions",
      "study_routes",
    ]);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(mocks.cacheRead).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("returns the same stable response in preview before provider capability or work", async () => {
    const route = blurtingRoute();
    const response = await POST(generationRequest({
      previewContext: previewContext(route),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "blurting_runtime_unavailable",
      retryable: false,
    });
    expect(mocks.isProviderConfigured).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.cacheRead).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("leaves an ordinary exact route on the existing delivery path", async () => {
    mocks.isProviderConfigured.mockReturnValue(false);

    const response = await POST(generationRequest({
      previewContext: previewContext(ordinaryRoute()),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Live guided-session generation is not connected yet.",
    });
    expect(mocks.isProviderConfigured).toHaveBeenCalledOnce();
  });

  it("keeps broad-recall enablement absent from production call sites", () => {
    const violations = productionTypeScriptFiles(resolve(process.cwd(), "src"))
      .filter((file) => /allowBroadRecall\s*:\s*true/u.test(readFileSync(file, "utf8")));

    expect(violations).toEqual([]);
  });
});

function expectedIdentity() {
  return {
    planId: IDS.plan,
    sessionId: IDS.session,
    routeRevisionId: IDS.revision,
  };
}

function runtimeBindingIssue(
  session: GeneratedSessionDraft,
  route: StudyRoute = blurtingRoute(),
) {
  return blurtingSessionRuntimeBindingIssue(
    session,
    route,
    expectedIdentity(),
    trustedTargetContracts(),
  );
}

function runtimeDeliveryIssue(
  session: GeneratedSessionDraft,
  route: StudyRoute = blurtingRoute(),
) {
  return blurtingSessionRuntimeIssue(
    session,
    route,
    expectedIdentity(),
    trustedTargetContracts(),
  );
}

function exactBroadRecallSession(): GeneratedSessionDraft {
  const scaffolds = BLURTING_NON_EVIDENCE_ACTIVITY_SCAFFOLDS.map((scaffold, index) => ({
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
    methodRuntime: index === 0 ? {
      kind: "retrieval_round" as const,
      format: BLURTING_RUNTIME_FORMAT,
      sourceClosedReminder: "Close the source before writing everything you can reconstruct.",
      prompts: [{
        prompt: "Reconstruct both mechanisms and their causal relationship from memory.",
        expectedAnswer: "The first mechanism produces the condition used by the second mechanism.",
        hint: null,
      }],
      comparisonInstructions: "Only after the broad attempt, reopen the source and compare each mechanism.",
      gapChecklist: [
        "Check the first mechanism and the condition it produces.",
        "Check the second mechanism and its dependence on that condition.",
      ],
      correctionInstruction: "Correct only the missing or inaccurate relationships in your own words.",
      transferPrompt: {
        sourceClosedReminder: "Close the source again before answering the transfer question.",
        prompt: "Predict the downstream change when the first mechanism is interrupted.",
        expectedAnswer: "The condition falls, so the second mechanism can no longer proceed normally.",
      },
      targetBindings: trustedTargetContracts(),
    } : null,
  }));

  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: [IDS.firstTarget, IDS.secondTarget],
    rationale: "Broad recall exposes gaps before a bounded source comparison, repair, and fresh transfer check.",
    coverage: {
      focus: "Recall and distinguish the two mechanisms before checking the committed source.",
      essentialIdeas: [
        "The first mechanism produces the condition used by the second mechanism.",
        "The second mechanism depends on the condition produced by the first mechanism.",
      ],
      completionEvidence: [
        "Apply the first mechanism independently in the fresh transfer.",
        "Explain the second mechanism independently in the fresh transfer.",
      ],
      evidenceMap: [{
        essentialIdea: "The first mechanism produces the condition used by the second mechanism.",
        activityConcept: "First mechanism",
      }, {
        essentialIdea: "The second mechanism depends on the condition produced by the first mechanism.",
        activityConcept: "Second mechanism",
      }],
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "retrieval_practice",
      name: BLURTING_VISIBLE_METHOD_NAME,
      what: "Recall the complete target set before reopening the committed source.",
      why: "A minimally cued attempt makes omissions visible before repair and a fresh transfer check.",
      how: [
        "Recall broadly with the committed source closed.",
        "Compare every configured gap and repair it before transfer.",
        "Close the source and complete the fresh target-bound check.",
      ],
      completion: "Every target has one result from the final independent transfer check.",
      personalization: [
        "The committed route selected a bounded three-phase Blurting sequence for these conceptual targets.",
      ],
    },
    sourceGrounding: null,
    activities: scaffolds,
  }) as GeneratedSessionDraft;
}

function trustedTargetContracts() {
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
  }];
}

function broadRuntime(session: GeneratedSessionDraft) {
  const runtime = session.activities[0]?.methodRuntime;
  if (runtime?.kind !== "retrieval_round" || runtime.format !== BLURTING_RUNTIME_FORMAT) {
    throw new Error("Expected a broad-recall runtime fixture.");
  }
  return runtime;
}

function blurtingRoute(
  executionEnvironment: "inside_yova" | "outside_yova" = "inside_yova",
): StudyRoute {
  const decision = selectMethodRecipe({
    blurtingEnabled: true,
    learningMode: "study",
    primaryMethodId: "retrieval_practice",
    taskType: "conceptual_learning",
    knowledgeStage: "developing",
    isReview: false,
    activeMinutes: 12,
    activeTargetCount: 2,
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
      desiredOutcome: "Recall both mechanisms broadly, repair each gap, and verify them independently.",
      targetStates: [{
        targetId: IDS.firstTarget,
        stage: "developing",
        uncertainty: "medium",
        evidenceRefs: [],
      }, {
        targetId: IDS.secondTarget,
        stage: "retrieval_ready",
        uncertainty: "low",
        evidenceRefs: [],
      }],
      sourceRequirements: {
        sourceType: executionEnvironment === "outside_yova"
          ? "trusted_external_source"
          : "user_materials",
        requiredSourceIds: ["source:chapter-1"],
        groundingRequired: true,
        instructions: ["Compare the broad recall with the committed source before repairing gaps."],
      },
    },
    approach: {
      mode: "practice",
      executionEnvironment,
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
      }],
      difficultyTier: "standard",
      initialSupport: "independent_start",
      activityLimit: 3,
      completionEvidence: [{
        evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
        targetIds: [IDS.firstTarget],
        kind: "verification",
        description: "Answer a fresh closed-source check for the first target independently.",
        requiresIndependentAttempt: true,
      }, {
        evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
        targetIds: [IDS.secondTarget],
        kind: "verification",
        description: "Answer a fresh closed-source check for the second target independently.",
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
        blurtingRecipeRuntimeTrace(executionEnvironment),
      ],
    },
  });
}

function ordinaryRoute() {
  const route = structuredClone(blurtingRoute());
  route.approach.visibleMethodName = "Retrieval practice";
  delete route.approach.visibleSupportingTechniqueId;
  route.provenance.routerVersion = "base-router-v1";
  route.provenance.ruleTrace = [{
    ruleId: "ordinary-runtime-v1",
    result: "ordinary:retrieval_practice",
    reason: "The ordinary route retains the existing retrieval-practice delivery path.",
    evidenceRefs: [],
  }];
  return StudyRouteSchema.parse(route);
}

function previewContext(route: StudyRoute) {
  return {
    studyRoute: route,
    sessionArchitectureVersion: "filled_teaching_v1" as const,
    learningGoal: {
      title: "Mechanisms to retrieve",
      topic: "Recall and distinguish two mechanisms before checking the source.",
      kind: "topic" as const,
      deadline: null,
      sourceMode: "user_materials" as const,
      studyMode: route.approach.executionEnvironment,
      learningIntent: "study" as const,
    },
    planRationale: "Use a bounded closed-source retrieval, repair, and transfer sequence.",
    knowledgeTopics: [knowledgeTopic(IDS.firstTarget, "First mechanism"), knowledgeTopic(IDS.secondTarget, "Second mechanism")],
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    session: {
      title: "Retrieve and repair both mechanisms",
      objective: "Recall both mechanisms broadly, repair gaps, and complete a fresh transfer.",
      method: "Retrieval practice",
      methodReason: "A closed-source attempt exposes gaps before focused source comparison.",
      estimatedMinutes: 12,
      learningMode: "study" as const,
      topicIds: [IDS.firstTarget, IDS.secondTarget],
      contentTargets: ["Recall the first mechanism", "Recall the second mechanism"],
      completionEvidence: route.execution.completionEvidence.map((item) => item.description),
    },
    learnerProfile: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

function knowledgeTopic(id: string, title: string) {
  return {
    id,
    title,
    description: `${title} and the relationship that distinguishes it from the other mechanism.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started" as const,
    initialEvidence: null,
    sourceReferences: [],
    origin: "material" as const,
    deferred: null,
    curriculumReference: null,
  };
}

function generationRequest(extra: Record<string, unknown> = {}) {
  return new Request("https://yova.example/api/sessions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: IDS.plan,
      planSessionId: IDS.session,
      routeRevisionId: IDS.revision,
      ...extra,
    }),
  });
}

function authenticatedClient(route: StudyRoute) {
  const generatedSessionCache = {};
  Object.defineProperty(generatedSessionCache, "generatedSession", {
    enumerable: true,
    get() {
      mocks.cacheRead();
      return { schemaVersion: 17 };
    },
  });
  const planSession = {
    id: IDS.session,
    plan_id: IDS.plan,
    sequence: 1,
    status: "ready",
    title: "Retrieve and repair both mechanisms",
    objective: "Recall both mechanisms broadly, repair gaps, and complete a fresh transfer.",
    method: "Retrieval practice",
    method_rationale: "A closed-source attempt exposes gaps before focused source comparison.",
    estimated_minutes: 12,
    step_data: generatedSessionCache,
    updated_at: "2026-08-24T12:01:00.000Z",
    committed_route_revision_id: IDS.revision,
  };
  const rows = new Map<string, unknown>([
    ["plan_sessions", planSession],
    ["study_routes", persistedRouteRow(route)],
  ]);
  const from = vi.fn((table: string) => {
    if (!rows.has(table)) throw new Error(`Unexpected ${table} query after the Blurting gate.`);
    return queryReturning(rows.get(table));
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "91000000-0000-4000-8000-000000000007" } },
        error: null,
      }),
    },
    from,
    rpc: vi.fn(),
  };
}

function persistedRouteRow(route: StudyRoute) {
  const { identity, ...routePayload } = route;
  return {
    route_revision_id: identity.routeRevisionId,
    route_lineage_id: identity.routeLineageId,
    revision_number: identity.revisionNumber,
    schema_version: identity.schemaVersion,
    lifecycle: identity.lifecycleStatus,
    plan_id: identity.planId,
    plan_session_id: identity.sessionId,
    predecessor_revision_id: identity.supersedesRevisionId ?? null,
    route_payload: routePayload,
    created_at: identity.createdAt,
    committed_at: identity.committedAt ?? null,
  };
}

function queryReturning(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = result.then.bind(result);
  return query;
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    if (!/\.tsx?$/u.test(entry.name) || /\.(?:test|spec)\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}

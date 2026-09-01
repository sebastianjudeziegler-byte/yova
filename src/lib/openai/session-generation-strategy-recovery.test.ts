import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import { generatedSessionStudyRouteIssue } from "@/lib/study-route/generation-contract";
import type { StudyRoute } from "@/lib/study-route/schema";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

describe("production evidence scoping before safe study recovery", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it("retains only scaffold and calibration evidence bound to this session", async () => {
    const context = bioenergeticsContext();
    const relevantConcept = context.session.contentTargets![0]!;
    const unrelatedScaffold = scaffoldSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    });
    const relevantScaffold = scaffoldSignal({
      topicId: context.session.topicIds[0]!,
      concept: relevantConcept,
    });
    const unrelatedCalibration = calibrationSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    });
    const relevantCalibration = calibrationSignal({
      topicId: context.session.topicIds[0]!,
      concept: relevantConcept,
    });
    context.scaffoldSignals = [unrelatedScaffold, relevantScaffold];
    context.topicCalibrationSignals = [unrelatedCalibration, relevantCalibration];

    const { withSessionEvidenceScope } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const scoped = withSessionEvidenceScope(context);

    expect(scoped.scaffoldSignals).toEqual([relevantScaffold]);
    expect(scoped.topicCalibrationSignals).toEqual([relevantCalibration]);
  });

  it("removes unrelated prior evidence without authorizing a third provider recovery", async () => {
    const context = bioenergeticsContext();
    context.scaffoldSignals = [scaffoldSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    })];
    context.topicCalibrationSignals = [calibrationSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    })];
    parseResponse
      .mockResolvedValueOnce(completedResponse("invalid-initial", {}))
      .mockResolvedValueOnce(completedResponse("invalid-repair", {}));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    await expect(generateProductionSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        repairSucceeded: false,
        stage: "validation",
        cause: "invalid_structure",
      },
    });

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_safe_study_recovery",
      "yova_safe_study_recovery",
    ]);
    expect(parseResponse.mock.calls.map((call) => call[0]?.input).join("\n"))
      .not.toContain("Photosynthetic electron transport");
  });

  it("keeps relevant scaffold evidence fail-closed for bounded recovery", async () => {
    const context = bioenergeticsContext();
    context.scaffoldSignals = [scaffoldSignal({
      topicId: context.session.topicIds[0]!,
      concept: context.session.contentTargets![0]!,
    })];
    parseResponse
      .mockResolvedValueOnce(completedResponse("invalid-initial", {}))
      .mockResolvedValueOnce(completedResponse("invalid-repair", {}));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    await expect(generateProductionSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        repairSucceeded: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
    ]);
  });
});

describe("bounded primary recovery for ordinary YOVA-generated study sessions", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it.each([2, 3] as const)(
    "uses the compact recovery format first and returns a route-compatible %i-target session",
    async (targetCount) => {
      const context = ordinaryYovaStudyContext(targetCount);
      parseResponse.mockResolvedValueOnce(completedResponse(
        `bounded-study-${targetCount}`,
        boundedBioenergeticsContent(targetCount),
      ));

      const { generateProductionSessionWithOpenAI } = await import(
        "@/lib/openai/session-generation-strategy"
      );
      const generated = await generateProductionSessionWithOpenAI(context);

      expect(parseResponse).toHaveBeenCalledTimes(1);
      expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
        "yova_safe_study_recovery",
      ]);
      const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
      const providerContext = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as {
        targetProvenance: Array<{
          topicId: string;
          provenance: string;
        }>;
      };
      expect(providerContext.targetProvenance).toEqual(context.session.topicIds.map((topicId) => (
        expect.objectContaining({ topicId, provenance: "model_knowledge" })
      )));
      expect(generated.generationStats).toMatchObject({
        attempts: 1,
        firstAttemptPassed: true,
        repairAttempted: false,
        recoveryMode: "safe_study",
        stage: "complete",
      });
      expect(generated.draft.topicIds).toEqual(context.session.topicIds);
      expect(generated.draft.coverage.essentialIdeas).toHaveLength(targetCount);
      await expectFullyValidatedRouteSession(generated.draft, context);
    },
  );

  it("uses the bounded primary path for the exact 45-minute route-free first-of-nine shape", async () => {
    const context = ordinaryYovaStudyContext(3);
    const activeTopic = context.knowledgeTopics[0]!;
    context.knowledgeTopics = [{
      ...activeTopic,
      title: "Cellular energy relationships",
      description: BOUNDED_TOPICS.map((topic) => topic.description).join(" "),
    }];
    context.session.topicIds = [activeTopic.id];
    context.studyRoute = null;
    context.journey = {
      currentSequence: 1,
      totalSessions: 9,
      previousSessions: [],
      nextSessions: Array.from({ length: 8 }, (_, index) => ({
        sequence: index + 2,
        title: `Later bioenergetics session ${index + 2}`,
        objective: `Continue with a distinct later bioenergetics objective ${index + 2}.`,
        contentTargets: [`Later bioenergetics target ${index + 2}`],
      })),
    };
    context.session.estimatedMinutes = 45;
    context.session.method = "Retrieval practice";
    parseResponse.mockResolvedValueOnce(completedResponse(
      "route-free-bounded-study",
      boundedBioenergeticsContent(3),
    ));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name)
      .toBe("yova_safe_study_recovery");
    expect(generated.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: true,
      repairAttempted: false,
      recoveryMode: "safe_study",
      stage: "complete",
    });
    await expectFullyValidatedRouteSession(generated.draft, context, false);
  });

  it.each([
    {
      memoryChallenge: "I understand it but cannot apply it",
      retentionMode: "transfer",
    },
    {
      memoryChallenge: "I can do it with help but not independently",
      retentionMode: "fade_support",
    },
  ] as const)(
    "keeps $memoryChallenge delivery on the full generator because the compact recipe cannot represent $retentionMode",
    async ({ memoryChallenge }) => {
      const context = ordinaryYovaStudyContext(3);
      if (!context.learnerProfile) throw new Error("Expected a learner profile fixture.");
      context.learnerProfile = {
        ...context.learnerProfile,
        memoryChallenge,
      };
      delete context.personalization;
      parseResponse
        .mockResolvedValueOnce(completedResponse("unsupported-retention-initial", {}))
        .mockResolvedValueOnce(completedResponse("unsupported-retention-repair", {}));

      const { generateProductionSessionWithOpenAI } = await import(
        "@/lib/openai/session-generation-strategy"
      );
      await expect(generateProductionSessionWithOpenAI(context)).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: { attempts: 2 },
      });

      expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
        "yova_guided_session",
        "yova_guided_session",
      ]);
    },
  );

  it("repairs one malformed compact response with one final compact call", async () => {
    const context = ordinaryYovaStudyContext(2);
    parseResponse
      .mockResolvedValueOnce(completedResponse("malformed-bounded-study", {}))
      .mockResolvedValueOnce(completedResponse(
        "repaired-bounded-study",
        boundedBioenergeticsContent(2),
      ));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_safe_study_recovery",
      "yova_safe_study_recovery",
    ]);
    expect(generated.generationStats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      failedValidator: "session_structure",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "structured_output",
      recoveryMode: "safe_study",
      validationIssueCode: "session_recovery_structure",
      stage: "complete",
    });
    await expectFullyValidatedRouteSession(generated.draft, context);
  });

  it("classifies an SDK structured-output rejection as structure before its bounded repair", async () => {
    const context = ordinaryYovaStudyContext(2);
    const sdkStructureError = Object.assign(new Error("structured output rejected"), {
      name: "ZodError",
      issues: [{
        code: "invalid_type",
        path: ["topicChecks"],
        message: "Expected a complete topic-check array.",
      }],
    });
    parseResponse
      .mockRejectedValueOnce(sdkStructureError)
      .mockResolvedValueOnce(completedResponse(
        "sdk-structure-repaired-bounded-study",
        boundedBioenergeticsContent(2),
      ));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(generated.generationStats).toMatchObject({
      attempts: 2,
      failedValidator: "session_structure",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "structured_output",
      validationIssueCode: "session_recovery_structure",
    });
  });

  it("preserves the first compact failure when the server budget ends before retry", async () => {
    const context = ordinaryYovaStudyContext(2);
    const startedAt = new Date("2026-09-01T09:46:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse.mockImplementationOnce(async () => {
      vi.setSystemTime(startedAt.getTime() + 70_000);
      return completedResponse("compact-budget-initial", {});
    });

    try {
      const { generateProductionSessionWithOpenAI } = await import(
        "@/lib/openai/session-generation-strategy"
      );
      await expect(generateProductionSessionWithOpenAI(context, {
        deadlineAt: startedAt.getTime() + 90_000,
        settlementReserveMs: 12_000,
      })).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 1,
          firstAttemptPassed: false,
          failedValidator: "session_structure",
          repairAttempted: true,
          repairSucceeded: null,
          repairReason: "structured_output",
          recoveryMode: "safe_study",
          validationIssueCode: "session_recovery_structure",
          stage: "provider",
          cause: "provider_request",
        },
      });
      expect(parseResponse).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries one transient provider failure and reports the compact provider repair truthfully", async () => {
    const context = ordinaryYovaStudyContext(2);
    parseResponse
      .mockRejectedValueOnce(Object.assign(new Error("upstream unavailable"), { status: 503 }))
      .mockResolvedValueOnce(completedResponse(
        "provider-repaired-bounded-study",
        boundedBioenergeticsContent(2),
      ));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const generated = await generateProductionSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_safe_study_recovery",
      "yova_safe_study_recovery",
    ]);
    expect(generated.generationStats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      failedValidator: "session_provider_request",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "none",
      inputTokens: 600,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 300,
      recoveryMode: "safe_study",
      stage: "complete",
    });
    await expectFullyValidatedRouteSession(generated.draft, context);
  });

  it("stops after one permanent provider failure without falling through to the full generator", async () => {
    const context = ordinaryYovaStudyContext(3);
    parseResponse.mockRejectedValueOnce(
      Object.assign(new Error("authentication rejected"), { status: 401 }),
    );

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const failure = await generateProductionSessionWithOpenAI(context)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        firstAttemptPassed: false,
        failedValidator: "session_provider_request",
        repairAttempted: false,
        repairSucceeded: null,
        repairReason: "none",
        inputTokens: 0,
        outputTokens: 0,
        recoveryMode: "safe_study",
        stage: "provider",
        cause: "provider_request",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name)
      .toBe("yova_safe_study_recovery");
  });

  it("fails closed after two invalid compact responses without entering another generator", async () => {
    const context = ordinaryYovaStudyContext(3);
    parseResponse
      .mockResolvedValueOnce(completedResponse("invalid-bounded-study-1", {}))
      .mockResolvedValueOnce(completedResponse("invalid-bounded-study-2", {}));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const failure = await generateProductionSessionWithOpenAI(context)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        firstAttemptPassed: false,
        repairAttempted: true,
        repairSucceeded: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_safe_study_recovery",
      "yova_safe_study_recovery",
    ]);
  });
});

function bioenergeticsContext() {
  const context = buildSessionEvaluationCases()
    .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
  if (!context) throw new Error("Missing bioenergetics evaluation context.");
  return structuredClone(context);
}

function scaffoldSignal({ topicId, concept }: { topicId: string; concept: string }) {
  return {
    topicId,
    concept,
    checks: 1,
    supportedChecks: 0,
    independentChecks: 1,
    secureIndependentChecks: 1,
    latestOutcome: "secure" as const,
    latestPhase: "retrieve" as const,
    status: "fade_support" as const,
    evidence: "One prior independent check was secure.",
    guidance: "Remove some earlier support and require a fresh independent check.",
  };
}

function calibrationSignal({ topicId, concept }: { topicId: string; concept: string }) {
  return {
    topicId,
    concept,
    pattern: "possible_misconception" as const,
    checkedAnswers: 1,
    highConfidenceMisses: 1,
    lowConfidenceSuccesses: 0,
    misconceptionSummary: "Oxygen is produced by splitting water, not carbon dioxide.",
    feedback: "A confident answer needs a fresh discrimination check before this concept is treated as stable.",
  };
}

function completedResponse(id: string, outputParsed: unknown) {
  return {
    id,
    model: "gpt-yova-test",
    status: "completed",
    output_parsed: outputParsed,
    usage: {
      input_tokens: 600,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 300,
    },
  };
}

const BOUNDED_TOPICS = [{
  id: "71111111-1111-4111-8111-111111111111",
  target: "How cells transfer usable energy",
  description: "Cells transfer usable energy by coupling energy-releasing reactions to energy-requiring cellular processes.",
}, {
  id: "72222222-2222-4222-8222-222222222222",
  target: "How ATP hydrolysis supports energy coupling",
  description: "ATP hydrolysis releases free energy that can make a chemically coupled cellular process favorable.",
}, {
  id: "73333333-3333-4333-8333-333333333333",
  target: "How energy coupling drives cellular work",
  description: "Energy coupling links ATP hydrolysis to specific cellular work without creating new energy.",
}] as const;

function ordinaryYovaStudyContext(targetCount: 2 | 3): SessionGenerationContext {
  const base = bioenergeticsContext();
  const selected = BOUNDED_TOPICS.slice(0, targetCount);
  const topicIds = selected.map((topic) => topic.id);
  const contentTargets = selected.map((topic) => topic.target);
  return {
    ...base,
    sessionArchitectureVersion: "filled_teaching_v1",
    learningGoal: {
      ...base.learningGoal,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "study",
    },
    materials: [],
    knowledgeTopics: selected.map((topic) => ({
      id: topic.id,
      title: topic.target,
      description: topic.description,
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
    })),
    session: {
      ...base.session,
      title: "Retrieve cellular energy relationships",
      objective: "Retrieve how cells transfer energy, use ATP hydrolysis, and couple that energy to cellular work.",
      method: "Retrieval practice",
      methodReason: "Practice first makes current knowledge visible before a concise correction.",
      estimatedMinutes: 25,
      learningMode: "study",
      topicIds,
      contentTargets,
      deferredContentTargets: [],
      completionEvidence: contentTargets.map((target) => `Explain ${target} without notes.`),
      reviewConcept: null,
      reviewType: null,
    },
    studyRoute: retrievalPracticeRoute(topicIds, targetCount),
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

function retrievalPracticeRoute(
  topicIds: string[],
  targetCount: 2 | 3,
): StudyRoute {
  return {
    identity: {
      routeLineageId: "74444444-4444-4444-8444-444444444444",
      routeRevisionId: "75555555-5555-4555-8555-555555555555",
      revisionNumber: 1,
      schemaVersion: 1,
      lifecycleStatus: "committed",
      planId: "76666666-6666-4666-8666-666666666666",
      sessionId: "77777777-7777-4777-8777-777777777777",
      createdAt: "2026-09-01T08:00:00.000Z",
      committedAt: "2026-09-01T08:01:00.000Z",
    },
    target: {
      taskFamily: "conceptual_learning",
      desiredOutcome: "Retrieve each cellular-energy relationship independently and repair any exposed gap.",
      targetStates: topicIds.map((targetId) => ({
        targetId,
        stage: "retrieval_ready" as const,
        uncertainty: "medium" as const,
        evidenceRefs: [],
      })),
      sourceRequirements: {
        sourceType: "yova_generated",
        requiredSourceIds: [],
        groundingRequired: false,
        instructions: [],
      },
    },
    approach: {
      mode: "practice",
      executionEnvironment: "inside_yova",
      primaryMethodId: "retrieval_practice",
      visibleMethodName: "Retrieval practice",
      confidenceLevel: "high",
    },
    timing: {
      activeMinutes: 25,
      elapsedMinutes: 25,
      durationSource: "router_default",
      hardMaximumMinutes: 30,
    },
    execution: {
      orderedPhases: [{
        phaseId: "retrieve",
        methodPhase: "retrieve",
        activeMinutes: 18,
        targetIds: topicIds,
      }, {
        phaseId: "repair",
        methodPhase: "repair",
        activeMinutes: 7,
        targetIds: topicIds,
      }],
      difficultyTier: "standard",
      initialSupport: "independent_start",
      activityLimit: targetCount + 1,
      completionEvidence: [{
        evidenceId: "bounded-retrieval",
        targetIds: topicIds,
        kind: "explanation",
        description: "Explain each target from memory, then compare the attempt with the correction.",
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
      shortReason: "The committed practice-first route needs unsupported retrieval before targeted repair.",
      taskRequirements: ["Retrieve the mapped relationships before reviewing the answer."],
      learnerDeclarations: [],
      observations: [],
      uncertainties: [],
    },
    provenance: {
      routerVersion: "bounded-study-regression-v1",
      profileVersion: "profile-v1",
      evidenceRefs: [],
      ruleTrace: [{
        ruleId: "practice-first-retrieval",
        result: "selected",
        reason: "The mapped targets are ready for an unsupported retrieval check.",
        evidenceRefs: [],
      }],
    },
  };
}

function boundedBioenergeticsContent(targetCount: 2 | 3) {
  const claims = BOUNDED_TOPICS.map((topic) => topic.description);
  const checks = [{
    title: "Explain usable energy transfer",
    prompt: "Without notes, explain how cells transfer usable energy into an energy-requiring cellular process.",
    choices: [
      "Cells couple an energy-releasing reaction to the work",
      "Cells create new energy whenever work is required",
      "Cells use only heat released by a reaction",
      "Cells permanently store all usable energy in glucose",
    ],
    correctChoiceIndex: 0,
    referenceAnswer: claims[0],
    feedback: "A complete explanation connects a favorable energy-releasing reaction to the specific cellular process it drives.",
  }, {
    title: "Check ATP hydrolysis",
    prompt: "Without notes, explain how ATP hydrolysis can support energy coupling in a cellular process.",
    choices: [
      "Its free-energy release can make a coupled process favorable",
      "It raises activation energy until the process begins",
      "It stores heat that directly becomes cellular work",
      "It creates energy that did not previously exist",
    ],
    correctChoiceIndex: 0,
    referenceAnswer: claims[1],
    feedback: "ATP hydrolysis supplies a favorable free-energy change to the combined coupled process; it does not create energy.",
  }, {
    title: "Connect coupling to cellular work",
    prompt: "Without notes, explain how energy coupling links ATP hydrolysis to one specific form of cellular work.",
    choices: [
      "Coupling links ATP hydrolysis to a specific energy-requiring process",
      "Coupling turns all released energy into stored heat",
      "Coupling lets a cell perform work without any energy change",
      "Coupling creates an unlimited supply of cellular energy",
    ],
    correctChoiceIndex: 0,
    referenceAnswer: claims[2],
    feedback: "The coupled reactions share a mechanism so ATP hydrolysis can drive specific work without creating new energy.",
  }];
  return {
    targetClaims: claims.slice(0, targetCount),
    topicChecks: checks.slice(0, targetCount),
    independentExtension: null,
    subjectModel: {
      keyIdea: "Cells transfer usable energy through coupled reactions, often using ATP hydrolysis.",
      explanation: "An energy-releasing reaction can be linked to an energy-requiring cellular process. ATP hydrolysis provides a favorable free-energy change, and coupling connects that change to specific cellular work without creating new energy.",
      commonMistake: "ATP hydrolysis creates new energy for the cell.",
      correction: "ATP hydrolysis releases usable free energy, while coupling transfers it to a specific process.",
    },
    modelExample: null,
  };
}

async function expectFullyValidatedRouteSession(
  draft: GeneratedSessionDraft,
  context: SessionGenerationContext,
  checkCommittedRoute = true,
) {
  const { buildLearningScienceRoutingBrief } = await import("@/lib/learning/method-router");
  const { sessionRoutingInput } = await import("@/lib/learning/session-routing-input");
  const {
    applyPersonalizedMethodTieToRouting,
    personalizationDecisions,
  } = await import("@/lib/personalization/personalization-generation");
  const { buildSessionDeliveryPolicy } = await import(
    "@/lib/personalization/session-delivery-policy"
  );
  const { validateGeneratedSessionWithCode } = await import("@/lib/openai/session-generator");
  const routing = applyPersonalizedMethodTieToRouting(
    buildLearningScienceRoutingBrief(sessionRoutingInput(context)),
    context.personalization,
    context.studyRoute?.approach.primaryMethodId,
  );
  const deliveryPolicy = buildSessionDeliveryPolicy({
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    recentInterruptions: context.recentInterruptions,
    learningMode: context.session.learningMode,
    estimatedMinutes: context.session.estimatedMinutes,
    personalizationDecisions: personalizationDecisions(context.personalization, routing),
  });

  expect(routing.suggestedPrimaryMethodId).toBe("retrieval_practice");
  expect(validateGeneratedSessionWithCode(
    draft,
    context,
    routing,
    [],
    [],
    [],
    deliveryPolicy,
    draft.coverage.essentialIdeas.map((essentialIdea, index) => ({
      essentialIdea,
      target: context.session.contentTargets![index]!,
    })),
  )).toBeNull();
  if (checkCommittedRoute) {
    expect(generatedSessionStudyRouteIssue(draft, context.studyRoute, {
      plannedTopicIds: context.session.topicIds,
      plannedContentTargets: context.session.contentTargets!,
      knowledgeTopics: context.knowledgeTopics,
    })).toBeNull();
  }
}

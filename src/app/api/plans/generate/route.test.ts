import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalPlanEnvelopeComposition } from "@/lib/plan-generation/normal-plan-envelopes";
import {
  buildNormalPlanFallbackFill,
  type NormalPlanProviderFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  PlanGenerationRequestSchema,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import type { AuthorizedNormalDurationProfile } from "@/lib/study-route/duration-signals";
import {
  METHOD_DECISION_EVIDENCE_ADAPTER_VERSION,
  buildAuthorizedMethodDecisionEvidence,
} from "@/lib/study-route/method-decision-evidence";
import { studyRouteProvenanceIncludesRouterComponent } from "@/lib/study-route/method-plan-integration";

const mocks = vi.hoisted(() => ({
  generatePlan: vi.fn(),
  generateLegacyPlan: vi.fn(),
  generateKnowledgeMap: vi.fn(),
  generateDiagnostic: vi.fn(),
  recordObservation: vi.fn(),
  rateLimit: vi.fn(),
  developmentPreview: true,
  supabaseConfigured: false,
  createClient: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
  loadDurationContext: vi.fn(),
  openAIConfigured: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/plan-generator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/openai/plan-generator")>();
  return { ...original, generatePlanWithOpenAI: mocks.generateLegacyPlan };
});
vi.mock("@/lib/openai/normal-plan-fill-generator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/openai/normal-plan-fill-generator")>();
  return { ...original, generateNormalPlanFillWithOpenAI: mocks.generatePlan };
});
vi.mock("@/lib/knowledge-map/generate-plan-map", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/knowledge-map/generate-plan-map")>();
  return { ...original, generatePlanKnowledgeMap: mocks.generateKnowledgeMap };
});
vi.mock("@/lib/diagnostics/map-diagnostic", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/diagnostics/map-diagnostic")>();
  return { ...original, generateMapDiagnostic: mocks.generateDiagnostic };
});
vi.mock("@/lib/openai/config", () => ({
  isOpenAIPlanConfigured: () => mocks.openAIConfigured,
}));
vi.mock("@/lib/analytics/generation-observation-server", () => ({
  recordGenerationObservation: mocks.recordObservation,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkPlanGenerationRateLimit: mocks.rateLimit,
  requestRateLimitKey: () => "plan-route-test",
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => mocks.developmentPreview,
}));
vi.mock("@/lib/server/ai-usage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/server/ai-usage")>();
  return {
    ...original,
    reserveAIRequest: mocks.reserve,
    releaseAIRequestClaim: mocks.release,
    releaseAIRequestReservation: mocks.releaseOperation,
    settleAIRequestClaim: mocks.settle,
  };
});
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.supabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/study-route/duration-context-server", () => ({
  loadAuthorizedNormalDurationContext: mocks.loadDurationContext,
}));

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const STUDY_NOW_TOPIC_IDS = [
  TOPIC_ID,
  "11111111-1111-4111-8111-111111111112",
  "11111111-1111-4111-8111-111111111113",
  "11111111-1111-4111-8111-111111111114",
] as const;
const planRequest = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Learn derivative basics and apply the product rule accurately on a calculus unit test.",
  startingContext: "I need the concepts taught from the beginning.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "UTC",
  diagnosticResponses: [],
  availability: [
    { day: "Every day", window: "Evening", minutes: 25 },
  ],
  profileSummary: "Use concise explanations and a worked example before independent practice.",
  knowledgeMap: {
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Focused skill",
      minimumSessions: 2,
      recommendedSessions: 3,
      maximumSessions: 4,
      minimumTeachingSessions: 1,
      explanation: "A bounded calculus skill fits a short sequence.",
    },
    topics: [{
      id: TOPIC_ID,
      title: "Product rule",
      description: "Differentiate products of two functions accurately.",
      subtopics: [],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    placementCheck: {
      status: "skipped",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  },
});

describe("plan generation route", () => {
  beforeEach(() => {
    vi.stubEnv(
      "YOVA_DRAFT_RECEIPT_SECRET",
      "plan-generation-route-secret-0123456789-abcdef",
    );
    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "100");
    mocks.developmentPreview = true;
    mocks.supabaseConfigured = false;
    mocks.openAIConfigured = true;
    mocks.generatePlan.mockReset().mockImplementation(async ({ request, composition }) => (
      generatedNormalPlanFillResult(request, composition)
    ));
    mocks.generateLegacyPlan.mockReset();
    mocks.generateKnowledgeMap.mockReset();
    mocks.generateDiagnostic.mockReset();
    mocks.recordObservation.mockReset().mockResolvedValue(undefined);
    mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.createClient.mockReset();
    mocks.reserve.mockReset().mockResolvedValue({
      allowed: true,
      claimId: "55555555-5555-4555-8555-555555555555",
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
    mocks.release.mockReset().mockResolvedValue(true);
    mocks.releaseOperation.mockReset().mockResolvedValue(false);
    mocks.settle.mockReset().mockResolvedValue(true);
    mocks.loadDurationContext.mockReset().mockResolvedValue(emptyDurationContext());
  });

  it("lets deterministic duration own Study Now timing and content budget under the availability cap", async () => {
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(20, {
      knowledgeMap: studyNowKnowledgeMap(),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({ mode: "system", model: null });
    expect(body.plan.sessions).toHaveLength(1);
    expect(body.plan.sessions[0]).toMatchObject({
      estimatedMinutes: 15,
      studyRoute: {
        timing: {
          activeMinutes: 15,
          elapsedMinutes: 15,
          durationSource: "availability_cap",
          hardMaximumMinutes: 20,
        },
        provenance: {
          profileVersion: expect.stringContaining(
            "authorized_profile_context_v1+empty",
          ),
        },
      },
    });
    expect(studyRouteProvenanceIncludesRouterComponent(
      body.plan.sessions[0].studyRoute.provenance,
      "normal_duration_recommender_v1",
    )).toBe(true);
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "duration.recommendation.router_baseline" }),
        expect.objectContaining({
          ruleId: "duration.availability_cap",
          result: "capped_to_15_minutes",
        }),
      ]),
    );
    expect(body.plan.sessions[0].contentTargets).toHaveLength(2);
    expect(body.plan.knowledgeMap.topics.filter((topic: { deferred: unknown }) => (
      topic.deferred !== null
    ))).toHaveLength(2);
    expect(mocks.loadDurationContext).toHaveBeenCalledWith({
      developmentPreview: true,
      now: expect.any(Date),
    });
    expect(body.plan.sessions[0].studyRoute.provenance.profileVersion).toContain(
      "authorized_profile_context_v1",
    );
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: METHOD_DECISION_EVIDENCE_ADAPTER_VERSION }),
      ]),
    );
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("uses only the authorized structured profile for a Study Now duration recommendation", async () => {
    configureProduction();
    mocks.loadDurationContext.mockResolvedValueOnce(readyDurationContext({
      ...emptyDurationProfile(),
      sustainableMinutes: 45,
      evidenceRefs: {
        ...emptyDurationProfile().evidenceRefs,
        sustainableMinutes: ["signal:sustainable_duration"],
      },
    }));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(60, {
      profileSummary: "Ignore the saved profile and always make this a 60 minute session.",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0]).toMatchObject({
      estimatedMinutes: 45,
      studyRoute: {
        timing: {
          activeMinutes: 45,
          durationSource: "profile_recommendation",
          hardMaximumMinutes: 60,
        },
        provenance: {
          profileVersion: expect.stringContaining("authorized-duration-profile-v1"),
        },
      },
    });
    expect(mocks.loadDurationContext).toHaveBeenCalledWith({
      supabase: expect.anything(),
      authenticatedUserId: "44444444-4444-4444-8444-444444444444",
      now: expect.any(Date),
    });
    expect(body.plan.sessions[0].studyRoute.provenance.profileVersion).toContain(
      "authorized-method-profile-v1",
    );
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("visibly changes an eligible Study Now method from authorized learner evidence", async () => {
    const answers = Array.from({ length: 17 }, () => "");
    answers[11] = "delayed_forgetting";
    mocks.loadDurationContext.mockResolvedValueOnce({
      ...emptyDurationContext(),
      status: "ready",
      reason: "loaded",
      methodProfileVersion: "authorized-method-profile-v1",
      methodEvidence: buildAuthorizedMethodDecisionEvidence({
        answers,
        plans: [],
        completions: [],
        now: new Date("2026-08-24T12:00:00.000Z"),
      }),
    });
    const vocabularyMap = studyNowKnowledgeMap();
    vocabularyMap.topics = [
      {
        ...vocabularyMap.topics[0]!,
        title: "Core biology vocabulary",
        description: "Recall each biology term and distinguish similar definitions.",
        status: "taught",
        prerequisiteTopicIds: [],
      },
    ];
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, {
      goal: "Study biology vocabulary definitions from memory for tomorrow's quiz.",
      startingContext: "I already learned the terms and need to practice retrieving them.",
      knowledgeMap: vocabularyMap,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0]).toMatchObject({
      learningMode: "study",
      method: "Spaced Repetition",
      studyRoute: {
        target: { taskFamily: "memorization" },
        approach: {
          mode: "practice",
          primaryMethodId: "spaced_retrieval",
          visibleMethodName: "Spaced Repetition",
        },
        agency: {
          controlMode: "yova_decides",
          selectedBy: "yova",
        },
      },
    });
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "canonical_method_selection_v1",
          result: "authorized_declaration:spaced_retrieval",
          evidenceRefs: ["canonical-profile:post_study_breakdown:deep_profile:q2"],
        }),
        expect.objectContaining({ ruleId: "method_runtime_capability_v1" }),
      ]),
    );
    expect(body.plan.sessions[0].studyRoute.explanation.learnerDeclarations[0])
      .toContain("gap you most often notice after studying");
  });

  it("routes a local-preview Study Now session from request-local Method Library preferences", async () => {
    const vocabularyMap = studyNowKnowledgeMap();
    vocabularyMap.topics = [{
      ...vocabularyMap.topics[0]!,
      title: "Core biology vocabulary",
      description: "Recall each biology term and distinguish similar definitions.",
      status: "taught",
      prerequisiteTopicIds: [],
    }];
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, {
      goal: "Study biology vocabulary definitions from memory for tomorrow's quiz.",
      startingContext: "I already learned the terms and need to practice retrieving them.",
      knowledgeMap: vocabularyMap,
      previewPreferredMethodIds: ["spaced_retrieval"],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Spaced Repetition",
      studyRoute: {
        approach: { primaryMethodId: "spaced_retrieval" },
        provenance: {
          evidenceRefs: ["profile-method-preference:spaced_retrieval"],
          ruleTrace: expect.arrayContaining([
            expect.objectContaining({
              ruleId: "canonical_method_selection_v1",
              result: "authorized_declaration:spaced_retrieval",
            }),
          ]),
        },
      },
    });
  });

  it("uses structured canonical agency only for a local-preview route", async () => {
    const { POST } = await import("@/app/api/plans/generate/route");
    const previewCanonicalProfile = createCanonicalLearnerProfile([{
      signalId: "control_mode",
      value: "help_me_choose",
      source: "canonical_questionnaire",
      sourceQuestionId: "profile_control_mode",
      provenance: "direct_answer",
    }]);

    const response = await POST(studyNowGenerationRequest(25, {
      knowledgeMap: studyNowKnowledgeMap(),
      previewCanonicalProfile,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0].studyRoute).toMatchObject({
      agency: {
        controlMode: "help_me_choose",
        selectedBy: "yova",
      },
      provenance: {
        ruleTrace: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "study_route_agency_mode_controller_v1",
            result: expect.stringMatching(/^help_me_choose:canonical_profile:/u),
          }),
        ]),
      },
    });
  });

  it("keeps explicit canonical agency while rollout zero suppresses method and duration personalization", async () => {
    configureProduction();
    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "0");
    const answers = Array.from({ length: 17 }, () => "");
    answers[1] = "structured_flexibility";
    answers[11] = "delayed_forgetting";
    mocks.loadDurationContext.mockResolvedValueOnce({
      ...readyDurationContext({
        ...emptyDurationProfile(),
        sustainableMinutes: 45,
        evidenceRefs: {
          ...emptyDurationProfile().evidenceRefs,
          sustainableMinutes: ["signal:sustainable_duration"],
        },
      }),
      methodEvidence: buildAuthorizedMethodDecisionEvidence({
        answers,
        plans: [],
        completions: [],
        now: new Date("2026-08-24T12:00:00.000Z"),
      }),
    });
    const vocabularyMap = studyNowKnowledgeMap();
    vocabularyMap.topics = [{
      ...vocabularyMap.topics[0]!,
      title: "Core biology vocabulary",
      description: "Recall each biology term and distinguish similar definitions.",
      status: "taught",
      prerequisiteTopicIds: [],
    }];
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(60, {
      goal: "Study biology vocabulary definitions from memory for tomorrow's quiz.",
      startingContext: "I already learned the terms and need to practice retrieving them.",
      knowledgeMap: vocabularyMap,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0].studyRoute).toMatchObject({
      timing: {
        activeMinutes: 25,
        durationSource: "router_default",
        hardMaximumMinutes: 60,
      },
      agency: {
        controlMode: "help_me_choose",
        selectedBy: "yova",
      },
      provenance: {
        ruleTrace: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "canonical_method_selection_v1",
            result: expect.stringMatching(/^task_baseline:/u),
          }),
          expect.objectContaining({
            ruleId: "study_route_agency_mode_controller_v1",
            result: expect.stringMatching(/^help_me_choose:canonical_profile:/u),
          }),
          expect.objectContaining({
            ruleId: "personalization_rollout_v1",
            result: "task_mastery_v1",
          }),
        ]),
      },
    });
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "duration.recommendation.sustainable_baseline",
        }),
      ]),
    );
  });

  it("keeps ordinary-plan duration routing on the task baseline at rollout zero", async () => {
    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "0");
    mocks.openAIConfigured = false;
    mocks.loadDurationContext.mockResolvedValueOnce(readyDurationContext({
      ...emptyDurationProfile(),
      sustainableMinutes: 45,
      evidenceRefs: {
        ...emptyDurationProfile().evidenceRefs,
        sustainableMinutes: ["signal:sustainable_duration"],
      },
    }));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      availability: [{ day: "Every day", window: "Evening", minutes: 60 }],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0].studyRoute.timing).toMatchObject({
      activeMinutes: 25,
      durationSource: "router_default",
      hardMaximumMinutes: 60,
    });
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "duration.recommendation.sustainable_baseline",
        }),
      ]),
    );
  });

  it("accepts one explicit eligible learner method choice and records learner authority", async () => {
    const vocabularyMap = studyNowKnowledgeMap();
    vocabularyMap.topics = [{
      ...vocabularyMap.topics[0]!,
      title: "Core biology vocabulary",
      description: "Recall each biology term and distinguish similar definitions.",
      status: "taught",
      prerequisiteTopicIds: [],
    }];
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, {
      goal: "Study biology vocabulary definitions from memory for tomorrow's quiz.",
      startingContext: "I already learned the terms and need to practice retrieving them.",
      knowledgeMap: vocabularyMap,
      methodChoice: { methodId: "spaced_retrieval" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Spaced Repetition",
      studyRoute: {
        approach: { primaryMethodId: "spaced_retrieval" },
        agency: {
          controlMode: "learner_customizes",
          selectedBy: "learner",
        },
        explanation: {
          shortReason: expect.stringMatching(/^You chose Spaced Repetition/),
        },
      },
    });
    expect(body.plan.sessions[0].studyRoute.provenance.ruleTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "canonical_method_selection_v1",
          result: "learner_choice:spaced_retrieval",
          evidenceRefs: ["learner-choice:study-now:spaced_retrieval"],
        }),
      ]),
    );
  });

  it("rejects a learner method choice outside the computed eligible set", async () => {
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, {
      knowledgeMap: studyNowKnowledgeMap(),
      methodChoice: { methodId: "scaffolded_coding" },
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "method_choice_ineligible",
    });
  });

  it("applies repeated comparable outcomes through the production Study Now route", async () => {
    configureProduction();
    mocks.loadDurationContext.mockResolvedValueOnce(readyDurationContext(
      emptyDurationProfile(),
      [
        comparableInterruption(0),
        comparableInterruption(1),
      ],
    ));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(60));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0].studyRoute).toMatchObject({
      timing: {
        activeMinutes: 15,
        durationSource: "observed_outcome_adjustment",
        hardMaximumMinutes: 60,
      },
      provenance: {
        ruleTrace: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "duration.recommendation.repeated_early_exits",
            result: "lowered_to_15_minutes",
          }),
        ]),
      },
    });
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        diagnostics: expect.objectContaining({
          durationContextStatus: "ready",
          durationContextReason: "loaded",
          durationSource: "observed_outcome_adjustment",
          durationActiveMinutes: 15,
          durationHardMaximumMinutes: 60,
          durationTaskFamily: "problem_solving",
          durationMode: "practice",
          methodAuthority: expect.any(String),
          methodId: expect.any(String),
        }),
      }),
    );
  });

  it("degrades safely to the deterministic baseline when profile or history loading fails", async () => {
    configureProduction();
    mocks.loadDurationContext.mockResolvedValueOnce({
      ...emptyDurationContext(),
      status: "degraded",
      reason: "history_read_failed",
      profileVersion: "authorized_profile_context_v1+degraded",
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(60));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0].estimatedMinutes).toBe(25);
    expect(body.plan.sessions[0].studyRoute.timing).toMatchObject({
      activeMinutes: 25,
      durationSource: "router_default",
      hardMaximumMinutes: 60,
    });
  });

  it("rejects less than ten available minutes before material, mapping, or metering work", async () => {
    configureProduction();
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(5, { knowledgeMap: undefined }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "insufficient_normal_session_time",
      minimumMinutes: 10,
      availableMinutes: 5,
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.loadDurationContext).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("settles one metered Study Now mapping only after the routed duration response validates", async () => {
    configureProduction();
    mocks.generateKnowledgeMap.mockResolvedValueOnce(generatedKnowledgeMap());
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, { knowledgeMap: undefined }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generation: { mode: "system" },
      plan: {
        sessions: [{
          estimatedMinutes: 25,
          studyRoute: { timing: { activeMinutes: 25 } },
        }],
      },
    });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateKnowledgeMap.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("returns a truthful retryable fallback and records only bounded diagnostics", async () => {
    const { OpenAINormalPlanFillError } = await import("@/lib/openai/normal-plan-fill-generator");
    const cause = Object.assign(new Error("private provider response"), {
      name: "APIConnectionTimeoutError",
      status: 408,
      code: "REQUEST_TIMEOUT",
    });
    mocks.generatePlan.mockRejectedValueOnce(new OpenAINormalPlanFillError(
      "The OpenAI request failed.",
      "provider_error",
      {
        elapsedMs: 40_000,
        attempts: 1,
        firstAttemptPassed: false,
        failedValidator: "plan_provider_request",
        repairAttempted: false,
        repairSucceeded: null,
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        model: "gpt-yova-test",
        validationIssueCode: null,
      },
      { category: "timeout", status: 408, code: "request_timeout" },
      cause,
    ));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planRequest),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "system",
      model: null,
      notice: LIVE_AI_PLAN_FALLBACK_NOTICE,
    });
    expect(body.generation.notice).toMatch(/^Live AI planning failed/);
    expect(body.plan.sessions.length).toBeGreaterThan(0);
    for (const session of body.plan.sessions) {
      expect(session.studyRoute).toMatchObject({
        identity: { lifecycleStatus: "provisional" },
        approach: { visibleMethodName: session.method },
        agency: { controlMode: "yova_decides", selectedBy: "yova" },
        provenance: {
          profileVersion: expect.stringContaining("authorized_profile_context_v1+empty"),
          ruleTrace: expect.arrayContaining([
            expect.objectContaining({ ruleId: "initial_plan_method_routing_v1" }),
            expect.objectContaining({ ruleId: "canonical_method_selection_v1" }),
          ]),
        },
      });
    }
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(null, undefined, expect.objectContaining({
      finalOutcome: "fallback",
      model: "gpt-yova-test",
      diagnostics: expect.objectContaining({
        planFailureReason: "provider_error",
        providerCategory: "timeout",
        providerStatus: 408,
        providerCode: "request_timeout",
        methodContextStatus: "empty",
        methodContextReason: "development_preview",
      }),
    }));
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain("private provider response");
    expect(mocks.loadDurationContext).toHaveBeenCalledWith({
      developmentPreview: true,
      now: expect.any(Date),
    });
    errorLog.mockRestore();
  });

  it("replaces normal-plan provider method prose with the eligible canonical route", async () => {
    configureProduction();
    mocks.loadDurationContext.mockResolvedValueOnce(methodPersonalizedContext());
    mocks.generatePlan.mockImplementationOnce(async ({ request, composition }) => (
      generatedNormalPlanFillResult(request, composition, (fill) => {
      for (const session of Object.values(fill.sessions)) {
        session.title = "Use the Feynman technique for this target";
        session.objective = "Apply a provider-named technique while explaining the target accurately.";
        session.evidence = Object.fromEntries(Object.keys(session.evidence).map((slotId) => [
          slotId,
          "Give one accurate independent explanation of the target.",
        ]));
      }
      })
    ));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "openai",
      draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
    });
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Practice Problems",
      studyRoute: {
        target: { taskFamily: "problem_solving" },
        approach: {
          mode: "practice",
          primaryMethodId: "practice_problems",
          visibleMethodName: "Practice Problems",
        },
        explanation: {
          shortReason: expect.stringContaining("stable evidence-constrained baseline"),
          learnerDeclarations: [],
        },
        provenance: {
          evidenceRefs: [],
          ruleTrace: expect.arrayContaining([
            expect.objectContaining({
              ruleId: "canonical_method_selection_v1",
              result: "task_baseline:practice_problems",
            }),
          ]),
        },
      },
    });
    expect(body.plan.sessions[0].method).toBe("Practice Problems");
    expect(JSON.stringify(body.plan)).not.toMatch(/provider-named technique/iu);
    expect(mocks.loadDurationContext).toHaveBeenCalledWith({
      supabase: expect.anything(),
      authenticatedUserId: "44444444-4444-4444-8444-444444444444",
      now: expect.any(Date),
    });
  });

  it("routes normal local-preview composition from request-local Method Library preferences", async () => {
    const { POST } = await import("@/app/api/plans/generate/route");
    const conceptualMap = structuredClone(planRequest.knowledgeMap!);
    conceptualMap.topics = [{
      ...conceptualMap.topics[0]!,
      title: "Collision theory",
      description: "Explain why higher temperature changes reaction rate at the particle level.",
    }];

    const response = await POST(planGenerationRequest({
      goal: "Understand why increasing temperature speeds up a chemical reaction at the particle level.",
      startingContext: "I have not learned collision theory yet and need it explained from the beginning.",
      knowledgeMap: conceptualMap,
      previewPreferredMethodIds: ["self_explanation"],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Feynman Technique",
      studyRoute: {
        approach: { primaryMethodId: "self_explanation" },
        provenance: {
          evidenceRefs: expect.arrayContaining([
            "profile-method-preference:self_explanation",
          ]),
          ruleTrace: expect.arrayContaining([
            expect.objectContaining({
              ruleId: "canonical_method_selection_v1",
              result: "authorized_declaration:self_explanation",
            }),
          ]),
        },
      },
    });
  });

  it("keeps one fixed structure for live copy and fallback copy and never calls the legacy generator", async () => {
    mocks.generatePlan.mockImplementationOnce(async ({ request, composition }) => (
      generatedNormalPlanFillResult(request, composition, (fill) => {
        fill.plan.title = "Provider copy claiming a 90 minute learn-only blurting plan";
        fill.plan.topic = "Calculus derivatives plus an unrelated provider-labelled target";
        fill.plan.rationale = "These words can make a recommendation, but they cannot change code-owned structure.";
        for (const session of Object.values(fill.sessions)) {
          session.title = "Solve product-rule problems for 90 minutes with blurting";
          session.objective = "Learn-only: solve calculus derivative product-rule problems for a provider-labelled target.";
        }
      })
    ));
    const { POST } = await import("@/app/api/plans/generate/route");

    const liveResponse = await POST(planGenerationRequest());
    const liveBody = await liveResponse.json();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.generatePlan.mockRejectedValueOnce(new Error("provider unavailable"));
    const fallbackResponse = await POST(planGenerationRequest());
    const fallbackBody = await fallbackResponse.json();
    errorLog.mockRestore();

    expect(liveResponse.status).toBe(200);
    expect(fallbackResponse.status).toBe(200);
    expect(liveBody.generation.mode).toBe("openai");
    expect(fallbackBody.generation.mode).toBe("system");
    expect(normalPlanAuthoritySnapshot(liveBody.plan)).toEqual(
      normalPlanAuthoritySnapshot(fallbackBody.plan),
    );
    expect(JSON.stringify(liveBody.plan)).not.toContain("90 minute learn-only blurting");
    expect(liveBody.plan.sessions[0].estimatedMinutes).not.toBe(90);
    expect(liveBody.plan.sessions[0].learningMode).toBe("study");
    expect(liveBody.plan.sessions[0].topicIds).toEqual([TOPIC_ID]);
    expect(liveBody.plan.sessions[0].method).not.toBe("Blurting");
    expect(mocks.generatePlan).toHaveBeenCalledTimes(2);
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
    for (const call of mocks.generatePlan.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ deadlineAt: expect.any(Number) }));
    }
  });

  it("uses the same fully routed fixed-envelope pipeline when OpenAI is not configured", async () => {
    configureProduction();
    mocks.openAIConfigured = false;
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "preview",
      model: null,
      draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
    });
    expect(body.plan.sessions.length).toBeGreaterThanOrEqual(2);
    for (const session of body.plan.sessions) {
      expect(session.studyRoute).toMatchObject({
        identity: { lifecycleStatus: "provisional" },
        target: { targetStates: expect.any(Array) },
        approach: {
          mode: session.learningMode === "learn" ? "learn" : "practice",
          primaryMethodId: expect.any(String),
          visibleMethodName: session.method,
        },
        timing: {
          activeMinutes: session.estimatedMinutes,
          hardMaximumMinutes: expect.any(Number),
        },
        provenance: {
          ruleTrace: expect.arrayContaining([
            expect.objectContaining({ ruleId: "normal_plan_envelope_composer_v1" }),
            expect.objectContaining({ ruleId: "canonical_method_selection_v1" }),
          ]),
        },
      });
      expect(studyRouteProvenanceIncludesRouterComponent(
        session.studyRoute.provenance,
        "normal_plan_envelope_route_integration_v1",
      )).toBe(true);
    }
    expect(JSON.stringify(body.plan)).not.toContain("Pending code-owned method");
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
  });

  it("builds a preview map without letting the legacy seed scheduler reject a composable deadline", async () => {
    mocks.openAIConfigured = false;
    const now = new Date();
    const weekday = (daysFromNow: number) => new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1_000));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      knowledgeMap: undefined,
      timeZone: "UTC",
      deadline: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1_000).toISOString(),
      availability: [1, 2, 3].map((daysFromNow) => ({
        day: weekday(daysFromNow),
        window: "Afternoon",
        minutes: 45,
      })),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation.mode).toBe("preview");
    expect(body.plan.sessions.length).toBeGreaterThanOrEqual(2);
    expect(body.plan.sessions.every((session: { studyRoute?: unknown }) => (
      session.studyRoute !== undefined
    ))).toBe(true);
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
  });

  it("fails deterministic composition before starting the prose provider", async () => {
    const unavailableDay = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      availability: [{ day: unavailableDay, window: "Evening", minutes: 25 }],
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "schedule_capacity" });
    expect(mocks.loadDurationContext).toHaveBeenCalledTimes(1);
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
  });

  it("releases a production reservation when plan generation falls back", async () => {
    configureProduction();
    mocks.generatePlan.mockRejectedValueOnce(new Error("provider unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      generation: {
        mode: "system",
        draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
      },
    });
    expect(body.plan.sessions[0]).toMatchObject({
      studyRoute: {
        approach: { primaryMethodId: expect.any(String) },
      },
    });
    expect(mocks.release).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.generatePlan).toHaveBeenCalledTimes(1);
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("returns a validated plan when settlement cannot be confirmed", async () => {
    configureProduction();
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ generation: { mode: "openai" } });
    expect(mocks.release).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("reserves before a placement check and settles only its validated response", async () => {
    configureProduction();
    mocks.generateDiagnostic.mockResolvedValueOnce(generatedDiagnostic());
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      questions: [{ topicId: TOPIC_ID }],
      generation: { mode: "openai" },
    });
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      expect.any(String),
      expect.any(String),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateDiagnostic.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.loadDurationContext).not.toHaveBeenCalled();
  });

  it("releases the reservation when a placement check cannot produce a usable response", async () => {
    configureProduction();
    mocks.generateDiagnostic.mockResolvedValueOnce({
      ...generatedDiagnostic(),
      questions: [],
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(503);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("reserves before mapping and settles a conservative fallback plan when live mapping fails", async () => {
    configureProduction();
    const { KnowledgeMapGenerationError } = await import("@/lib/knowledge-map/generate-plan-map");
    mocks.generateKnowledgeMap.mockRejectedValueOnce(new KnowledgeMapGenerationError(
      "knowledge_map_structure",
      {
        attempts: 2,
        inputTokens: 420,
        cachedInputTokens: 120,
        cacheWriteTokens: 0,
        outputTokens: 96,
        firstAttemptPassed: false,
        failedValidator: "knowledge_map_structure",
      },
      "gpt-yova-map-test",
    ));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({ knowledgeMap: undefined }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generation: {
        mode: "openai",
        notice: expect.stringContaining("conservative deterministic map"),
      },
      plan: {
        knowledgeMap: {
          scopeJudgment: { label: "Unclassified learning plan" },
          topics: expect.arrayContaining([
            expect.objectContaining({ origin: "ai_generated" }),
          ]),
        },
      },
    });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateKnowledgeMap.mock.invocationCallOrder[0],
    );
    expect(mocks.release).not.toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.generatePlan).toHaveBeenCalledTimes(1);
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(),
      "55555555-5555-4555-8555-555555555555",
    );
    expect(mocks.recordObservation).toHaveBeenCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        generationType: "knowledge_map",
        finalOutcome: "fallback",
        failedValidator: "knowledge_map_structure",
        attempts: 2,
        repairAttempted: true,
        repairSucceeded: false,
        inputTokens: 420,
        cachedInputTokens: 120,
        outputTokens: 96,
        model: "gpt-yova-map-test",
      }),
    );
  });

  it("does not start a placement check when the in-memory rate limit is exhausted", async () => {
    configureProduction();
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
  });

  it("keeps an accepted-map normal plan on the fixed-envelope fallback when the in-memory limit is exhausted", async () => {
    configureProduction();
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "system",
      model: null,
      notice: expect.stringMatching(/^Live AI planning is temporarily busy/),
      draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
    });
    expectFullyRoutedNormalFallback(body.plan);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ finalOutcome: "fallback", attempts: 0 }),
    );
  });

  it("keeps local-preview Method Library routing in the reliable no-map fallback", async () => {
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      knowledgeMap: undefined,
      goal: "Understand why increasing temperature speeds up a chemical reaction at the particle level.",
      startingContext: "I have not learned collision theory yet and need it explained from the beginning.",
      previewPreferredMethodIds: ["self_explanation"],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({ mode: "system" });
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Feynman Technique",
      studyRoute: {
        approach: { primaryMethodId: "self_explanation" },
        provenance: {
          evidenceRefs: expect.arrayContaining([
            "profile-method-preference:self_explanation",
          ]),
        },
      },
    });
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("keeps local-preview Method Library routing in a reliable Study Now fallback", async () => {
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(studyNowGenerationRequest(25, {
      goal: "Study biology vocabulary definitions from memory for tomorrow's quiz.",
      startingContext: "I already learned the terms and need to practice retrieving them.",
      knowledgeMap: undefined,
      previewPreferredMethodIds: ["spaced_retrieval"],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({ mode: "system" });
    expect(body.plan.sessions).toHaveLength(1);
    expect(body.plan.sessions[0]).toMatchObject({
      method: "Spaced Repetition",
      studyRoute: {
        approach: { primaryMethodId: "spaced_retrieval" },
        provenance: {
          evidenceRefs: expect.arrayContaining([
            "profile-method-preference:spaced_retrieval",
          ]),
        },
      },
    });
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("fails a system fallback truthfully when the plan cannot fit before the deadline", async () => {
    configureProduction();
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const unavailableDay = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      deadline: deadline.toISOString(),
      timeZone: "UTC",
      availability: [{ day: unavailableDay, window: "Evening", minutes: 25 }],
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "schedule_capacity",
      error: expect.stringMatching(/add another day|longer windows|move the deadline/i),
    });
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("releases by operation key and does not call the provider when reservation status is unknown", async () => {
    configureProduction();
    mocks.reserve.mockRejectedValueOnce(new Error("reservation receipt lost"));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(503);
    expect(mocks.releaseOperation).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    const operationKey = mocks.releaseOperation.mock.calls[0]?.[2];
    const recoveryKey = mocks.releaseOperation.mock.calls[0]?.[3];
    expect(operationKey).toBe(response.headers.get("X-Yova-Request-Id"));
    expect(recoveryKey).not.toBe(operationKey);
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("keeps an accepted-map normal plan on the fixed-envelope fallback when reservation status is unknown", async () => {
    configureProduction();
    mocks.reserve.mockRejectedValueOnce(new Error("reservation receipt lost"));
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "system",
      model: null,
      notice: expect.stringMatching(/^Live AI planning is temporarily unavailable/),
      draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
    });
    expectFullyRoutedNormalFallback(body.plan);
    expect(mocks.releaseOperation).toHaveBeenCalledWith(
      expect.anything(),
      "plan_generation",
      response.headers.get("X-Yova-Request-Id"),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ finalOutcome: "fallback", attempts: 0 }),
    );
  });

  it("keeps an accepted-map normal plan on the fixed-envelope fallback when the account allowance is exhausted", async () => {
    configureProduction();
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "66666666-6666-4666-8666-666666666666",
      denialReason: "usage_limit",
      retryAfterSeconds: 3_600,
      remainingToday: 0,
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generation).toMatchObject({
      mode: "system",
      model: null,
      notice: expect.stringMatching(/^Live AI planning is unavailable for this account/),
      draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
    });
    expectFullyRoutedNormalFallback(body.plan);
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateLegacyPlan).not.toHaveBeenCalled();
    expect(mocks.releaseOperation).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.recordObservation).toHaveBeenLastCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ finalOutcome: "fallback", attempts: 0 }),
    );
  });

  it.each([
    {
      denialReason: "operation_in_progress",
      retryAfterSeconds: 11,
      code: "ai_operation_in_progress",
      retryable: true,
      expectedRetryAfter: "11",
    },
    {
      denialReason: "operation_already_consumed",
      retryAfterSeconds: 0,
      code: "ai_operation_already_consumed",
      retryable: false,
      expectedRetryAfter: null,
    },
    {
      denialReason: "operation_already_released",
      retryAfterSeconds: 0,
      code: "ai_operation_already_released",
      retryable: false,
      expectedRetryAfter: null,
    },
  ])("returns a non-quota conflict for $denialReason without calling the provider", async ({
    denialReason,
    retryAfterSeconds,
    code,
    retryable,
    expectedRetryAfter,
  }) => {
    configureProduction();
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "66666666-6666-4666-8666-666666666666",
      denialReason,
      retryAfterSeconds,
      remainingToday: 8,
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(diagnosticGenerationRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe(expectedRetryAfter);
    await expect(response.json()).resolves.toMatchObject({ code, retryable });
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generateDiagnostic).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("does not let synchronous analytics failure suppress a validated plan", async () => {
    configureProduction();
    mocks.recordObservation.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generation: {
        mode: "openai",
        draftReceipt: expect.stringMatching(/^yova-draft\.v1\./u),
      },
    });
  });

  it("fails before metered work when production cannot authenticate the draft", async () => {
    configureProduction();
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "");
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "draft_receipt_unavailable",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generateKnowledgeMap).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("rejects request-local preview preferences on an authenticated cloud request", async () => {
    configureProduction();
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      previewPreferredMethodIds: ["self_explanation"],
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "preview_method_preferences_not_allowed",
      fields: { previewPreferredMethodIds: expect.any(Array) },
    });
    expect(mocks.loadDurationContext).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("rejects request-local canonical profile context on an authenticated cloud request", async () => {
    configureProduction();
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      previewCanonicalProfile: createCanonicalLearnerProfile([{
        signalId: "control_mode",
        value: "help_me_choose",
        source: "canonical_questionnaire",
        sourceQuestionId: "profile_control_mode",
        provenance: "direct_answer",
      }]),
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "preview_canonical_profile_not_allowed",
      fields: { previewCanonicalProfile: expect.any(Array) },
    });
    expect(mocks.loadDurationContext).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });

  it("excludes expired staged materials before mapping or provider work", async () => {
    configureProduction();
    const gt = vi.fn().mockResolvedValue({ data: [], error: null });
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      gt,
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
          error: null,
        }),
      },
      from: vi.fn(() => query),
    });
    const { POST } = await import("@/app/api/plans/generate/route");

    const response = await POST(planGenerationRequest({
      materialMode: "upload",
      materials: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "calculus-notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2_048,
        textContent: null,
        processingStatus: "ready",
      }],
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "material_staging_expired" });
    expect(gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.generatePlan).not.toHaveBeenCalled();
  });
});

function configureProduction() {
  mocks.developmentPreview = false;
  mocks.supabaseConfigured = true;
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
        error: null,
      }),
    },
  });
}

function planGenerationRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/plans/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...planRequest, ...overrides }),
  });
}

function studyNowGenerationRequest(
  minutes: number,
  overrides: Record<string, unknown> = {},
) {
  return planGenerationRequest({
    intent: "study_now",
    deadline: null,
    availability: [{ day: "Sunday", window: "Now", minutes }],
    ...overrides,
  });
}

function emptyDurationProfile(): AuthorizedNormalDurationProfile {
  return {
    sustainableMinutes: null,
    startingFrictionRisk: null,
    fatigueRisk: null,
    preferredWindow: null,
    evidenceRefs: {
      sustainableMinutes: [],
      startingFrictionRisk: [],
      fatigueRisk: [],
      preferredWindow: [],
    },
  };
}

function emptyDurationContext() {
  return {
    status: "empty" as const,
    reason: "development_preview" as const,
    profileVersion: "authorized_profile_context_v1+empty",
    profile: emptyDurationProfile(),
    recentOutcomes: [],
    methodProfileVersion: "authorized_profile_context_v1+empty",
    methodEvidence: emptyMethodEvidence(),
  };
}

function methodPersonalizedContext() {
  return {
    ...emptyDurationContext(),
    status: "ready" as const,
    reason: "loaded" as const,
    profileVersion: "authorized_profile_context_v1+profile-revision-test",
    methodProfileVersion: "authorized_profile_context_v1+profile-revision-test",
    methodEvidence: {
      personalization: {
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
            code: "similar_idea_confusion",
            evidenceLabel: "You told YOVA",
            paused: false,
          }],
        },
      },
      observedEvidence: [],
    },
  };
}

function readyDurationContext(
  profile: AuthorizedNormalDurationProfile,
  recentOutcomes: ReturnType<typeof comparableInterruption>[] = [],
) {
  return {
    status: "ready" as const,
    reason: "loaded" as const,
    profileVersion: "authorized-duration-profile-v1",
    profile,
    recentOutcomes,
    methodProfileVersion: "authorized-method-profile-v1",
    methodEvidence: emptyMethodEvidence(),
  };
}

function emptyMethodEvidence() {
  return buildAuthorizedMethodDecisionEvidence({
    answers: [],
    plans: [],
    completions: [],
    now: new Date("2026-08-24T12:00:00.000Z"),
  });
}

function comparableInterruption(index: number) {
  return {
    kind: "interruption" as const,
    sessionClass: "normal" as const,
    taskFamily: "problem_solving" as const,
    mode: "practice" as const,
    occurredAt: `2026-08-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
    routeRevisionId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    plannedMinutes: 25,
    actualMinutes: 10,
    completedSteps: 1,
    totalSteps: 4,
    evidenceRef: `interruption:${index}`,
  };
}

function diagnosticGenerationRequest() {
  return new Request("http://localhost/api/plans/generate?mode=diagnostic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(planRequest),
  });
}

function generatedDiagnostic() {
  return {
    questions: [{
      id: "22222222-2222-4222-8222-222222222222",
      topicId: TOPIC_ID,
      prompt: "Which statement correctly describes the product rule?",
      options: [
        "Differentiate each factor and add the two cross terms.",
        "Differentiate only the first factor.",
        "Multiply both derivatives together.",
        "I don't know yet",
      ],
      correctAnswer: "Differentiate each factor and add the two cross terms.",
    }],
    stats: {
      ...generatedStats(),
      repairAttempted: undefined,
      repairSucceeded: undefined,
      validationIssueCode: undefined,
    },
  };
}

function generatedKnowledgeMap() {
  return {
    map: planRequest.knowledgeMap!,
    stats: {
      elapsedMs: 1_000,
      attempts: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 200,
      firstAttemptPassed: true,
      failedValidator: null,
      model: "gpt-yova-test",
      curriculumRecognized: false,
      curriculumId: null,
      curriculumMatchSource: null,
      curriculumMatchConfidence: null,
    },
  };
}

function studyNowKnowledgeMap() {
  const topicNames = [
    "Recognize products of functions",
    "Apply the product rule procedure",
    "Explain why both derivative terms are required",
    "Transfer the product rule to an unfamiliar expression",
  ];
  return {
    ...planRequest.knowledgeMap!,
    topics: topicNames.map((title, index) => ({
      ...planRequest.knowledgeMap!.topics[0]!,
      id: STUDY_NOW_TOPIC_IDS[index],
      title,
      description: `${title} accurately and independently.`,
      prerequisiteTopicIds: index === 0 ? [] : [STUDY_NOW_TOPIC_IDS[index - 1]],
    })),
  };
}

function generatedStats() {
  return {
    elapsedMs: 1_000,
    attempts: 1,
    firstAttemptPassed: true,
    failedValidator: null,
    repairAttempted: false,
    repairSucceeded: null,
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    model: "gpt-yova-test",
    validationIssueCode: null,
  };
}

function generatedNormalPlanFillResult(
  request: PlanGenerationRequest,
  composition: NormalPlanEnvelopeComposition,
  mutate?: (fill: NormalPlanProviderFill) => void,
) {
  const fill = structuredClone(buildNormalPlanFallbackFill({ request, composition }));
  mutate?.(fill);
  return {
    fill,
    model: "gpt-yova-test",
    responseId: "response-normal-plan-fill",
    generationStats: generatedStats(),
  };
}

function normalPlanAuthoritySnapshot(plan: {
  sessions: Array<Record<string, unknown>>;
  knowledgeMap: { topics: Array<Record<string, unknown>> };
}) {
  return {
    sessions: plan.sessions.map((session) => {
      const route = session.studyRoute as Record<string, Record<string, unknown>>;
      return {
        scheduledFor: session.scheduledFor,
        estimatedMinutes: session.estimatedMinutes,
        learningMode: session.learningMode,
        topicIds: session.topicIds,
        contentTargets: session.contentTargets,
        method: session.method,
        route: {
          target: {
            taskFamily: route.target.taskFamily,
            targetStates: route.target.targetStates,
            sourceRequirements: route.target.sourceRequirements,
          },
          approach: route.approach,
          timing: route.timing,
          agency: route.agency,
          execution: {
            orderedPhases: route.execution.orderedPhases,
            difficultyTier: route.execution.difficultyTier,
            initialSupport: route.execution.initialSupport,
            activityLimit: route.execution.activityLimit,
            deferredTargets: route.execution.deferredTargets,
            completionEvidence: (
              route.execution.completionEvidence as Array<Record<string, unknown>>
            ).map((evidence) => ({
              evidenceId: evidence.evidenceId,
              targetIds: evidence.targetIds,
              kind: evidence.kind,
              requiresIndependentAttempt: evidence.requiresIndependentAttempt,
            })),
          },
        },
      };
    }),
    topicDeferrals: plan.knowledgeMap.topics.map((topic) => ({
      id: topic.id,
      deferred: topic.deferred,
    })),
  };
}

function expectFullyRoutedNormalFallback(plan: {
  sessions: Array<{
    topicIds: string[];
    studyRoute?: {
      identity: { lifecycleStatus: string };
      provenance: { routerVersion: string };
      execution: { completionEvidence: Array<{ targetIds: string[] }> };
    };
  }>;
}) {
  expect(plan.sessions.length).toBeGreaterThanOrEqual(2);
  for (const session of plan.sessions) {
    expect(session.studyRoute).toBeDefined();
    expect(session.studyRoute?.identity.lifecycleStatus).toBe("provisional");
    expect(studyRouteProvenanceIncludesRouterComponent(
      session.studyRoute!.provenance as never,
      "normal_plan_envelope_route_integration_v1",
    )).toBe(true);
    expect(session.studyRoute?.execution.completionEvidence.map((evidence) => (
      evidence.targetIds
    ))).toEqual(session.topicIds.map((topicId) => [topicId]));
  }
}

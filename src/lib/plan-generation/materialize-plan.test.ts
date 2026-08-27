import { describe, expect, it } from "vitest";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import type { GeneratedPlanDraft, PlanGenerationRequest } from "@/lib/plan-generation/schema";
import type { StudyNowDurationDecision } from "@/lib/study-route/duration-plan-integration";
import { resolveNormalStudyDurationPrecedence } from "@/lib/study-route/duration-precedence";
import { NORMAL_DURATION_RECOMMENDER_VERSION } from "@/lib/study-route/duration-recommendation";
import { selectCanonicalStudyMethod } from "@/lib/learning/canonical-method-selection";
import type { StudyRouteMethodDecision } from "@/lib/study-route/method-plan-integration";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  composeNormalPlanEnvelopes,
  type NormalPlanEnvelopeComposition,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  bindNormalPlanProviderFill,
  buildNormalPlanFallbackFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";

const request: PlanGenerationRequest = {
  intent: "plan",
  learningIntent: "learn",
  goal: "I know nothing about World War I and need to prepare for a test",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [
    { question: "Where are you starting?", answer: "Completely new", evaluation: "self_report" },
  ],
  availability: [{ day: "Friday", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants a clear big-picture explanation before independent work.",
  knowledgeMap: {
    version: 1,
    scopeJudgment: { band: "focused_skill", label: "Focused history foundation", minimumSessions: 1, recommendedSessions: 1, maximumSessions: 2, minimumTeachingSessions: 1, explanation: "The first plan builds one prerequisite causal relationship before later expansion." },
    topics: [{ id: "11111111-1111-4111-8111-111111111111", title: "World War I escalation", description: "How alliances and mobilization widened the conflict after the July Crisis.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null, curriculumReference: null }],
    placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    curriculum: null,
  },
};

const staleDraft: GeneratedPlanDraft = {
  title: "World War I",
  topic: "World War I causes and escalation",
  kind: "test",
  deadline: null,
  rationale: "Prepare for the assessment with a sequence of focused learning sessions.",
  deferredTopics: [],
  sessions: [{
    title: "Recall the July Crisis",
    objective: "Recall the causes of World War I without looking at an explanation.",
    method: "Retrieval practice",
    methodReason: "Starting with recall can expose gaps.",
    scheduledFor: "2026-08-07T18:00:00.000-07:00",
    estimatedMinutes: 25,
    amountLabel: "One target and one check",
    learningMode: "study",
    topicIds: ["11111111-1111-4111-8111-111111111111"],
    contentTargets: ["How alliances and mobilization widened the war"],
    completionEvidence: ["Answer one question about the July Crisis"],
  }],
};

function studyNowDurationDecision(): StudyNowDurationDecision {
  const result = resolveNormalStudyDurationPrecedence({
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
  if (result.status !== "resolved") throw new Error("The fixture must resolve.");
  return {
    timing: result.timing,
    ruleTrace: result.ruleTrace,
    routerVersion: NORMAL_DURATION_RECOMMENDER_VERSION,
    profileVersion: "authorized_profile_snapshot:duration-v1",
  };
}

function studyNowMethodDecision(): StudyRouteMethodDecision {
  return {
    selection: selectCanonicalStudyMethod({
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
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
            code: "delayed_forgetting",
            evidenceLabel: "You told YOVA",
            paused: false,
          }],
        },
      },
    }),
    profileVersion: "authorized_profile_snapshot:method-v1",
  };
}

function memorizationDraft(): GeneratedPlanDraft {
  return {
    ...staleDraft,
    title: "Biology vocabulary",
    topic: "Biology vocabulary and definitions",
    kind: "test",
    sessions: [{
      ...staleDraft.sessions[0]!,
      title: "Recall the biology terms",
      objective: "Memorize each biology term and recall its definition without notes.",
      method: "Self-explanation",
      methodReason: "This deliberately stale model proposal must not own routing.",
      learningMode: "study",
      topicIds: ["11111111-1111-4111-8111-111111111111"],
      contentTargets: ["Recall and distinguish the biology terms"],
      completionEvidence: ["Recall every definition without notes and repair each gap"],
    }],
  };
}

describe("materializePlanDraft", () => {
  it("materializes deterministic Study Now timing into the scalar and route atomically", () => {
    const studyNowRequest: PlanGenerationRequest = {
      ...request,
      intent: "study_now",
      deadline: null,
      availability: [{ day: "Today", window: "Now", minutes: 20 }],
    };
    const plan = materializePlanDraft(staleDraft, studyNowRequest, new Date("2026-08-23T09:00:00.000Z"), {
      studyNowDurationDecision: studyNowDurationDecision(),
    });

    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]).toMatchObject({
      estimatedMinutes: 15,
      amountLabel: "Focused session · about 15 min",
      studyRoute: {
        timing: {
          activeMinutes: 15,
          elapsedMinutes: 15,
          durationSource: "availability_cap",
          hardMaximumMinutes: 20,
        },
        provenance: {
          profileVersion: "authorized_profile_snapshot:duration-v1",
        },
      },
    });
    expect(plan.sessions[0]?.studyRoute?.execution.orderedPhases.reduce((sum, phase) => (
      sum + phase.activeMinutes
    ), 0)).toBe(15);
    expect(plan.sessions[0]?.studyRoute?.provenance.routerVersion).toContain(
      NORMAL_DURATION_RECOMMENDER_VERSION,
    );
  });

  it("preserves legacy Study Now materialization when no sidecar is supplied", () => {
    const plan = materializePlanDraft(staleDraft, {
      ...request,
      intent: "study_now",
      deadline: null,
      availability: [{ day: "Today", window: "Now", minutes: 20 }],
    });

    expect(plan.sessions[0]).toMatchObject({
      estimatedMinutes: 20,
      studyRoute: {
        timing: {
          activeMinutes: 20,
          durationSource: "legacy_reconstruction",
        },
      },
    });
  });

  it("applies duration and method decisions atomically without losing either profile provenance", () => {
    const studyNowRequest: PlanGenerationRequest = {
      ...request,
      intent: "study_now",
      learningIntent: "study",
      goal: "Memorize biology vocabulary and recall each definition without notes.",
      deadline: null,
      knowledgeMap: undefined,
      availability: [{ day: "Today", window: "Now", minutes: 20 }],
    };
    const plan = materializePlanDraft(
      memorizationDraft(),
      studyNowRequest,
      new Date("2026-08-24T08:00:00.000Z"),
      {
        studyNowDurationDecision: studyNowDurationDecision(),
        studyNowMethodDecision: studyNowMethodDecision(),
      },
    );

    expect(plan.sessions[0]).toMatchObject({
      method: "Spaced Repetition",
      estimatedMinutes: 15,
      learningMode: "study",
      studyRoute: {
        approach: {
          primaryMethodId: "spaced_retrieval",
          visibleMethodName: "Spaced Repetition",
        },
        timing: {
          activeMinutes: 15,
          durationSource: "availability_cap",
        },
        provenance: {
          profileVersion: "authorized_profile_snapshot:duration-v1+authorized_profile_snapshot:method-v1",
        },
      },
    });
    expect(plan.sessions[0]?.methodReason).toBe(
      plan.sessions[0]?.studyRoute?.explanation.shortReason,
    );
    expect(plan.sessions[0]?.studyRoute?.execution.orderedPhases.map((phase) => (
      phase.methodPhase
    ))).toEqual(["retrieve", "schedule_return"]);
  });

  it("rejects a Study Now duration sidecar for a normal plan", () => {
    expect(() => materializePlanDraft(
      staleDraft,
      request,
      new Date("2026-08-23T09:00:00.000Z"),
      { studyNowDurationDecision: studyNowDurationDecision() },
    )).toThrow("normal plan");
  });

  it("rejects a Study Now method sidecar for a normal plan", () => {
    expect(() => materializePlanDraft(
      memorizationDraft(),
      request,
      new Date("2026-08-24T08:00:00.000Z"),
      { studyNowMethodDecision: studyNowMethodDecision() },
    )).toThrow("normal plan");
  });

  it("preserves an evidence-owned Practice envelope even when the global starting intent is Learn", () => {
    const fixture = normalPlanEnvelopeFixture();
    expect(fixture.request.learningIntent).toBe("learn");
    expect(fixture.draft.sessions[0]?.learningMode).toBe("study");

    const plan = materializePlanDraft(
      fixture.draft,
      fixture.request,
      new Date("2026-08-24T08:00:00.000Z"),
      { normalPlanEnvelopeComposition: fixture.composition },
    );

    expect(plan.sessions[0]).toMatchObject({
      learningMode: "study",
      objective: fixture.draft.sessions[0]?.objective,
      method: fixture.draft.sessions[0]?.method,
    });
    expect(plan.sessions[0]?.objective).not.toMatch(/first mental model/i);
    expect(plan.sessions[0]?.studyRoute).toBeUndefined();
  });

  it.each([
    "version",
    "empty",
    "count",
    "sequence",
    "schedule",
    "minutes",
    "mode",
    "topicIds",
    "amountLabel",
    "contentBudget",
  ] as const)("rejects a %s mismatch before materializing a fixed normal plan", (mismatch) => {
    const fixture = normalPlanEnvelopeFixture();
    const draft = structuredClone(fixture.draft);
    const composition = structuredClone(fixture.composition) as NormalPlanEnvelopeComposition;
    const firstSession = draft.sessions[0]!;
    const firstEnvelope = composition.envelopes[0]!;

    if (mismatch === "version") {
      Object.assign(composition, { version: "unsupported_normal_plan_envelope_v2" });
    } else if (mismatch === "empty") {
      Object.assign(composition, { envelopes: [] });
    } else if (mismatch === "count") {
      Object.assign(composition, { envelopes: [...composition.envelopes, firstEnvelope] });
    } else if (mismatch === "sequence") {
      Object.assign(firstEnvelope, { sequence: 99 });
    } else if (mismatch === "schedule") {
      firstSession.scheduledFor = "2026-09-30T12:00:00.000Z";
    } else if (mismatch === "minutes") {
      firstSession.estimatedMinutes = firstEnvelope.timing.activeMinutes === 25 ? 30 : 25;
    } else if (mismatch === "mode") {
      firstSession.learningMode = firstEnvelope.learningMode === "learn" ? "study" : "learn";
    } else if (mismatch === "topicIds") {
      firstSession.topicIds = ["99999999-9999-4999-8999-999999999999"];
    } else if (mismatch === "amountLabel") {
      firstSession.amountLabel = "Provider-authored amount label";
    } else {
      Object.assign(firstEnvelope, {
        contentBudget: {
          ...firstEnvelope.contentBudget,
          maximumContentTargets: firstEnvelope.contentBudget.maximumContentTargets + 1,
        },
      });
    }

    expect(() => materializePlanDraft(
      draft,
      fixture.request,
      new Date("2026-08-24T08:00:00.000Z"),
      { normalPlanEnvelopeComposition: composition },
    )).toThrow(/normal-plan envelope|fixed normal-plan envelope/i);
  });

  it("rejects a normal-plan envelope composition for Study Now", () => {
    const fixture = normalPlanEnvelopeFixture();
    expect(() => materializePlanDraft(
      fixture.draft,
      {
        ...fixture.request,
        intent: "study_now",
        deadline: null,
        availability: [{ day: "Today", window: "Now", minutes: 25 }],
      },
      new Date("2026-08-24T08:00:00.000Z"),
      { normalPlanEnvelopeComposition: fixture.composition },
    )).toThrow(/cannot be materialized into Study Now/i);
  });

  it("treats the learner's requested starting approach as authoritative", () => {
    const plan = materializePlanDraft(staleDraft, request);

    expect(plan.sessions[0]).toMatchObject({
      learningMode: "learn",
      method: "Guided explanation and self-explanation",
    });
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessionArchitectureVersion).toBe("streamed_teaching_v1");
    expect(plan.sessions[0]?.studyRoute).toMatchObject({
      identity: {
        planId: plan.id,
        sessionId: plan.sessions[0]?.id,
        lifecycleStatus: "provisional",
        revisionNumber: 1,
      },
      approach: {
        mode: "learn",
        executionEnvironment: "inside_yova",
        primaryMethodId: "self_explanation",
      },
      timing: { activeMinutes: 25 },
    });
  });

  it("gives every canonicalizable draft session stable route identity before review", () => {
    const plan = materializePlanDraft({
      ...staleDraft,
      sessions: [
        staleDraft.sessions[0]!,
        {
          ...staleDraft.sessions[0]!,
          title: "Repair the escalation sequence",
          objective: "Repair the weakest link in the escalation sequence after a first attempt.",
          method: "Guided concept repair",
          methodReason: "A bounded correction and retry targets the exact exposed gap.",
          learningMode: "study",
          scheduledFor: "2026-08-08T18:00:00.000-07:00",
        },
        {
          ...staleDraft.sessions[0]!,
          title: "Distinguish escalation cases",
          objective: "Choose the correct escalation mechanism across mixed historical cases.",
          method: "Mixed practice",
          methodReason: "Mixed cases test whether the learner can distinguish related mechanisms.",
          learningMode: "study",
          scheduledFor: "2026-08-09T18:00:00.000-07:00",
        },
        {
          ...staleDraft.sessions[0]!,
          title: "Complete the escalation assessment",
          objective: "Complete a representative assessment and repair each exposed error.",
          method: "Assessment and error review",
          methodReason: "A representative assessment verifies readiness and directs final repair.",
          learningMode: "study",
          scheduledFor: "2026-08-10T18:00:00.000-07:00",
        },
      ],
    }, request, new Date("2026-08-23T09:00:00.000Z"));

    const routes = plan.sessions.map((session) => session.studyRoute);
    expect(routes.every(Boolean)).toBe(true);
    expect(new Set(routes.map((route) => route?.identity.routeLineageId)).size).toBe(4);
    expect(new Set(routes.map((route) => route?.identity.routeRevisionId)).size).toBe(4);
    expect(routes.every((route) => route?.identity.createdAt === "2026-08-23T09:00:00.000Z")).toBe(true);
    expect(routes.map((route) => route?.approach.primaryMethodId)).toEqual([
      "self_explanation",
      "practice_test_error_repair",
      "interleaved_practice",
      "practice_test_error_repair",
    ]);
  });

  it("repairs generic generated titles before a plan reaches Learning", () => {
    const plan = materializePlanDraft({
      ...staleDraft,
      title: "Personalized learning plan",
    }, {
      ...request,
      goal: "I want to learn new vocabulary words so I can be better in conversation",
    });

    expect(plan.title).toMatch(/vocabulary/i);
    expect(plan.title).not.toMatch(/personalized learning plan/i);
  });

  it("shortens a long generated title at a phrase boundary before it reaches Learning", () => {
    const goal = "Analyze comparative political institutions across historical regions through evidence";
    const plan = materializePlanDraft({
      ...staleDraft,
      title: "Analyze Comparative Political Institutions Across Historical Regions Through Evidence",
    }, {
      ...request,
      goal,
    });

    expect(plan.title).toBe("Analyze Comparative Political Institutions…");
    expect(plan.title.length).toBeLessThanOrEqual(72);
  });

  it("replaces a material-backed leading-fragment topic before persistence", () => {
    const goal = "Biology Quiz on Osmosis. Be Able to Explain Water Movement, Tonicity";
    const fragment = ", and the Effects on Animal and Plant Cells Using the Attached Notes";
    const plan = materializePlanDraft({
      ...staleDraft,
      title: goal,
      topic: fragment,
    }, {
      ...request,
      goal,
      materialMode: "upload",
      materials: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "yova-walkthrough-osmosis-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1_024,
        textContent: "Osmosis moves water across a selectively permeable membrane.",
        processingStatus: "ready",
      }],
    });

    expect(plan).toMatchObject({
      title: goal,
      topic: goal,
      sourceMode: "user_materials",
    });
    expect(plan.topic).not.toMatch(/^[,;:.!?]/);
    expect(plan.materials?.[0]?.textContent).toBeNull();
  });

  it.each(["in two weeks and I have not started yet", "in 14 days and I have not started yet"])(
    "keeps operational metadata out of plan, map, and session subject fields: %s",
    (operationalTail) => {
      const goal = `1,500-word History Essay. I have a 1,500-word history essay due ${operationalTail}`;
      const mappedTopic = {
        ...request.knowledgeMap!.topics[0]!,
        title: operationalTail,
        description: `The knowledge and performance needed for ${operationalTail}.`,
      };
      const plan = materializePlanDraft({
        ...staleDraft,
        title: "1,500-word History Essay Due",
        topic: operationalTail,
        kind: "topic",
        sessions: [{
          ...staleDraft.sessions[0]!,
          title: `Learn ${operationalTail}`,
          objective: `Build an accurate model of ${operationalTail}.`,
          learningMode: "learn",
          contentTargets: [operationalTail],
          completionEvidence: [`Explain ${operationalTail}`],
        }],
      }, {
        ...request,
        goal,
        studyMode: "outside",
        knowledgeMap: {
          ...request.knowledgeMap!,
          topics: [mappedTopic],
        },
      });

      expect(plan).toMatchObject({
        title: "1,500-word History Essay Due",
        topic: "1,500-word History Essay",
        knowledgeMap: {
          topics: [{
            title: "1,500-word History Essay",
            description: "The knowledge and performance needed for 1,500-word History Essay.",
          }],
        },
        sessions: [{
          title: "Learn 1,500-word History Essay",
          objective: "Build an accurate model of 1,500-word History Essay.",
          contentTargets: ["1,500-word History Essay"],
          completionEvidence: ["Explain 1,500-word History Essay"],
        }],
      });
    },
  );
});

function normalPlanEnvelopeFixture() {
  const evidencedRequest: PlanGenerationRequest = {
    ...request,
    knowledgeMap: {
      ...request.knowledgeMap!,
      scopeJudgment: {
        ...request.knowledgeMap!.scopeJudgment,
        minimumTeachingSessions: 0,
      },
      topics: request.knowledgeMap!.topics.map((topic) => ({
        ...topic,
        status: "evidenced" as const,
      })),
    },
  };
  const composition = composeNormalPlanEnvelopes({
    request: evidencedRequest,
    learningIntentRecommendation: {
      intent: "learn",
      basis: "The learner requested Learn globally, while recorded target evidence can still make this exact session Practice-first.",
    },
    durationContext: {
      profileVersion: "authorized_profile_snapshot:materialization-v1",
      profile: {
        sustainableMinutes: 25,
        startingFrictionRisk: null,
        fatigueRisk: null,
        preferredWindow: null,
        evidenceRefs: {
          sustainableMinutes: ["profile:sustainable-duration"],
          startingFrictionRisk: [],
          fatigueRisk: [],
          preferredWindow: [],
        },
      },
      recentOutcomes: [],
    },
    now: new Date("2026-08-24T08:00:00.000Z"),
    searchDays: 14,
  });
  expect(composition.version).toBe(NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION);
  const fill = buildNormalPlanFallbackFill({ request: evidencedRequest, composition });
  const draft = bindNormalPlanProviderFill({ request: evidencedRequest, composition, fill });
  return { request: evidencedRequest, composition, draft };
}

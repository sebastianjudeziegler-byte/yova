import { describe, expect, it } from "vitest";
import type { LearningPlan, SessionResource } from "@/lib/domain";
import {
  adaptLegacySessionToStudyRoute,
  adaptSessionResourceToStudyRoute,
  deterministicLegacyRouteUuid,
  legacyMethodIdFromText,
  legacyPlanSessionToStudyRoute,
  studyRouteToLegacySessionProjection,
} from "@/lib/study-route/adapters";

const IDS = {
  plan: "11111111-1111-4111-8111-111111111111",
  item: "22222222-2222-4222-8222-222222222222",
  session: "33333333-3333-4333-8333-333333333333",
  novice: "44444444-4444-4444-8444-444444444444",
  developing: "55555555-5555-4555-8555-555555555555",
  secure: "66666666-6666-4666-8666-666666666666",
} as const;

function plan(overrides: Partial<LearningPlan> = {}): LearningPlan {
  return {
    id: IDS.plan,
    learningItemId: IDS.item,
    title: "Cellular respiration",
    topic: "Cellular respiration pathways",
    kind: "test",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build the pathway before using retrieval and transfer checks.",
    createdAt: "2026-08-23T09:00:00.000Z",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        band: "unit_or_exam",
        label: "Cellular respiration unit",
        minimumSessions: 1,
        recommendedSessions: 3,
        maximumSessions: 5,
        minimumTeachingSessions: 1,
        explanation: "The pathway contains related targets that need separate evidence checks.",
      },
      topics: [
        topic(IDS.novice, "Glycolysis", "not_started"),
        topic(IDS.developing, "Citric acid cycle", "evidenced"),
        topic(IDS.secure, "Electron transport chain", "secure"),
      ],
      placementCheck: {
        status: "skipped",
        completedAt: null,
        demonstratedTopicIds: [],
        gapTopicIds: [],
      },
      curriculum: null,
    },
    materials: [],
    sessions: [{
      id: IDS.session,
      sequence: 1,
      title: "Explain and compare the respiration pathway",
      objective: "Explain how energy moves through the three stages of cellular respiration.",
      method: "Self-explanation",
      methodReason: "A causal model and an independent explanation fit this conceptual task.",
      scheduledFor: "2026-08-23T10:00:00.000Z",
      estimatedMinutes: 25,
      amountLabel: "Three pathway targets · about 25 min",
      learningMode: "learn",
      topicIds: [IDS.novice, IDS.developing, IDS.secure],
      contentTargets: ["Glycolysis", "Citric acid cycle", "Electron transport chain"],
      completionEvidence: ["Explain the pathway without looking at the model."],
      status: "ready",
    }],
    ...overrides,
  };
}

function topic(
  id: string,
  title: string,
  status: "not_started" | "taught" | "evidenced" | "secure",
) {
  return {
    id,
    title,
    description: `How ${title.toLocaleLowerCase()} contributes to cellular respiration.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status,
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated" as const,
    deferred: null,
    curriculumReference: null,
  };
}

function generatedResource(): SessionResource {
  return {
    schemaVersion: 17,
    topicIds: [IDS.novice, IDS.developing, IDS.secure],
    rationale: "The saved lesson used retrieval and repair before a fresh application.",
    methodBriefing: {
      learningMode: "study",
      taskType: "mixed_assessment",
      methodId: "practice_test_error_repair",
      name: "Practice test and error repair",
      what: "Attempt representative questions without support before reviewing the answers.",
      why: "The assessment requires independent recall and targeted correction of exposed gaps.",
      how: ["Attempt without notes.", "Repair each exposed gap."],
      completion: "Complete an unsupported attempt and repair each missed target.",
      personalization: ["The session begins independently before restoring support."],
    },
    routingContext: {
      taskType: "mixed_assessment",
      knowledgeStage: "developing",
    },
    deliveryPolicy: {
      schemaVersion: 1,
      evidenceStatus: "baseline",
      presentation: { mode: "task_aligned", label: "Task aligned", instruction: "Use the presentation required by the selected practice-test method." },
      repair: { mode: "direct_correction", label: "Direct correction", instruction: "Name the exposed error directly before requiring a fresh attempt." },
      retention: { mode: "transfer", label: "Transfer", instruction: "Use a new context after repair to verify that the correction transfers." },
      workspace: { mode: "full_path", label: "Full path", instruction: "Keep the complete practice-test sequence visible throughout the session." },
      pacing: { firstActionMinutes: 2, maximumActivities: 6, reason: "Begin with an unsupported attempt and keep the practice set bounded." },
      activityCadence: { mode: "task_aligned", label: "Task aligned", instruction: "Change activities when the selected method and objective require it." },
      attemptSafety: { mode: "task_aligned", label: "Task aligned", instruction: "Use the attempt format required by the practice-test method." },
      knowledgeCheck: { mode: "closed_note_first", label: "Closed note first", instruction: "Require an answer before showing any source or correction." },
      learnerFacingReasons: ["YOVA is starting with a real attempt so the remaining gaps are visible."],
      signalsUsed: [],
    },
    supportPlan: {
      level: "independent_start",
      title: "Start independently",
      explanation: "A real unsupported attempt is needed before targeted repair.",
      evidenceLabel: "Establishing a baseline",
      concept: null,
    },
    cacheContext: {
      effectiveMinutes: 15,
      adjustmentFingerprint: "a".repeat(64),
      scopeFingerprint: `sc1:${"b".repeat(16)}`,
    },
    activities: [
      activity("retrieve", 7, "Unsupported check"),
      activity("repair", 4, "Repair the exposed gap"),
      activity("transfer", 4, "Apply the correction elsewhere"),
    ],
    generatedAt: "2026-08-23T09:30:00.000Z",
    origin: "generated",
  };
}

function activity(
  methodPhase: "retrieve" | "repair" | "transfer",
  estimatedMinutes: number,
  title: string,
): SessionResource["activities"][number] {
  return {
    topicId: IDS.novice,
    methodPhase,
    estimatedMinutes,
    requiredForCompletion: methodPhase !== "repair",
    type: methodPhase === "repair" ? "instruction" : "free_response",
    concept: methodPhase === "repair" ? null : "Respiration pathway",
    label: title,
    title,
    body: "Complete the bounded activity using the current pathway target.",
    choices: [],
    correctAnswer: methodPhase === "repair" ? null : "A grounded response",
    feedback: null,
  };
}

describe("legacy StudyRoute adapters", () => {
  it("classifies the preview engine's guided concept-repair method", () => {
    expect(legacyMethodIdFromText("Guided concept repair")).toBe("practice_test_error_repair");
    expect(legacyMethodIdFromText("Assessment and error review")).toBe("practice_test_error_repair");
  });

  it("preserves the legacy learner-facing promise while making unknown provenance explicit", () => {
    const currentPlan = plan();
    const result = adaptLegacySessionToStudyRoute({
      plan: currentPlan,
      session: currentPlan.sessions[0]!,
      adaptedAt: "2026-08-23T09:05:00.000Z",
      identity: {
        routeLineageId: "77777777-7777-4777-8777-777777777777",
        routeRevisionId: "88888888-8888-4888-8888-888888888888",
      },
    });

    expect(result.route).toMatchObject({
      identity: {
        lifecycleStatus: "committed",
        routeLineageId: "77777777-7777-4777-8777-777777777777",
        routeRevisionId: "88888888-8888-4888-8888-888888888888",
      },
      approach: {
        mode: "learn",
        executionEnvironment: "inside_yova",
        primaryMethodId: "self_explanation",
        visibleMethodName: "Self-explanation",
        confidenceLevel: "unknown",
      },
      timing: { activeMinutes: 25, elapsedMinutes: 25, durationSource: "legacy_reconstruction" },
      agency: { controlMode: "legacy_unknown", selectedBy: "legacy_unknown" },
      execution: { difficultyTier: "unknown", initialSupport: "supported_start" },
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      "agency_unknown",
      "difficulty_unknown",
      "duration_provenance_unknown",
      "phase_structure_derived",
      "target_state_reconstructed",
      "task_family_inferred",
    ]));
    expect(result.route?.explanation.uncertainties.join(" ")).not.toMatch(/learning style/i);
  });

  it("keeps separate reconstructed state for mixed-stage targets", () => {
    const currentPlan = plan();
    const route = legacyPlanSessionToStudyRoute({
      plan: currentPlan,
      session: currentPlan.sessions[0]!,
      adaptedAt: "2026-08-23T09:05:00.000Z",
    });

    expect(route?.target.targetStates.map(({ targetId, stage, uncertainty }) => ({
      targetId,
      stage,
      uncertainty,
    }))).toEqual([
      { targetId: IDS.novice, stage: "novice", uncertainty: "unknown" },
      { targetId: IDS.developing, stage: "developing", uncertainty: "unknown" },
      { targetId: IDS.secure, stage: "retrieval_ready", uncertainty: "unknown" },
    ]);
  });

  it("declines to invent a canonical method for ambiguous legacy prose", () => {
    const currentPlan = plan();
    const session = { ...currentPlan.sessions[0]!, method: "Use my usual approach" };
    const result = adaptLegacySessionToStudyRoute({ plan: currentPlan, session });

    expect(result.route).toBeNull();
    expect(result.issues).toContain("method_unclassified");
  });

  it("uses deterministic synthetic identifiers without treating them as trustworthy target evidence", () => {
    const currentPlan = plan({ id: "legacy_plan", knowledgeMap: undefined });
    const session = {
      ...currentPlan.sessions[0]!,
      id: "legacy_session",
      topicIds: [],
      contentTargets: ["First target", "Second target"],
    };
    const first = adaptLegacySessionToStudyRoute({ plan: currentPlan, session });
    const second = adaptLegacySessionToStudyRoute({ plan: currentPlan, session });

    expect(first.route?.identity).toEqual(second.route?.identity);
    expect(first.route?.target.targetStates).toEqual(second.route?.target.targetStates);
    expect(first.issues).toEqual(expect.arrayContaining([
      "legacy_identity_canonicalized",
      "synthetic_target_id",
      "target_stage_inferred_from_mode",
    ]));
    expect(first.route?.target.targetStates.every((target) => target.evidenceRefs.length === 0)).toBe(true);
    expect(deterministicLegacyRouteUuid("same", "target")).toBe(deterministicLegacyRouteUuid("same", "target"));
  });

  it("keeps outside work on one lightweight phase instead of inflating a guided runtime", () => {
    const currentPlan = plan({ studyMode: "outside_yova" });
    const route = legacyPlanSessionToStudyRoute({ plan: currentPlan, session: currentPlan.sessions[0]! });

    expect(route?.approach.executionEnvironment).toBe("outside_yova");
    expect(route?.execution.orderedPhases).toHaveLength(1);
    expect(route?.execution.orderedPhases[0]).toMatchObject({
      methodPhase: "independent_practice",
      activeMinutes: 25,
    });
    expect(route?.execution.completionEvidence[0]?.requiresIndependentAttempt).toBe(false);
  });

  it("clamps a short legacy quick review to the executable five-minute floor", () => {
    const currentPlan = plan();
    const session = {
      ...currentPlan.sessions[0]!,
      estimatedMinutes: 2,
      reviewType: "verify" as const,
    };
    const route = legacyPlanSessionToStudyRoute({ plan: currentPlan, session });

    expect(route?.timing).toMatchObject({ activeMinutes: 5, elapsedMinutes: 5 });
    expect(route?.execution.orderedPhases).toEqual([
      expect.objectContaining({
        methodPhase: "retrieve",
        activeMinutes: 5,
      }),
    ]);
  });

  it("preserves validated resource structure and effective duration as the executed compatibility route", () => {
    const currentPlan = plan();
    const session = { ...currentPlan.sessions[0]!, resource: generatedResource() };
    const result = adaptSessionResourceToStudyRoute({ plan: currentPlan, session });

    expect(result.route).toMatchObject({
      target: { taskFamily: "mixed_assessment" },
      approach: {
        mode: "practice",
        primaryMethodId: "practice_test_error_repair",
        visibleMethodName: "Practice test and error repair",
      },
      timing: { activeMinutes: 15, elapsedMinutes: 15 },
      execution: {
        initialSupport: "independent_start",
        activityLimit: 6,
        orderedPhases: [
          { methodPhase: "retrieve", activeMinutes: 7 },
          { methodPhase: "repair", activeMinutes: 4 },
          { methodPhase: "transfer", activeMinutes: 4 },
        ],
      },
    });
    expect(result.issues).not.toContain("phase_structure_derived");
  });

  it("does not let generated prose change the structural executed route", () => {
    const currentPlan = plan();
    const first = generatedResource();
    const second = {
      ...generatedResource(),
      rationale: "Completely different prose about why this resource exists, with no structural change.",
      activities: generatedResource().activities.map((candidate) => ({
        ...candidate,
        body: "Different tutor prose fills the exact same deterministic slot.",
      })),
    };
    const firstRoute = adaptSessionResourceToStudyRoute({
      plan: currentPlan,
      session: { ...currentPlan.sessions[0]!, resource: first },
    }).route!;
    const secondRoute = adaptSessionResourceToStudyRoute({
      plan: currentPlan,
      session: { ...currentPlan.sessions[0]!, resource: second },
    }).route!;

    expect({
      target: firstRoute.target,
      approach: firstRoute.approach,
      timing: firstRoute.timing,
      execution: firstRoute.execution,
    }).toEqual({
      target: secondRoute.target,
      approach: secondRoute.approach,
      timing: secondRoute.timing,
      execution: secondRoute.execution,
    });
  });

  it("projects only route-owned values back into the legacy session contract", () => {
    const currentPlan = plan();
    const route = legacyPlanSessionToStudyRoute({ plan: currentPlan, session: currentPlan.sessions[0]! })!;

    expect(studyRouteToLegacySessionProjection(route)).toEqual({
      method: currentPlan.sessions[0]!.method,
      methodReason: currentPlan.sessions[0]!.methodReason,
      estimatedMinutes: currentPlan.sessions[0]!.estimatedMinutes,
      learningMode: currentPlan.sessions[0]!.learningMode,
      topicIds: currentPlan.sessions[0]!.topicIds,
      completionEvidence: currentPlan.sessions[0]!.completionEvidence,
    });
  });
});

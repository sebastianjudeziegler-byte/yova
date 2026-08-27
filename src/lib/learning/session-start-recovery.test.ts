import { describe, expect, it, vi } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionInterruption,
  SessionResource,
} from "@/lib/domain";
import {
  fingerprintSessionResource,
  type ActiveSessionCheckpointV1,
} from "@/lib/learning/active-session-checkpoint";
import { sessionStartRecoveryDecision } from "@/lib/learning/session-start-recovery";
import { createCommittedInitialSessionStudyRoute } from "@/lib/study-route/session-route-creation";

const PLAN_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const TOPIC_ID = "00000000-0000-4000-8000-000000000009";
const GENERATED_AT = "2026-08-20T15:30:00.000Z";

function resource(): SessionResource {
  return {
    schemaVersion: 15,
    topicIds: [TOPIC_ID],
    rationale: "Retrieve the main ideas, then explain their relationship.",
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "retrieval_practice",
      name: "Retrieval practice",
      what: "Retrieve the relationship before reviewing the correction.",
      why: "An unsupported attempt makes the current gap visible.",
      how: ["Retrieve the relationship.", "Repair the exposed gap."],
      completion: "Complete the retrieval and typed repair.",
      personalization: [],
    },
    generatedAt: GENERATED_AT,
    origin: "generated",
    activities: [
      {
        topicId: null,
        methodPhase: "orient",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        type: "instruction",
        concept: null,
        label: "Recall",
        title: "Retrieve the model",
        body: "Close the source and retrieve each relationship before checking it.",
        choices: [],
        correctAnswer: null,
        feedback: null,
        methodRuntime: {
          kind: "retrieval_round",
          sourceClosedReminder: "Close the source before starting this retrieval round.",
          prompts: [
            { prompt: "Name the first relationship.", expectedAnswer: "The first answer", hint: null },
            { prompt: "Name the second relationship.", expectedAnswer: "The second answer", hint: null },
            { prompt: "Connect both relationships.", expectedAnswer: "The connection", hint: null },
          ],
        },
      },
      {
        topicId: TOPIC_ID,
        methodPhase: "retrieve",
        estimatedMinutes: 2,
        requiredForCompletion: true,
        type: "multiple_choice",
        concept: "Model check",
        label: "Check",
        title: "Check the relationship",
        body: "Which option preserves the relationship?",
        choices: ["The first answer", "A distractor"],
        correctAnswer: "The first answer",
        feedback: "The first answer preserves the relationship.",
        methodRuntime: null,
      },
      {
        topicId: TOPIC_ID,
        methodPhase: "repair",
        estimatedMinutes: 2,
        requiredForCompletion: true,
        type: "free_response",
        concept: "Model check",
        label: "Repair",
        title: "Repair the relationship",
        body: "Explain the relationship accurately in your own words after checking the correction.",
        choices: [],
        correctAnswer: "The first relationship leads to the second through the stated mechanism.",
        feedback: "A strong repair states both parts of the relationship and the mechanism connecting them.",
        methodRuntime: null,
      },
    ],
  };
}

function session(overrides: Partial<LearningPlanSession> = {}): LearningPlanSession {
  return {
    id: SESSION_ID,
    sequence: 1,
    title: "Build a stable mental model",
    objective: "Explain the main relationships from memory.",
    method: "Retrieval practice",
    methodReason: "Retrieval reveals what is actually available from memory.",
    scheduledFor: "2026-08-20T16:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "About 15 minutes",
    learningMode: "study",
    topicIds: [TOPIC_ID],
    contentTargets: ["The main model relationship"],
    completionEvidence: ["Explain the main model relationship accurately without notes"],
    status: "ready",
    ...overrides,
  };
}

function plan(planSession: LearningPlanSession): LearningPlan {
  return {
    id: PLAN_ID,
    learningItemId: "00000000-0000-4000-8000-000000000003",
    title: "Arbitrary topic",
    topic: "A topic without a hardcoded template",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Use short retrieval sessions to build durable understanding.",
    createdAt: "2026-08-20T15:00:00.000Z",
    knowledgeMap: {
      version: 1,
      scopeJudgment: {
        band: "focused_skill",
        label: "Main model relationship",
        minimumSessions: 1,
        recommendedSessions: 1,
        maximumSessions: 2,
        minimumTeachingSessions: 0,
        explanation: "This focused relationship fits one short retrieval and repair session.",
      },
      topics: [{
        id: TOPIC_ID,
        title: "Main model relationship",
        description: "Explain how the two parts of the main model relate to one another.",
        subtopics: ["First relationship", "Second relationship"],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
      }],
      placementCheck: {
        status: "available",
        completedAt: null,
        demonstratedTopicIds: [],
        gapTopicIds: [],
      },
    },
    sessions: [planSession],
  };
}

function sessionWithCommittedRoute(
  overrides: Partial<LearningPlanSession> = {},
): LearningPlanSession {
  const unrouted = session({ ...overrides, studyRoute: undefined });
  const studyRoute = createCommittedInitialSessionStudyRoute({
    plan: plan(unrouted),
    session: unrouted,
    now: "2026-08-20T15:15:00.000Z",
    origin: {
      source: "plan_activation",
      reason: "The activated session committed its learner-visible study route.",
    },
  });
  return { ...unrouted, studyRoute };
}

function checkpoint(overrides: Partial<ActiveSessionCheckpointV1> = {}): ActiveSessionCheckpointV1 {
  return {
    version: 1,
    accountId: "learner_alpha",
    runId: "00000000-0000-4000-8000-000000000004",
    planId: PLAN_ID,
    planSessionId: SESSION_ID,
    status: "working",
    startedAt: "2026-08-20T15:25:00.000Z",
    savedAt: "2026-08-20T15:31:00.000Z",
    activeSeconds: 360,
    plannedMinutes: 15,
    completedSteps: 1,
    totalSteps: 3,
    resumeStep: 1,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: GENERATED_AT,
    ...overrides,
  } as ActiveSessionCheckpointV1;
}

function interruption(): SessionInterruption {
  return {
    id: "00000000-0000-4000-8000-000000000005",
    planId: PLAN_ID,
    planSessionId: SESSION_ID,
    startedAt: "2026-08-20T15:20:00.000Z",
    interruptedAt: "2026-08-20T15:32:00.000Z",
    plannedMinutes: 15,
    actualMinutes: 12,
    completedSteps: 1,
    totalSteps: 3,
  };
}

describe("session start recovery decision", () => {
  it("continues a pre-methodRuntime checkpoint without reserving or generating again", () => {
    const currentResource = resource();
    const legacyResource: SessionResource = {
      ...currentResource,
      activities: currentResource.activities.map((activity) => Object.fromEntries(
        Object.entries(activity).filter(([key]) => key !== "methodRuntime"),
      ) as SessionResource["activities"][number]),
    };
    const readySession = session({ resource: currentResource });
    const oldCheckpoint = checkpoint({
      resourceFingerprint: fingerprintSessionResource(legacyResource),
      resourceGeneratedAt: "2026-08-20T15:30:00+00:00",
    });

    expect(oldCheckpoint.resourceFingerprint).not.toBe(fingerprintSessionResource(currentResource));
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [],
      restorableCheckpoints: [oldCheckpoint],
    });
    const reserve = vi.fn();
    const generate = vi.fn();
    if (decision.requiresGeneration) {
      reserve();
      generate();
    }

    expect(decision).toMatchObject({
      advertiseContinue: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
    expect(decision.resumePoint?.completedSteps).toBe(1);
    expect(reserve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not advertise a historical interruption as a restorable checkpoint", () => {
    const readySession = session();
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [interruption()],
      restorableCheckpoints: [],
    });

    expect(decision).toMatchObject({
      resumePoint: null,
      advertiseContinue: false,
      canStartWithoutGeneration: false,
      requiresGeneration: true,
    });
  });

  it("continues a checkpoint from the duplicated-methodRuntime rollout", () => {
    const currentResource = resource();
    const methodRuntime = currentResource.activities.find((activity) => activity.methodRuntime)?.methodRuntime;
    expect(methodRuntime).toBeTruthy();
    const duplicatedRuntimeResource: SessionResource = {
      ...currentResource,
      activities: currentResource.activities.map((activity) => ({
        ...activity,
        methodRuntime: methodRuntime ?? null,
      })),
    };
    const readySession = session({ resource: currentResource });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [],
      restorableCheckpoints: [checkpoint({
        resourceFingerprint: fingerprintSessionResource(duplicatedRuntimeResource),
      })],
    });

    expect(fingerprintSessionResource(duplicatedRuntimeResource))
      .not.toBe(fingerprintSessionResource(currentResource));
    expect(decision).toMatchObject({
      advertiseContinue: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
  });

  it("labels a cached lesson with unverifiable historical progress as Start, not Continue", () => {
    const readySession = session({ resource: resource() });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [interruption()],
      restorableCheckpoints: [],
    });

    expect(decision).toMatchObject({
      resumePoint: null,
      advertiseContinue: false,
      cachedResourceRestorable: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
  });

  it("does not hydrate routed generated or built-in lessons without the exact top-level route receipt", () => {
    const missingReceipt = sessionWithCommittedRoute({ resource: resource() });
    const wrongReceipt = {
      ...missingReceipt,
      resource: {
        ...resource(),
        routeRevisionId: "00000000-0000-4000-8000-000000000099",
      },
    };
    const missingBuiltInReceipt = {
      ...missingReceipt,
      resource: { ...resource(), origin: "built_in" as const },
    };
    const wrongBuiltInReceipt = {
      ...wrongReceipt,
      resource: { ...wrongReceipt.resource, origin: "built_in" as const },
    };

    for (const readySession of [
      missingReceipt,
      wrongReceipt,
      missingBuiltInReceipt,
      wrongBuiltInReceipt,
    ]) {
      expect(sessionStartRecoveryDecision({
        plan: plan(readySession),
        session: readySession,
        interruptions: [],
        restorableCheckpoints: [],
      })).toMatchObject({
        cachedResourceRestorable: false,
        canStartWithoutGeneration: false,
        requiresGeneration: true,
      });
    }
  });

  it("hydrates generated and built-in resources carrying the exact committed route receipt", () => {
    const routed = sessionWithCommittedRoute();
    const routeRevisionId = routed.studyRoute!.identity.routeRevisionId;
    const generated = {
      ...routed,
      resource: { ...resource(), routeRevisionId },
    };
    const builtIn = {
      ...routed,
      resource: { ...resource(), routeRevisionId, origin: "built_in" as const },
    };

    for (const readySession of [generated, builtIn]) {
      expect(sessionStartRecoveryDecision({
        plan: plan(readySession),
        session: readySession,
        interruptions: [],
        restorableCheckpoints: [],
      })).toMatchObject({
        cachedResourceRestorable: true,
        canStartWithoutGeneration: true,
        requiresGeneration: false,
      });
    }
  });

  it("does not relabel an immutable route through a generated or built-in resource", () => {
    const routed = sessionWithCommittedRoute();
    const routeRevisionId = routed.studyRoute!.identity.routeRevisionId;

    for (const origin of ["generated", "built_in"] as const) {
      const readySession = {
        ...routed,
        resource: {
          ...resource(),
          origin,
          routeRevisionId,
          methodBriefing: {
            ...resource().methodBriefing!,
            name: "Active Recall",
          },
        },
      };
      expect(sessionStartRecoveryDecision({
        plan: plan(readySession),
        session: readySession,
        interruptions: [],
        restorableCheckpoints: [],
      })).toMatchObject({
        cachedResourceRestorable: false,
        canStartWithoutGeneration: false,
        requiresGeneration: true,
      });
    }
  });

  it("does not hydrate a routed resource whose cache context omits or changes the route receipt", () => {
    const routed = sessionWithCommittedRoute();
    const routeRevisionId = routed.studyRoute!.identity.routeRevisionId;
    const cacheContext = {
      effectiveMinutes: 15,
      adjustmentFingerprint: "a".repeat(64),
      scopeFingerprint: "sc1:0123456789abcdef",
    };
    const missingContextReceipt = {
      ...routed,
      resource: { ...resource(), routeRevisionId, cacheContext },
    };
    const wrongContextReceipt = {
      ...routed,
      resource: {
        ...resource(),
        origin: "built_in" as const,
        routeRevisionId,
        cacheContext: {
          ...cacheContext,
          routeRevisionId: "00000000-0000-4000-8000-000000000098",
        },
      },
    };

    for (const readySession of [missingContextReceipt, wrongContextReceipt]) {
      expect(sessionStartRecoveryDecision({
        plan: plan(readySession),
        session: readySession,
        interruptions: [],
        restorableCheckpoints: [],
      })).toMatchObject({
        cachedResourceRestorable: false,
        canStartWithoutGeneration: false,
        requiresGeneration: true,
      });
    }
  });

  it("continues an explicit-exit handoff only when its fresh run is bound to the cached lesson", () => {
    const currentResource = resource();
    const readySession = session({ resource: currentResource });
    const exitHandoff = checkpoint({
      runId: "00000000-0000-4000-8000-000000000006",
      savedAt: "2026-08-20T15:32:00.001Z",
      resourceFingerprint: fingerprintSessionResource(currentResource),
      resourceGeneratedAt: currentResource.generatedAt,
    });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [interruption()],
      restorableCheckpoints: [exitHandoff],
    });

    expect(decision).toMatchObject({
      advertiseContinue: true,
      cachedResourceRestorable: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
    expect(decision.resumePoint).toMatchObject({
      source: "active_session_checkpoint",
      runId: exitHandoff.runId,
      completedSteps: exitHandoff.completedSteps,
      resourceFingerprint: exitHandoff.resourceFingerprint,
    });
  });

  it("recognizes a cloud-canonical handoff when server savedAt trails the browser exit clock", () => {
    const currentResource = resource();
    const readySession = session({ resource: currentResource });
    const savedExit = interruption();
    const cloudHandoff = checkpoint({
      runId: "00000000-0000-4000-8000-000000000008",
      startedAt: savedExit.startedAt,
      savedAt: "2026-08-20T15:31:59.000Z",
      plannedMinutes: savedExit.plannedMinutes,
      resourceFingerprint: fingerprintSessionResource(currentResource),
      resourceGeneratedAt: currentResource.generatedAt,
    });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [savedExit],
      restorableCheckpoints: [cloudHandoff],
    });

    expect(decision).toMatchObject({
      advertiseContinue: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
    expect(decision.resumePoint).toMatchObject({
      runId: cloudHandoff.runId,
      interruptedAt: savedExit.interruptedAt,
      completedSteps: savedExit.completedSteps,
    });
  });

  it("does not apply exit progress to a regenerated cached lesson", () => {
    const priorResource = resource();
    const regeneratedResource: SessionResource = {
      ...priorResource,
      generatedAt: "2026-08-20T15:33:00.000Z",
      activities: priorResource.activities.map((activity, index) => index === 0
        ? { ...activity, body: "Use a new model and retrieve its updated relationships." }
        : activity),
    };
    const readySession = session({ resource: regeneratedResource });
    const staleExitHandoff = checkpoint({
      runId: "00000000-0000-4000-8000-000000000007",
      savedAt: "2026-08-20T15:32:00.001Z",
      resourceFingerprint: fingerprintSessionResource(priorResource),
      resourceGeneratedAt: priorResource.generatedAt,
    });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [interruption()],
      restorableCheckpoints: [staleExitHandoff],
    });

    expect(decision).toMatchObject({
      resumePoint: null,
      advertiseContinue: false,
      cachedResourceRestorable: true,
      canStartWithoutGeneration: true,
      requiresGeneration: false,
    });
  });

  it("fails closed when the learner changes setup before a cached start", () => {
    const readySession = session({ resource: resource() });
    const decision = sessionStartRecoveryDecision({
      plan: plan(readySession),
      session: readySession,
      interruptions: [],
      restorableCheckpoints: [],
      sessionAdjustment: {
        familiarity: "challenge_me",
        availableMinutes: 10,
        knownTargets: [],
        note: "Use a harder application.",
      },
    });

    expect(decision).toMatchObject({
      resumePoint: null,
      advertiseContinue: false,
      cachedResourceRestorable: false,
      canStartWithoutGeneration: false,
      requiresGeneration: true,
    });
  });
});

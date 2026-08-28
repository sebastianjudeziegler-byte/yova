import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LearningPlan,
  SessionCompletion,
  SessionInterruption,
  YovaPreviewSnapshot,
} from "@/lib/domain";
import { loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";
import { LEARNER_ANSWER_COUNT } from "@/lib/personalization/learner-profile";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  readPersonalizationStateFromAnswers,
  serializePersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { legacyPlanSessionToStudyRoute } from "@/lib/study-route/adapters";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const STORAGE_KEY = "yova.preview.v1";
const ROUTE_LINEAGE_ID = "00000000-0000-4000-8000-000000000021";
const ROUTE_REVISION_ID = "00000000-0000-4000-8000-000000000022";

function interruption(): SessionInterruption {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    planId: "00000000-0000-4000-8000-000000000002",
    planSessionId: "00000000-0000-4000-8000-000000000003",
    startedAt: "2026-08-11T20:00:00.000Z",
    interruptedAt: "2026-08-11T20:08:00.000Z",
    plannedMinutes: 20,
    actualMinutes: 8,
    completedSteps: 2,
    totalSteps: 5,
    sessionAdjustment: {
      familiarity: "need_teaching",
      availableMinutes: 20,
      knownTargets: ["ATP coupling"],
      note: "Connect this to cellular respiration.",
    },
    activityProgress: {
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: ["partly"],
    },
  };
}

function snapshot(
  sessionInterruption: SessionInterruption,
  onboardingAnswers: string[] = [],
): YovaPreviewSnapshot {
  return {
    version: 1,
    account: null,
    signedIn: false,
    onboardingAnswers,
    onboardingCompleted: true,
    alphaEntered: true,
    plans: [],
    sessionCompletions: [],
    sessionInterruptions: [sessionInterruption],
    updatedAt: "2026-08-11T20:08:00.000Z",
  };
}

function completion(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    id: "00000000-0000-4000-8000-000000000011",
    planId: "00000000-0000-4000-8000-000000000012",
    planSessionId: "00000000-0000-4000-8000-000000000013",
    startedAt: "2026-08-11T20:00:00.000Z",
    completedAt: "2026-08-11T20:08:00.000Z",
    plannedMinutes: 20,
    actualMinutes: 8,
    correctAnswers: 0,
    totalAnswers: 0,
    feedback: "about_right",
    observedGap: "No topic evidence recorded.",
    conceptEvidence: [],
    confidenceEvidence: [],
    ...overrides,
  };
}

function planWithCanonicalRoute(): LearningPlan {
  const plan: LearningPlan = {
    id: "00000000-0000-4000-8000-000000000031",
    learningItemId: "00000000-0000-4000-8000-000000000032",
    title: "Cellular respiration",
    topic: "Cellular respiration pathways",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "learn",
    rationale: "Build an accurate model before checking it from memory.",
    createdAt: "2026-08-11T19:00:00.000Z",
    sessions: [{
      id: "00000000-0000-4000-8000-000000000033",
      sequence: 1,
      title: "Explain cellular respiration",
      objective: "Explain how energy moves through the stages of cellular respiration.",
      method: "Self-explanation",
      methodReason: "An explanation exposes missing links in the causal model.",
      scheduledFor: "2026-08-11T20:00:00.000Z",
      estimatedMinutes: 20,
      amountLabel: "One pathway · about 20 min",
      learningMode: "learn",
      contentTargets: ["Cellular respiration pathway"],
      completionEvidence: ["Explain the pathway without looking at the model."],
      status: "ready",
    }],
  };
  const session = plan.sessions[0]!;
  const studyRoute = legacyPlanSessionToStudyRoute({
    plan,
    session,
    adaptedAt: "2026-08-11T19:01:00.000Z",
    identity: {
      routeLineageId: ROUTE_LINEAGE_ID,
      routeRevisionId: ROUTE_REVISION_ID,
      lifecycleStatus: "committed",
      createdAt: "2026-08-11T19:00:00.000Z",
      committedAt: "2026-08-11T19:01:00.000Z",
    },
  });
  if (!studyRoute) throw new Error("Expected the canonical test route to be classifiable.");
  session.studyRoute = studyRoute;
  return plan;
}

function planWithObservedDurationRoute(): LearningPlan {
  const plan = planWithCanonicalRoute();
  const session = plan.sessions[0]!;
  const route = structuredClone(session.studyRoute!);
  const phaseCount = route.execution.orderedPhases.length;
  route.execution.orderedPhases = route.execution.orderedPhases.map((phase, index) => ({
    ...phase,
    activeMinutes: index === 0 ? 15 - (phaseCount - 1) : 1,
  }));
  route.timing = {
    activeMinutes: 15,
    elapsedMinutes: 15,
    durationSource: "observed_outcome_adjustment",
    hardMaximumMinutes: 25,
  };
  route.provenance = {
    ...route.provenance,
    routerVersion: `${route.provenance.routerVersion}+normal_duration_recommender_v1`,
    profileVersion: "normal_duration_context_v1+profile_revision_test",
    evidenceRefs: [
      ...route.provenance.evidenceRefs,
      "completion:00000000-0000-4000-8000-000000000041",
    ],
    ruleTrace: [
      ...route.provenance.ruleTrace,
      {
        ruleId: "duration.recommendation.repeated_early_exits",
        result: "lowered_to_15_minutes",
        reason: "Two recent comparable sessions ended before most planned work was reached.",
        evidenceRefs: ["completion:00000000-0000-4000-8000-000000000041"],
      },
    ],
  };
  session.estimatedMinutes = 15;
  session.amountLabel = "One pathway · about 15 min";
  session.studyRoute = StudyRouteSchema.parse(route);
  return plan;
}

function installMemoryStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preview interruption persistence", () => {
  it("round-trips the exact setup used to generate the lesson", () => {
    installMemoryStorage();
    const original = interruption();

    savePreviewSnapshot(snapshot(original));

    expect(loadPreviewSnapshot()?.sessionInterruptions[0]?.sessionAdjustment).toEqual(
      original.sessionAdjustment,
    );
    expect(loadPreviewSnapshot()?.sessionInterruptions[0]?.activityProgress).toEqual(
      original.activityProgress,
    );
  });

  it("drops malformed or text-bearing activity progress", () => {
    const localStorage = installMemoryStorage();
    const malformed = snapshot(interruption()) as unknown as Record<string, unknown>;
    const storedInterruption = (malformed.sessionInterruptions as Array<Record<string, unknown>>)[0]!;
    storedInterruption.activityProgress = {
      kind: "retrieval_round",
      activityIndex: 0,
      promptCount: 3,
      ratings: ["partly"],
      answerDraft: "PRIVATE RECALL DRAFT",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));

    expect(loadPreviewSnapshot()?.sessionInterruptions[0]).not.toHaveProperty("activityProgress");
  });

  it("persists broad-recall interruption progress only with an exact route revision", () => {
    installMemoryStorage();
    const broadProgress = {
      kind: "broad_recall" as const,
      format: "broad_recall_v1" as const,
      activityIndex: 0,
      gapCount: 1,
      bindings: [{
        targetId: "11111111-1111-4111-8111-111111111111",
        evidenceId: "blurting-final-check:11111111-1111-4111-8111-111111111111",
      }],
      events: [],
    };
    const routeLess = {
      ...interruption(),
      completedSteps: 0,
      activityProgress: broadProgress,
    };

    savePreviewSnapshot(snapshot(routeLess));
    expect(loadPreviewSnapshot()?.sessionInterruptions[0])
      .not.toHaveProperty("activityProgress");

    const routeBound = { ...routeLess, routeRevisionId: ROUTE_REVISION_ID };
    savePreviewSnapshot(snapshot(routeBound));
    expect(loadPreviewSnapshot()?.sessionInterruptions[0]).toMatchObject({
      routeRevisionId: ROUTE_REVISION_ID,
      activityProgress: broadProgress,
    });
  });

  it("removes a malformed setup snapshot instead of trusting stored browser data", () => {
    const localStorage = installMemoryStorage();
    const malformed = snapshot(interruption()) as unknown as Record<string, unknown>;
    const storedInterruption = (malformed.sessionInterruptions as Array<Record<string, unknown>>)[0]!;
    storedInterruption.sessionAdjustment = {
      familiarity: "need_teaching",
      availableMinutes: 5,
      knownTargets: ["ATP coupling"],
      note: "",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));

    expect(loadPreviewSnapshot()?.sessionInterruptions[0]).not.toHaveProperty("sessionAdjustment");
  });
});

describe("preview completion provenance", () => {
  it("defaults a legacy completion to guided", () => {
    const localStorage = installMemoryStorage();
    const legacy = snapshot(interruption());
    legacy.sessionCompletions = [completion()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    expect(loadPreviewSnapshot()?.sessionCompletions[0]?.completionMode).toBe("guided");
  });

  it("round-trips unguided practice provenance", () => {
    installMemoryStorage();
    const stored = snapshot(interruption());
    stored.sessionCompletions = [completion({ completionMode: "unguided_practice" })];

    savePreviewSnapshot(stored);

    expect(loadPreviewSnapshot()?.sessionCompletions[0]?.completionMode).toBe("unguided_practice");
  });
});

describe("preview StudyRoute persistence", () => {
  it("round-trips a valid canonical route without changing its revision identity", () => {
    installMemoryStorage();
    const stored = snapshot(interruption());
    const plan = planWithCanonicalRoute();
    stored.plans = [plan];

    savePreviewSnapshot(stored);

    const restoredSession = loadPreviewSnapshot()?.plans[0]?.sessions[0];
    expect(restoredSession?.studyRoute).toEqual(plan.sessions[0]?.studyRoute);
    expect(restoredSession?.studyRoute?.identity.routeRevisionId).toBe(ROUTE_REVISION_ID);
  });

  it("round-trips an outcome-adjusted duration with its full decision provenance", () => {
    installMemoryStorage();
    const stored = snapshot(interruption());
    const plan = planWithObservedDurationRoute();
    stored.plans = [plan];

    savePreviewSnapshot(stored);

    const restoredSession = loadPreviewSnapshot()?.plans[0]?.sessions[0];
    expect(restoredSession?.estimatedMinutes).toBe(15);
    expect(restoredSession?.studyRoute).toEqual(plan.sessions[0]?.studyRoute);
    expect(restoredSession?.studyRoute).toMatchObject({
      timing: {
        activeMinutes: 15,
        durationSource: "observed_outcome_adjustment",
        hardMaximumMinutes: 25,
      },
      provenance: {
        profileVersion: "normal_duration_context_v1+profile_revision_test",
        ruleTrace: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "duration.recommendation.repeated_early_exits",
          }),
        ]),
      },
    });
  });

  it("drops a malformed route but keeps the rest of the plan and session usable", () => {
    const localStorage = installMemoryStorage();
    const stored = snapshot(interruption());
    stored.plans = [planWithCanonicalRoute()];
    const raw = stored as unknown as {
      plans: Array<{ sessions: Array<{ studyRoute?: { identity: { routeRevisionId: string } } }> }>;
    };
    raw.plans[0]!.sessions[0]!.studyRoute!.identity.routeRevisionId = "not-a-route-revision";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const restored = loadPreviewSnapshot();
    expect(restored?.plans).toHaveLength(1);
    expect(restored?.plans[0]?.sessions).toHaveLength(1);
    expect(restored?.plans[0]?.sessions[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000033",
      title: "Explain cellular respiration",
      method: "Self-explanation",
      estimatedMinutes: 20,
    });
    expect(restored?.plans[0]?.sessions[0]).not.toHaveProperty("studyRoute");
  });

  it("preserves route identity on terminal completion and interruption records", () => {
    installMemoryStorage();
    const routeBoundInterruption = interruption();
    routeBoundInterruption.routeRevisionId = ROUTE_REVISION_ID;
    const stored = snapshot(routeBoundInterruption);
    stored.sessionCompletions = [completion({ routeRevisionId: ROUTE_REVISION_ID })];

    savePreviewSnapshot(stored);

    const restored = loadPreviewSnapshot();
    expect(restored?.sessionCompletions[0]?.routeRevisionId).toBe(ROUTE_REVISION_ID);
    expect(restored?.sessionInterruptions[0]?.routeRevisionId).toBe(ROUTE_REVISION_ID);
  });
});

describe("preview profile persistence", () => {
  it("round-trips the reserved personalization-state answer", () => {
    installMemoryStorage();
    const state = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...state,
      controls: { ...state.controls, selfReport: false },
      workspace: { ...state.workspace, layout: "one_step" },
    });

    savePreviewSnapshot(snapshot(interruption(), answers));

    const restored = loadPreviewSnapshot()?.onboardingAnswers ?? [];
    expect(restored).toHaveLength(LEARNER_ANSWER_COUNT);
    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe(
      answers[PERSONALIZATION_STATE_ANSWER_INDEX],
    );
    expect(readPersonalizationStateFromAnswers(restored)).toMatchObject({
      controls: { selfReport: false },
      workspace: { layout: "one_step" },
    });
  });

  it("loads legacy answer arrays with an empty reserved state slot", () => {
    const localStorage = installMemoryStorage();
    const legacy = snapshot(interruption(), Array.from({ length: 16 }, () => ""));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const restored = loadPreviewSnapshot()?.onboardingAnswers ?? [];

    expect(restored).toHaveLength(LEARNER_ANSWER_COUNT);
    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe("");
  });

  it("replaces malformed browser state with safe defaults", () => {
    const localStorage = installMemoryStorage();
    const answers = Array.from({ length: LEARNER_ANSWER_COUNT }, () => "");
    answers[PERSONALIZATION_STATE_ANSWER_INDEX] = "malformed state payload";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(interruption(), answers)));

    const restored = loadPreviewSnapshot()?.onboardingAnswers ?? [];

    expect(restored[PERSONALIZATION_STATE_ANSWER_INDEX]).toBe(
      serializePersonalizationState(defaultPersonalizationState()),
    );
    expect(readPersonalizationStateFromAnswers(restored)).toEqual(defaultPersonalizationState());
  });
});

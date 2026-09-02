import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan, LearningPlanSession, SessionInterruption } from "@/lib/domain";
import {
  loadActiveSessionCheckpoints,
  saveActiveSessionCheckpoint,
  type ActiveSessionCheckpointV1,
  type ActiveSessionCheckpointV2,
} from "@/lib/learning/active-session-checkpoint";
import { UpdateMilestoneRequestSchema } from "@/lib/milestones/schema";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import {
  createCommittedInitialSessionStudyRoute,
  createCommittedScalarSuccessorStudyRoute,
} from "@/lib/study-route/session-route-creation";
import type { StudyRoute } from "@/lib/study-route/schema";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import {
  CloudAccountIdentityMismatchError,
  CloudSyncTemporarilyUnavailableError,
} from "@/lib/supabase/cloud-sync-error";

const { from, getUser, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { getUser }, from, rpc }),
}));

import {
  AUTHENTICATED_LEARNING_MUTATION_DEADLINE_MS,
  ActiveSessionCheckpointConflictError,
  ActiveSessionCheckpointTerminalError,
  activateAuthenticatedConceptReviewSession,
  cancelAuthenticatedLearnerProfileWrites,
  completeAuthenticatedPlanSession,
  deleteAuthenticatedActiveSessionCheckpoint,
  loadAuthenticatedLearningState,
  loadAuthenticatedLearningStateWithRetry,
  recordAuthenticatedSessionInterruption as persistAuthenticatedSessionInterruption,
  saveAuthenticatedActiveSessionCheckpoint,
  saveAuthenticatedLearnerProfile,
  type CloudLearningState,
} from "@/lib/supabase/learning-state-repository";

const NOW = "2026-08-17T18:00:00.000Z";
const ROUTE_REVISION_ID = "00000000-0000-4000-8000-000000000099";

function recordAuthenticatedSessionInterruption(interruption: SessionInterruption) {
  return persistAuthenticatedSessionInterruption("user-1", interruption);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.clearAllMocks();
  from.mockReset();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authenticated learning-state startup", () => {
  it("retries a transient empty read before restoring an existing learner", async () => {
    const restored = cloudState({ onboardingCompleted: true, displayName: "Existing learner" });
    const read = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(restored);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [25], wait)).resolves.toBe(restored);

    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it("retries a transient profile-query failure before making an onboarding decision", async () => {
    const restored = cloudState({ onboardingCompleted: true });
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("YOVA could not load your cloud learning profile."))
      .mockResolvedValueOnce(restored);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [0], async () => undefined))
      .resolves.toBe(restored);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("accepts a real new-account profile without delaying or retrying onboarding", async () => {
    const newLearner = cloudState({ onboardingCompleted: false });
    const read = vi.fn().mockResolvedValue(newLearner);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(loadAuthenticatedLearningStateWithRetry(read, [25, 50], wait)).resolves.toBe(newLearner);

    expect(read).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("does not reinterpret a missing mandatory profile row as a new learner", async () => {
    mockCloudQueries({ profile: null });

    await expect(loadAuthenticatedLearningState())
      .rejects.toThrow("could not load your cloud learning profile");
  });

  it("loads only fresh, valid, account-owned checkpoints from session step data", async () => {
    const valid = checkpoint();
    const rawAnswer = {
      ...checkpoint({
        planSessionId: "00000000-0000-4000-8000-000000000013",
        runId: "00000000-0000-4000-8000-000000000014",
      }),
      evidence: {
        ...checkpoint().evidence,
        learnerAnswer: "Private draft answer",
      },
    };
    const wrongAccount = checkpoint({
      accountId: "user-2",
      planSessionId: "00000000-0000-4000-8000-000000000015",
      runId: "00000000-0000-4000-8000-000000000016",
    });
    const expired = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000017",
      runId: "00000000-0000-4000-8000-000000000018",
      savedAt: "2026-08-01T18:00:00.000Z",
    });
    const legacyWithoutLessonIdentity = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000019",
      runId: "00000000-0000-4000-8000-000000000020",
    });
    delete (legacyWithoutLessonIdentity as Partial<ActiveSessionCheckpointV1>).resourceGeneratedAt;
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      sessions: [
        sessionRow(valid),
        sessionRow(rawAnswer as ActiveSessionCheckpointV1),
        sessionRow(wrongAccount),
        sessionRow(expired),
        sessionRow(legacyWithoutLessonIdentity),
      ],
    });

    const state = await loadAuthenticatedLearningState();

    expect(state?.activeSessionCheckpoints).toEqual([valid]);
  });

  it("loads the exact committed route and its matching version-two checkpoint", async () => {
    const { plan, session, route } = committedRouteFixture();
    const checkpointV2 = routeCheckpoint({
      planId: plan.id,
      planSessionId: session.id,
      routeRevisionId: route.identity.routeRevisionId,
    });
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [learningItemRow(plan)],
      plans: [planRow(plan)],
      sessions: [{
        ...planSessionRow(plan, session),
        step_data: { activeSessionCheckpoint: checkpointV2 },
        committed_route_revision_id: route.identity.routeRevisionId,
      }],
      routes: [studyRouteRow(route)],
    });

    const state = await loadAuthenticatedLearningState();

    expect(state?.plans[0]?.sessions[0]?.studyRoute).toEqual(route);
    expect(state?.activeSessionCheckpoints).toEqual([checkpointV2]);
  });

  it("fails closed when a session pointer cannot resolve its committed route", async () => {
    const { plan, session, route } = committedRouteFixture();
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [learningItemRow(plan)],
      plans: [planRow(plan)],
      sessions: [{
        ...planSessionRow(plan, session),
        committed_route_revision_id: route.identity.routeRevisionId,
      }],
      routes: [],
    });

    await expect(loadAuthenticatedLearningState())
      .rejects.toThrow("could not verify a saved study route");
  });

  it("repairs already-persisted dangling titles while loading signed-in learning state", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [
        {
          id: "item-krebs",
          title: "Understand How the Krebs Cycle Actually Produces Nadh and",
          kind: "topic",
          topic: "I want to understand how the Krebs cycle actually produces NADH and FADH2 during the citric acid cycle",
          deadline: null,
          source_mode: "yova_generated",
          study_mode: "inside_yova",
          created_at: NOW,
        },
        {
          id: "item-economics",
          title: "Understand How Supply and Demand Curves Shift, Using My",
          kind: "topic",
          topic: "I want to understand how supply and demand curves shift, using my economics textbook",
          deadline: null,
          source_mode: "yova_generated",
          study_mode: "inside_yova",
          created_at: NOW,
        },
      ],
      plans: [
        {
          id: "plan-krebs",
          learning_item_id: "item-krebs",
          status: "active",
          rationale: "Build the causal model before checking retrieval.",
          generation_inputs: { learningIntent: "learn", intent: "plan" },
          knowledge_map: null,
          created_at: NOW,
        },
        {
          id: "plan-economics",
          learning_item_id: "item-economics",
          status: "active",
          rationale: "Build the graph model before applying it.",
          generation_inputs: { learningIntent: "learn", intent: "plan" },
          knowledge_map: null,
          created_at: NOW,
        },
      ],
    });

    const state = await loadAuthenticatedLearningState();
    const titles = state?.plans.map((plan) => plan.title) ?? [];

    expect(titles[0]).toContain("NADH and FADH2");
    expect(titles[0]).not.toContain("Nadh");
    expect(titles[1]).toBe("Understand How Supply and Demand Curves Shift…");
    expect(titles).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\b(?:and|my|using)\s*(?:…)?$/i),
    ]));
  });

  it("repairs a material-backed leading-fragment topic on signed-in reload", async () => {
    const title = "Biology Quiz on Osmosis. Be Able to Explain Water Movement, Tonicity";
    const fragment = ", and the Effects on Animal and Plant Cells Using the Attached Notes";
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [{
        id: "item-osmosis",
        title,
        kind: "test",
        topic: fragment,
        deadline: null,
        source_mode: "user_materials",
        study_mode: "inside_yova",
        created_at: NOW,
      }],
      plans: [{
        id: "plan-osmosis",
        learning_item_id: "item-osmosis",
        status: "active",
        rationale: "Use the uploaded notes for closed-note retrieval and application.",
        generation_inputs: { learningIntent: "study", intent: "plan" },
        knowledge_map: null,
        created_at: NOW,
      }],
      materials: [{
        id: "material-osmosis",
        learning_item_id: "item-osmosis",
        filename: "yova-walkthrough-osmosis-notes.txt",
        mime_type: "text/plain",
        byte_size: 1_024,
        processing_status: "ready",
        metadata: null,
      }],
    });

    const plan = (await loadAuthenticatedLearningState())?.plans[0];

    expect(plan).toMatchObject({
      title,
      topic: title,
      sourceMode: "user_materials",
    });
    expect(plan?.materials).toHaveLength(1);
    expect(plan?.title).not.toMatch(/Effects on Animal and Plant Cells Using/i);
  });

  it("projects failed and processing materials to Calendar without attaching them to a plan", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      items: [{
        id: "item-material-status",
        title: "Cell biology review",
        kind: "test",
        topic: "Cell biology",
        deadline: null,
        source_mode: "user_materials",
        study_mode: "inside_yova",
        created_at: NOW,
      }],
      plans: [{
        id: "plan-material-status",
        learning_item_id: "item-material-status",
        status: "active",
        rationale: "Use the ready source only.",
        generation_inputs: { learningIntent: "study", intent: "plan" },
        knowledge_map: null,
        created_at: NOW,
      }],
      materials: [
        {
          id: "material-ready",
          learning_item_id: "item-material-status",
          filename: "ready-notes.pdf",
          mime_type: "application/pdf",
          byte_size: 1_024,
          processing_status: "ready",
          metadata: null,
        },
        {
          id: "material-processing",
          learning_item_id: "item-material-status",
          filename: "mapping-notes.pdf",
          mime_type: "application/pdf",
          byte_size: 2_048,
          processing_status: "processing",
          metadata: null,
        },
        {
          id: "material-failed",
          learning_item_id: "item-material-status",
          filename: "broken-notes.pdf",
          mime_type: "application/pdf",
          byte_size: 3_072,
          processing_status: "failed",
          metadata: null,
        },
        {
          id: "material-unknown",
          learning_item_id: "item-material-status",
          filename: "unknown-notes.pdf",
          mime_type: "application/pdf",
          byte_size: 4_096,
          processing_status: "unexpected_status",
          metadata: null,
        },
      ],
    });

    const state = await loadAuthenticatedLearningState();
    const materialQueryIndex = from.mock.calls.findIndex(([table]) => table === "materials");
    const materialQuery = from.mock.results[materialQueryIndex]?.value as {
      eq: ReturnType<typeof vi.fn>;
    } | undefined;

    expect(state?.plans[0]?.materials).toEqual([
      expect.objectContaining({ id: "material-ready", processingStatus: "ready" }),
    ]);
    expect(materialQuery?.eq).not.toHaveBeenCalledWith("processing_status", "ready");
    expect(state?.calendarMaterials).toEqual([
      {
        id: "material-ready",
        name: "ready-notes.pdf",
        processingStatus: "ready",
        learningItemId: "item-material-status",
      },
      {
        id: "material-processing",
        name: "mapping-notes.pdf",
        processingStatus: "processing",
        learningItemId: "item-material-status",
      },
      {
        id: "material-failed",
        name: "broken-notes.pdf",
        processingStatus: "failed",
        learningItemId: "item-material-status",
      },
    ]);
  });

  it("normalizes PostgREST milestone timestamps before they can be edited", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      milestones: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Cell biology exam",
          description: "Review respiration and photosynthesis.",
          due_at: "2026-09-03T23:59:00+00:00",
          status: "open",
          linked_learning_item_id: null,
          created_at: "2026-08-19T20:42:11.987654-07:00",
        },
      ],
    });

    const state = await loadAuthenticatedLearningState();

    expect(state?.deadlineMilestones).toEqual([
      expect.objectContaining({
        dueAt: "2026-09-03T23:59:00.000Z",
        createdAt: "2026-08-20T03:42:11.987Z",
      }),
    ]);
    expect(UpdateMilestoneRequestSchema.safeParse({
      id: state?.deadlineMilestones[0]?.id,
      dueAt: state?.deadlineMilestones[0]?.dueAt,
    }).success).toBe(true);
  });

  it("keeps deadline reads fault-tolerant when one database row is malformed", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      milestones: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Invalid deadline",
          description: "This row should be ignored.",
          due_at: "not-a-timestamp",
          status: "open",
          linked_learning_item_id: null,
          created_at: "2026-08-19T18:02:44+00:00",
        },
      ],
    });

    await expect(loadAuthenticatedLearningState()).resolves.toMatchObject({
      deadlineMilestones: [],
    });
  });

  it("treats a failed deadline query as an incomplete cloud snapshot instead of an empty list", async () => {
    mockCloudQueries({
      profile: { display_name: "Learner", onboarding_completed_at: NOW },
      milestoneError: { message: "deadline query unavailable" },
    });

    await expect(loadAuthenticatedLearningState())
      .rejects.toThrow("could not load your cloud learning data");
  });
});

describe("recordAuthenticatedSessionInterruption", () => {
  it("waits for an in-flight checkpoint on the same account before sending Exit", async () => {
    const local = checkpoint();
    const interrupted = sessionInterruption({
      planId: local.planId,
      planSessionId: local.planSessionId,
    });
    let activeWrites = 0;
    let maxConcurrentWrites = 0;
    let releaseCheckpoint!: () => void;
    rpc.mockImplementation((name: string) => {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      if (name === "save_active_session_checkpoint_with_route") {
        return new Promise((resolve) => {
          releaseCheckpoint = () => {
            activeWrites -= 1;
            resolve({ data: local, error: null });
          };
        });
      }
      activeWrites -= 1;
      return Promise.resolve({ data: null, error: null });
    });

    const checkpointSave = saveAuthenticatedActiveSessionCheckpoint(local);
    const interruptionSave = persistAuthenticatedSessionInterruption(
      local.accountId,
      interrupted,
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(maxConcurrentWrites).toBe(1);
    releaseCheckpoint();
    await vi.advanceTimersByTimeAsync(0);

    await Promise.all([checkpointSave, interruptionSave]);
    expect(maxConcurrentWrites).toBe(1);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "save_active_session_checkpoint_with_route",
      "record_session_interruption_with_route",
    ]);
    expect(rpc.mock.calls[1]?.[1]?.payload).not.toHaveProperty("accountId");
  });

  it("does not make another account's interruption wait for a checkpoint", async () => {
    const local = checkpoint();
    const interrupted = sessionInterruption();
    let activeWrites = 0;
    let maxConcurrentWrites = 0;
    const releases: Array<() => void> = [];
    rpc.mockImplementation((name: string) => new Promise((resolve) => {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      releases.push(() => {
        activeWrites -= 1;
        resolve({
          data: name === "save_active_session_checkpoint_with_route" ? local : null,
          error: null,
        });
      });
    }));

    const checkpointSave = saveAuthenticatedActiveSessionCheckpoint(local);
    const interruptionSave = persistAuthenticatedSessionInterruption("user-2", interrupted);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(maxConcurrentWrites).toBe(2);
    releases.forEach((release) => release());
    await Promise.all([checkpointSave, interruptionSave]);
  });

  it("releases a timed-out checkpoint lane so the queued Exit can persist", async () => {
    const local = checkpoint();
    const interrupted = sessionInterruption();
    rpc
      .mockImplementationOnce(() => ({
        abortSignal: (signal: AbortSignal) => new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      }))
      .mockResolvedValueOnce({ data: null, error: null });

    const checkpointIssue = saveAuthenticatedActiveSessionCheckpoint(local)
      .catch((error: unknown) => error);
    const interruptionSave = persistAuthenticatedSessionInterruption(
      local.accountId,
      interrupted,
    );

    expect(rpc).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(AUTHENTICATED_LEARNING_MUTATION_DEADLINE_MS);

    expect(await checkpointIssue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    await expect(interruptionSave).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("releases a failed checkpoint lane so the queued Exit can persist", async () => {
    const local = checkpoint();
    const interrupted = sessionInterruption();
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "08006", message: "network unavailable" },
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const checkpointIssue = saveAuthenticatedActiveSessionCheckpoint(local)
      .catch((error: unknown) => error);
    const interruptionSave = persistAuthenticatedSessionInterruption(
      local.accountId,
      interrupted,
    );

    expect(await checkpointIssue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    await expect(interruptionSave).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("aborts and rejects when auth resolution or the interruption request never settles", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockImplementationOnce(() => new Promise(() => undefined));

    const result = recordAuthenticatedSessionInterruption({
      id: "00000000-0000-4000-8000-000000000091",
      planId: "00000000-0000-4000-8000-000000000092",
      planSessionId: "00000000-0000-4000-8000-000000000093",
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(AUTHENTICATED_LEARNING_MUTATION_DEADLINE_MS);
    const issue = await result;

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({ retryable: true });
    expect(consoleError).toHaveBeenCalledWith(
      "YOVA session interruption sync failed [client:deadline]",
    );
  });

  it("logs only the safe database code when interruption persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "session_interruption_conflict",
        details: "private database detail",
      },
    });

    await expect(recordAuthenticatedSessionInterruption({
      id: "00000000-0000-4000-8000-000000000001",
      planId: "00000000-0000-4000-8000-000000000002",
      planSessionId: "00000000-0000-4000-8000-000000000003",
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
    })).rejects.toThrow("could not sync the interruption");

    expect(consoleError).toHaveBeenCalledWith(
      "YOVA session interruption sync failed [40001:session_interruption_conflict]",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private");

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "private free-form database message" },
    });
    await expect(recordAuthenticatedSessionInterruption({
      id: "00000000-0000-4000-8000-000000000004",
      planId: "00000000-0000-4000-8000-000000000002",
      planSessionId: "00000000-0000-4000-8000-000000000003",
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
    })).rejects.toThrow("could not sync the interruption");
    expect(consoleError).toHaveBeenLastCalledWith(
      "YOVA session interruption sync failed [55000:unclassified]",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("free-form");
  });

  it("sends the exact setup needed to resume the generated lesson", async () => {
    const interruption: SessionInterruption = {
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

    await recordAuthenticatedSessionInterruption(interruption);

    expect(rpc).toHaveBeenCalledWith("record_session_interruption_with_route", {
      payload: expect.objectContaining({
        attemptId: interruption.id,
        sessionAdjustment: interruption.sessionAdjustment,
        activityProgress: interruption.activityProgress,
      }),
    });
  });

  it("uses the route-aware interruption wrapper without inventing activity progress", async () => {
    await recordAuthenticatedSessionInterruption({
      id: "00000000-0000-4000-8000-000000000001",
      planId: "00000000-0000-4000-8000-000000000002",
      planSessionId: "00000000-0000-4000-8000-000000000003",
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 2,
      totalSteps: 5,
    });

    expect(rpc).toHaveBeenCalledWith("record_session_interruption_with_route", {
      payload: expect.not.objectContaining({ activityProgress: expect.anything() }),
    });
  });

  it("strips a retired activity marker while preserving and saving the Exit envelope", async () => {
    const interrupted = {
      id: "00000000-0000-4000-8000-000000000031",
      planId: "00000000-0000-4000-8000-000000000032",
      planSessionId: "00000000-0000-4000-8000-000000000033",
      routeRevisionId: ROUTE_REVISION_ID,
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 0,
      totalSteps: 5,
      activityProgress: {
        kind: "broad_recall",
        legacyPayload: "ignored",
      },
    };

    await persistAuthenticatedSessionInterruption(
      "user-1",
      interrupted as unknown as SessionInterruption,
    );

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_session_interruption_with_route", {
      payload: expect.objectContaining({
        attemptId: interrupted.id,
        routeRevisionId: ROUTE_REVISION_ID,
        completedSteps: 0,
        totalSteps: 5,
      }),
    });
    expect(rpc.mock.calls[0]?.[1]?.payload).not.toHaveProperty("activityProgress");
  });

  it("binds interrupted evidence to the executed route revision", async () => {
    await recordAuthenticatedSessionInterruption({
      id: "00000000-0000-4000-8000-000000000011",
      planId: "00000000-0000-4000-8000-000000000012",
      planSessionId: "00000000-0000-4000-8000-000000000013",
      routeRevisionId: ROUTE_REVISION_ID,
      startedAt: "2026-08-11T20:00:00.000Z",
      interruptedAt: "2026-08-11T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      completedSteps: 1,
      totalSteps: 5,
      evidence: {
        correctAnswers: 1,
        totalAnswers: 1,
        conceptEvidence: [{
          concept: "ATP coupling",
          outcome: "secure",
          activityType: "free_response",
        }],
        confidenceEvidence: [{
          concept: "ATP coupling",
          confidence: "somewhat_sure",
          correct: true,
          activityType: "free_response",
        }],
        observedGap: "No major gap detected.",
        completedImmediateRepairs: 0,
      },
    });

    expect(rpc).toHaveBeenCalledWith("record_session_interruption_with_route", {
      payload: expect.objectContaining({
        routeRevisionId: ROUTE_REVISION_ID,
        evidence: expect.objectContaining({
          conceptEvidence: [expect.objectContaining({ routeRevisionId: ROUTE_REVISION_ID })],
          confidenceEvidence: [expect.objectContaining({ routeRevisionId: ROUTE_REVISION_ID })],
        }),
      }),
    });
  });
});

describe("completeAuthenticatedPlanSession", () => {
  it("uses the evidence-free transactional RPC for unguided practice", async () => {
    const verification = {
      id: "00000000-0000-4000-8000-000000000031",
      sequence: 2,
      title: "Verify thermohaline circulation",
      objective: "Complete an independent guided check for every original target.",
      method: "Independent retrieval verification",
      methodReason: "This work counted as practice, not proof.",
      scheduledFor: "2026-08-18T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "Required guided verification · about 10 min",
      learningMode: "study" as const,
      topicIds: ["00000000-0000-4000-8000-000000000035"],
      contentTargets: ["Density changes from temperature and salinity"],
      completionEvidence: ["Explain how temperature and salinity affect density."],
      status: "ready" as const,
      reviewConcept: "Thermohaline circulation",
      reviewType: "verify" as const,
    };
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000031",
      planId: "00000000-0000-4000-8000-000000000032",
      planSessionId: "00000000-0000-4000-8000-000000000033",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 0,
      totalAnswers: 0,
      feedback: "about_right",
      observedGap: "Unguided practice completed; no topic evidence was recorded.",
      completionMode: "unguided_practice",
      conceptEvidence: [],
      confidenceEvidence: [],
    }, null, verification);

    expect(rpc).toHaveBeenCalledWith("complete_plan_session_with_route", {
      payload: expect.objectContaining({
        completionVariant: "unguided_practice",
        completionMode: "unguided_practice",
        correctAnswers: 0,
        totalAnswers: 0,
        conceptEvidence: [],
        confidenceEvidence: [],
        followUpSession: expect.objectContaining({
          id: verification.id,
          topicIds: verification.topicIds,
          contentTargets: verification.contentTargets,
          completionEvidence: verification.completionEvidence,
          reviewType: "verify",
        }),
      }),
    });
  });

  it("refuses to sync unguided completion without its guided verification", async () => {
    await expect(completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000036",
      planId: "00000000-0000-4000-8000-000000000032",
      planSessionId: "00000000-0000-4000-8000-000000000033",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 0,
      totalAnswers: 0,
      feedback: "about_right",
      observedGap: "Unguided practice completed; no topic evidence was recorded.",
      completionMode: "unguided_practice",
      conceptEvidence: [],
      confidenceEvidence: [],
    })).rejects.toThrow("required guided verification");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to sync an unguided completion whose verification exceeds the scheduled-review budget", async () => {
    const completion = {
      id: "00000000-0000-4000-8000-000000000071",
      planId: "00000000-0000-4000-8000-000000000072",
      planSessionId: "00000000-0000-4000-8000-000000000073",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 0,
      totalAnswers: 0,
      feedback: "about_right" as const,
      observedGap: "Unguided practice completed; no topic evidence was recorded.",
      completionMode: "unguided_practice" as const,
      conceptEvidence: [],
      confidenceEvidence: [],
    };
    const oversizedVerification = {
      id: completion.id,
      sequence: 2,
      title: "Verify thermohaline circulation",
      objective: "Complete an independent guided check for every original target.",
      method: "Independent retrieval verification",
      methodReason: "This work counted as practice, not proof.",
      scheduledFor: "2026-08-18T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "Required guided verification · about 10 min",
      learningMode: "study" as const,
      topicIds: ["00000000-0000-4000-8000-000000000074"],
      contentTargets: [
        "Temperature changes seawater density",
        "Salinity changes seawater density",
        "Density differences drive deep-water formation",
      ],
      completionEvidence: [
        "Explain the effect of temperature on density.",
        "Explain the effect of salinity on density.",
      ],
      status: "ready" as const,
      reviewConcept: "Thermohaline circulation",
      reviewType: "verify" as const,
    };

    await expect(completeAuthenticatedPlanSession(
      completion,
      null,
      oversizedVerification,
    )).rejects.toThrow("within the ten-minute review window");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unguided verification with more than one authoritative topic", async () => {
    const completion = {
      id: "00000000-0000-4000-8000-000000000081",
      planId: "00000000-0000-4000-8000-000000000082",
      planSessionId: "00000000-0000-4000-8000-000000000083",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 0,
      totalAnswers: 0,
      feedback: "about_right" as const,
      observedGap: "Unguided practice completed; no topic evidence was recorded.",
      completionMode: "unguided_practice" as const,
      conceptEvidence: [],
      confidenceEvidence: [],
    };
    const topicIds = [
      "00000000-0000-4000-8000-000000000084",
      "00000000-0000-4000-8000-000000000085",
    ];

    await expect(completeAuthenticatedPlanSession(completion, null, {
      id: completion.id,
      sequence: 2,
      title: "Verify the mapped topic cluster",
      objective: "Complete an independent guided check for every original target.",
      method: "Independent retrieval verification",
      methodReason: "This work counted as practice, not proof.",
      scheduledFor: "2026-08-18T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "Required guided verification · about 10 min",
      learningMode: "study",
      topicIds,
      contentTargets: [
        "Explain the first mapped topic relationship",
        "Explain the second mapped topic relationship",
      ],
      completionEvidence: [
        "Answer one check about the first mapped topic.",
        "Answer one check about the second mapped topic.",
      ],
      status: "ready",
      reviewConcept: "Mapped topic cluster",
      reviewType: "verify",
    })).rejects.toThrow("within the ten-minute review window");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("routes legacy guided completions through the compatibility wrapper", async () => {
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000041",
      planId: "00000000-0000-4000-8000-000000000042",
      planSessionId: "00000000-0000-4000-8000-000000000043",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      conceptEvidence: [],
      confidenceEvidence: [],
    });

    expect(rpc).toHaveBeenCalledWith("complete_plan_session_with_route", {
      payload: expect.objectContaining({
        completionMode: "guided",
        completionVariant: "guided",
      }),
    });
  });

  it("uses the transactional continuation RPC for a time-bounded guided completion", async () => {
    const continuation = {
      id: "00000000-0000-4000-8000-000000000051",
      sequence: 2,
      title: "Continue cellular respiration",
      objective: "Learn and explain the remaining saved target: Electron transport chain mechanism.",
      method: "Guided explanation and retrieval",
      methodReason: "This continuation preserves the exact remaining plan target.",
      scheduledFor: "2026-08-17T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "1 saved target · about 10 min",
      learningMode: "learn" as const,
      topicIds: ["00000000-0000-4000-8000-000000000052"],
      contentTargets: ["Electron transport chain mechanism"],
      completionEvidence: ["Explain the electron transport chain mechanism"],
      status: "ready" as const,
    };
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000053",
      planId: "00000000-0000-4000-8000-000000000054",
      planSessionId: "00000000-0000-4000-8000-000000000055",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 10,
      actualMinutes: 8,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      completionMode: "guided",
      conceptEvidence: [],
      confidenceEvidence: [],
    }, null, null, continuation);

    expect(rpc).toHaveBeenCalledWith("complete_plan_session_with_route", {
      payload: expect.objectContaining({
        completionMode: "guided",
        completionVariant: "guided_continuation",
        nextSessionAdjustment: null,
        followUpSession: null,
        continuationSession: expect.objectContaining({
          id: continuation.id,
          sequence: continuation.sequence,
          scheduledFor: continuation.scheduledFor,
          topicIds: continuation.topicIds,
          contentTargets: continuation.contentTargets,
          completionEvidence: continuation.completionEvidence,
        }),
      }),
    });
  });

  it("binds completion evidence to the executed route revision", async () => {
    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000091",
      planId: "00000000-0000-4000-8000-000000000092",
      planSessionId: "00000000-0000-4000-8000-000000000093",
      routeRevisionId: ROUTE_REVISION_ID,
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 20,
      actualMinutes: 8,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      conceptEvidence: [{
        concept: "ATP coupling",
        outcome: "secure",
        activityType: "free_response",
      }],
      confidenceEvidence: [{
        concept: "ATP coupling",
        confidence: "very_sure",
        correct: true,
        activityType: "free_response",
      }],
    });

    expect(rpc).toHaveBeenCalledWith("complete_plan_session_with_route", {
      payload: expect.objectContaining({
        completionVariant: "guided",
        routeRevisionId: ROUTE_REVISION_ID,
        conceptEvidence: [expect.objectContaining({ routeRevisionId: ROUTE_REVISION_ID })],
        confidenceEvidence: [expect.objectContaining({ routeRevisionId: ROUTE_REVISION_ID })],
      }),
    });
  });

  it("sends an adapted next session and its committed successor in one RPC payload", async () => {
    const { plan, session: completedSession, route: completedRoute } = committedRouteFixture();
    const nextSession: LearningPlanSession = {
      ...completedSession,
      id: "00000000-0000-4000-8000-000000000121",
      sequence: 2,
      title: "Apply ATP coupling",
      objective: "Apply ATP coupling to a new endergonic reaction.",
      method: "Retrieval practice",
      methodReason: "Retrieve the mechanism before applying it to a different reaction.",
      status: "upcoming",
    };
    const planWithNext: LearningPlan = { ...plan, sessions: [completedSession, nextSession] };
    const previousNextRoute = createCommittedInitialSessionStudyRoute({
      plan: planWithNext,
      session: nextSession,
      now: NOW,
      origin: { source: "plan_activation", reason: "The learner activated this plan." },
    });
    const adaptation = {
      planSessionId: nextSession.id,
      title: nextSession.title,
      objective: nextSession.objective,
      method: "Independent application and mixed practice",
      methodReason: "A strong independent result supports mixed application on the same target.",
      estimatedMinutes: nextSession.estimatedMinutes,
      amountLabel: nextSession.amountLabel,
      learningMode: "study" as const,
      explanation: "YOVA increased challenge after a strong independent result.",
    };
    const successor = createCommittedScalarSuccessorStudyRoute({
      plan: planWithNext,
      session: {
        ...nextSession,
        method: adaptation.method,
        methodReason: adaptation.methodReason,
        learningMode: adaptation.learningMode,
      },
      previousRoute: previousNextRoute,
      now: "2026-08-17T19:00:00.000Z",
      changeReason: adaptation.explanation,
      origin: {
        source: "post_session_adaptation",
        reason: adaptation.explanation,
        evidenceRefs: [`route-revision:${completedRoute.identity.routeRevisionId}`],
      },
    });

    await completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000122",
      planId: plan.id,
      planSessionId: completedSession.id,
      routeRevisionId: completedRoute.identity.routeRevisionId,
      startedAt: "2026-08-17T17:35:00.000Z",
      completedAt: NOW,
      plannedMinutes: 25,
      actualMinutes: 25,
      correctAnswers: 2,
      totalAnswers: 2,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      conceptEvidence: [],
      confidenceEvidence: [],
    }, adaptation, null, null, successor);

    expect(rpc).toHaveBeenCalledWith("complete_plan_session_with_route", {
      payload: expect.objectContaining({
        routeRevisionId: completedRoute.identity.routeRevisionId,
        nextSessionAdjustment: adaptation,
        nextSessionStudyRoute: expect.objectContaining({
          identity: expect.objectContaining({
            sessionId: nextSession.id,
            revisionNumber: 2,
            supersedesRevisionId: previousNextRoute.identity.routeRevisionId,
          }),
        }),
      }),
    });
  });

  it("refuses to combine a guided continuation with another plan rewrite", async () => {
    await expect(completeAuthenticatedPlanSession({
      id: "00000000-0000-4000-8000-000000000061",
      planId: "00000000-0000-4000-8000-000000000062",
      planSessionId: "00000000-0000-4000-8000-000000000063",
      startedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:08:00.000Z",
      plannedMinutes: 10,
      actualMinutes: 8,
      correctAnswers: 1,
      totalAnswers: 1,
      feedback: "about_right",
      observedGap: "No major gap detected.",
      completionMode: "guided",
      conceptEvidence: [],
      confidenceEvidence: [],
    }, {
      planSessionId: "00000000-0000-4000-8000-000000000064",
      title: "Adapted next session",
      objective: "Keep the original target while restoring support.",
      method: "Guided repair",
      methodReason: "Restore support after a difficult attempt.",
      estimatedMinutes: 10,
      amountLabel: "Guided repair · about 10 min",
      learningMode: "learn",
      explanation: "Restore support before another independent check.",
    }, null, {
      id: "00000000-0000-4000-8000-000000000065",
      sequence: 2,
      title: "Continue saved scope",
      objective: "Learn and explain the remaining saved target.",
      method: "Guided explanation",
      methodReason: "Preserve the remaining exact target.",
      scheduledFor: "2026-08-17T20:08:00.000Z",
      estimatedMinutes: 10,
      amountLabel: "1 saved target · about 10 min",
      learningMode: "learn",
      topicIds: ["00000000-0000-4000-8000-000000000066"],
      contentTargets: ["Remaining saved target"],
      completionEvidence: ["Explain the remaining saved target independently"],
      status: "ready",
    })).rejects.toThrow("cannot safely combine");

    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("authenticated concept-review activation", () => {
  it("uses the route-aware transaction and preserves a new review lineage", async () => {
    const { plan, session, route: originRoute } = committedRouteFixture();
    const routedPlan: LearningPlan = {
      ...plan,
      status: "completed",
      sessions: [{ ...session, status: "complete", studyRoute: originRoute }],
    };
    const review: LearningPlanSession = {
      id: "00000000-0000-4000-8000-000000000111",
      sequence: 2,
      title: "Verify ATP coupling",
      objective: "Retrieve and apply ATP coupling after a delay.",
      method: "Independent retrieval verification",
      methodReason: "The earlier result needs one short delayed verification before it is treated as stable.",
      scheduledFor: NOW,
      estimatedMinutes: 5,
      amountLabel: "Verification due · about 5 min",
      learningMode: "study",
      topicIds: ["00000000-0000-4000-8000-000000000104"],
      contentTargets: ["ATP coupling"],
      completionEvidence: ["Explain ATP coupling without notes."],
      status: "ready",
      reviewConcept: "ATP coupling",
      reviewType: "verify",
    };
    const studyRoute = createCommittedInitialSessionStudyRoute({
      plan: routedPlan,
      session: review,
      now: NOW,
      origin: {
        source: "concept_review_activation",
        reason: "Recorded target evidence made a bounded review due.",
        evidenceRefs: [`route-revision:${originRoute.identity.routeRevisionId}`],
      },
    });

    await activateAuthenticatedConceptReviewSession(plan.id, { ...review, studyRoute });

    expect(rpc).toHaveBeenCalledWith("activate_concept_review_with_route", {
      payload: {
        planId: plan.id,
        originRouteRevisionId: originRoute.identity.routeRevisionId,
        session: expect.objectContaining({
          id: review.id,
          studyRoute: expect.objectContaining({
            identity: expect.objectContaining({
              planId: plan.id,
              sessionId: review.id,
              revisionNumber: 1,
              lifecycleStatus: "committed",
            }),
          }),
        }),
      },
    });
  });
});

describe("authenticated active-session checkpoint sync", () => {
  it("sends no client identity or plan identity and returns the server checkpoint", async () => {
    const local = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 0,
      resumeStep: 0,
      activityProgress: {
        kind: "retrieval_round",
        activityIndex: 0,
        promptCount: 3,
        ratings: ["partly"],
      },
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 20,
        knownTargets: ["Private known target"],
        note: "Private learner note",
      },
    });
    const authoritative = checkpoint({ savedAt: NOW });
    rpc.mockResolvedValueOnce({ data: authoritative, error: null });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local)).resolves.toEqual(authoritative);

    const payload = rpc.mock.calls[0]?.[1]?.payload as Record<string, unknown>;
    expect(rpc.mock.calls[0]?.[0]).toBe("save_active_session_checkpoint_with_route");
    expect(payload).toMatchObject({
      runId: local.runId,
      planSessionId: local.planSessionId,
      completedSteps: local.completedSteps,
      resourceFingerprint: local.resourceFingerprint,
      resourceGeneratedAt: local.resourceGeneratedAt,
      activityProgress: local.activityProgress,
    });
    expect(payload).not.toHaveProperty("accountId");
    expect(payload).not.toHaveProperty("planId");
    expect(payload).not.toHaveProperty("sessionAdjustment");
    expect(JSON.stringify(payload)).not.toContain("Private known target");
    expect(JSON.stringify(payload)).not.toContain("Private learner note");
  });

  it("preserves unguided completion provenance in the cloud checkpoint payload", async () => {
    const local = checkpoint({
      status: "awaiting_finish",
      completedSteps: 5,
      resumeStep: 5,
      completedAt: "2026-08-17T17:59:30.000Z",
      completionFeedback: "about_right",
      completionMode: "unguided_practice",
    });
    rpc.mockResolvedValueOnce({ data: local, error: null });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local)).resolves.toEqual(local);

    expect(rpc).toHaveBeenCalledWith(
      "save_active_session_checkpoint_with_route",
      { payload: expect.objectContaining({ completionMode: "unguided_practice" }) },
    );
  });

  it("syncs and verifies the exact route identity for a version-two checkpoint", async () => {
    const local = routeCheckpoint();
    rpc.mockResolvedValueOnce({ data: local, error: null });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local)).resolves.toEqual(local);
    expect(rpc).toHaveBeenCalledWith(
      "save_active_session_checkpoint_with_route",
      { payload: expect.objectContaining({
        version: 2,
        routeRevisionId: ROUTE_REVISION_ID,
      }) },
    );

    rpc.mockResolvedValueOnce({
      data: {
        ...local,
        routeRevisionId: "00000000-0000-4000-8000-000000000098",
      },
      error: null,
    });
    await expect(saveAuthenticatedActiveSessionCheckpoint({
      ...local,
      savedAt: "2026-08-17T18:00:01.000Z",
    })).rejects.toBeInstanceOf(ActiveSessionCheckpointConflictError);
  });

  it("rejects a checkpoint without exact generated lesson identity before calling the cloud", async () => {
    const legacyLocal = checkpoint();
    delete (legacyLocal as Partial<ActiveSessionCheckpointV1>).resourceGeneratedAt;

    await expect(saveAuthenticatedActiveSessionCheckpoint(legacyLocal))
      .rejects.toThrow("refused to sync");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a server response for a different generated lesson", async () => {
    const local = checkpoint();
    rpc.mockResolvedValueOnce({
      data: {
        ...local,
        resourceGeneratedAt: "2026-08-17T17:41:00.000Z",
      },
      error: null,
    });

    await expect(saveAuthenticatedActiveSessionCheckpoint(local))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointConflictError);
  });

  it("coalesces queued writes per lesson to the checkpoint with the most progress", async () => {
    const first = checkpoint({ completedSteps: 0, resumeStep: 0, activeSeconds: 10 });
    const ahead = checkpoint({
      savedAt: "2026-08-17T17:58:00.000Z",
      completedSteps: 3,
      resumeStep: 3,
      activeSeconds: 300,
    });
    const lateOlderWrite = checkpoint({
      savedAt: "2026-08-17T17:59:00.000Z",
      completedSteps: 1,
      resumeStep: 1,
      activeSeconds: 100,
    });
    let releaseFirst!: (value: { data: ActiveSessionCheckpointV1; error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));
    rpc.mockImplementation((_name: string, parameters: { payload: Record<string, unknown> }) => (
      Promise.resolve({
        data: {
          accountId: first.accountId,
          planId: first.planId,
          ...parameters.payload,
          savedAt: NOW,
        },
        error: null,
      })
    ));

    const firstSave = saveAuthenticatedActiveSessionCheckpoint(first);
    await Promise.resolve();
    const aheadSave = saveAuthenticatedActiveSessionCheckpoint(ahead);
    const olderSave = saveAuthenticatedActiveSessionCheckpoint(lateOlderWrite);

    expect(rpc).toHaveBeenCalledTimes(1);
    releaseFirst({ data: { ...first, savedAt: NOW }, error: null });
    const results = await Promise.all([firstSave, aheadSave, olderSave]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]?.payload).toMatchObject({
      completedSteps: ahead.completedSteps,
      resumeStep: ahead.resumeStep,
      activeSeconds: ahead.activeSeconds,
    });
    expect(results.every((result) => result.completedSteps === ahead.completedSteps)).toBe(true);
  });

  it("serializes every lesson checkpoint write for the same account without dropping one", async () => {
    const first = checkpoint();
    const second = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000020",
      runId: "00000000-0000-4000-8000-000000000021",
    });
    let activeWrites = 0;
    let maxConcurrentWrites = 0;
    const releases: Array<() => void> = [];
    rpc.mockImplementation((
      _name: string,
      parameters: { payload: Record<string, unknown> },
    ) => new Promise((resolve) => {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      releases.push(() => {
        activeWrites -= 1;
        resolve({
          data: parameters.payload.planSessionId === first.planSessionId ? first : second,
          error: null,
        });
      });
    }));

    const firstSave = saveAuthenticatedActiveSessionCheckpoint(first);
    const secondSave = saveAuthenticatedActiveSessionCheckpoint(second);

    expect(rpc).toHaveBeenCalledOnce();
    expect(maxConcurrentWrites).toBe(1);

    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(maxConcurrentWrites).toBe(1);

    releases[1]?.();
    await Promise.all([firstSave, secondSave]);

    expect(rpc.mock.calls.map((call) => call[1]?.payload.planSessionId)).toEqual([
      first.planSessionId,
      second.planSessionId,
    ]);
  });

  it("allows checkpoint writes for different accounts to proceed independently", async () => {
    const first = checkpoint();
    const second = checkpoint({
      accountId: "user-2",
      planSessionId: "00000000-0000-4000-8000-000000000022",
      runId: "00000000-0000-4000-8000-000000000023",
    });
    let activeWrites = 0;
    let maxConcurrentWrites = 0;
    const releases: Array<() => void> = [];
    rpc.mockImplementation((
      _name: string,
      parameters: { payload: Record<string, unknown> },
    ) => new Promise((resolve) => {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      releases.push(() => {
        activeWrites -= 1;
        resolve({
          data: parameters.payload.planSessionId === first.planSessionId ? first : second,
          error: null,
        });
      });
    }));

    const firstSave = saveAuthenticatedActiveSessionCheckpoint(first);
    const secondSave = saveAuthenticatedActiveSessionCheckpoint(second);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(maxConcurrentWrites).toBe(2);
    releases.forEach((release) => release());
    await Promise.all([firstSave, secondSave]);
  });

  it("releases the account lane after a deadline so another lesson can sync", async () => {
    const first = checkpoint();
    const second = checkpoint({
      planSessionId: "00000000-0000-4000-8000-000000000024",
      runId: "00000000-0000-4000-8000-000000000025",
    });
    rpc
      .mockImplementationOnce(() => ({
        abortSignal: (signal: AbortSignal) => new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      }))
      .mockResolvedValueOnce({ data: second, error: null });

    const timedOut = saveAuthenticatedActiveSessionCheckpoint(first)
      .catch((error: unknown) => error);
    const following = saveAuthenticatedActiveSessionCheckpoint(second);

    expect(rpc).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(AUTHENTICATED_LEARNING_MUTATION_DEADLINE_MS);

    expect(await timedOut).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    await expect(following).resolves.toEqual(second);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("maps cloud ownership and terminal signals to distinct errors", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "active_session_checkpoint_conflict" },
    });
    await expect(saveAuthenticatedActiveSessionCheckpoint(checkpoint()))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointConflictError);

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "active_session_checkpoint_terminal" },
    });
    await expect(saveAuthenticatedActiveSessionCheckpoint(checkpoint()))
      .rejects.toBeInstanceOf(ActiveSessionCheckpointTerminalError);
  });

  it("leaves the browser checkpoint intact when a retryable cloud write fails", async () => {
    installMemoryStorage();
    const local = checkpoint();
    expect(saveActiveSessionCheckpoint(local)).toBe(true);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "08006", message: "network unavailable" },
    });

    const issue = await saveAuthenticatedActiveSessionCheckpoint(local).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({
      code: "temporarily_unavailable",
      retryable: true,
      message: expect.stringContaining("kept this lesson on this device"),
    });

    expect(loadActiveSessionCheckpoints(local.accountId)).toEqual([local]);
  });

  it("uses the same retryable checkpoint contract when the cloud client throws", async () => {
    const local = checkpoint();
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const issue = await saveAuthenticatedActiveSessionCheckpoint(local).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({ code: "temporarily_unavailable", retryable: true });
  });

  it("rejects every waiter and releases the lesson queue after a checkpoint deadline", async () => {
    const local = checkpoint();
    const ahead = checkpoint({
      savedAt: "2026-08-17T18:00:01.000Z",
      completedSteps: 1,
      resumeStep: 1,
      activeSeconds: 60,
    });
    let requestSignal: AbortSignal | undefined;
    rpc.mockImplementationOnce(() => ({
      abortSignal: (signal: AbortSignal) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    }));

    const first = saveAuthenticatedActiveSessionCheckpoint(local)
      .catch((error: unknown) => error);
    const coalesced = saveAuthenticatedActiveSessionCheckpoint(ahead)
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(AUTHENTICATED_LEARNING_MUTATION_DEADLINE_MS);
    const issues = await Promise.all([first, coalesced]);

    expect(requestSignal?.aborted).toBe(true);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue instanceof CloudSyncTemporarilyUnavailableError)).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();

    rpc.mockResolvedValueOnce({ data: ahead, error: null });
    await expect(saveAuthenticatedActiveSessionCheckpoint(ahead)).resolves.toEqual(ahead);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("deletes by server-owned session identity without accepting account or plan ids", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const local = checkpoint();

    await deleteAuthenticatedActiveSessionCheckpoint(local.planSessionId, local.runId);

    expect(rpc).toHaveBeenCalledWith("delete_active_session_checkpoint", {
      requested_plan_session_id: local.planSessionId,
      requested_run_id: local.runId,
    });
  });
});

describe("saveAuthenticatedLearnerProfile", () => {
  it("classifies a transient identity-provider failure as retryable cloud sync, not an account change", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "provider request timed out" },
    });

    const issue = await saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Learner",
      onboardingAnswers: ["A blocker"],
    }).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({ code: "temporarily_unavailable", retryable: true });
    expect((issue as Error).message).toContain("still visible here");
    expect((issue as Error).message).toContain("Retry now before closing or reloading");
    expect((issue as Error).message).not.toContain("account changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps a thrown identity-provider failure in the same retryable error contract", async () => {
    getUser.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const issue = await saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Learner",
      onboardingAnswers: ["A blocker"],
    }).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({ code: "temporarily_unavailable", retryable: true });
    expect((issue as Error).message).not.toContain("account changed");
  });

  it("classifies a profile RPC failure as retryable without changing account identity", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "network unavailable" } });

    const issue = await saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Learner",
      onboardingAnswers: ["A blocker"],
    }).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudSyncTemporarilyUnavailableError);
    expect(issue).toMatchObject({ code: "temporarily_unavailable", retryable: true });
    expect((issue as Error).message).not.toContain("account changed");
  });

  it("stores the personalization state inside the existing additional-context field", async () => {
    const state = defaultPersonalizationState();
    const answers = writePersonalizationStateToAnswers([], {
      ...state,
      workspace: { ...state.workspace, textDensity: "reduced" },
    });

    await saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Learner",
      onboardingAnswers: answers,
    });

    const payload = rpc.mock.calls[0]?.[1]?.payload as Record<string, unknown>;
    const additionalContext = JSON.parse(payload.additionalContext as string) as Record<string, unknown>;
    expect(additionalContext).toMatchObject({
      schemaVersion: 3,
      personalizationState: answers[PERSONALIZATION_STATE_ANSWER_INDEX],
    });
  });

  it("serializes writes and coalesces queued edits to the newest profile", async () => {
    let releaseFirst!: (value: { error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise<{ error: null }>((resolve) => {
      releaseFirst = resolve;
    }));

    const first = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "First",
      onboardingAnswers: ["first blocker"],
    });
    await Promise.resolve();
    const second = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Second",
      onboardingAnswers: ["second blocker"],
    });
    const newest = saveAuthenticatedLearnerProfile({
      accountId: "user-1",
      displayName: "Newest",
      onboardingAnswers: ["newest blocker"],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(releaseFirst).toBeTypeOf("function");
    releaseFirst({ error: null });
    const [firstReceipt, secondReceipt, newestReceipt] = await Promise.all([
      first,
      second,
      newest,
    ]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]?.payload).toMatchObject({
      displayName: "Newest",
      commonBlocker: "newest blocker",
    });
    expect(firstReceipt).toEqual({
      accountId: "user-1",
      displayName: "First",
      onboardingAnswers: ["first blocker"],
    });
    expect(secondReceipt).toEqual({
      accountId: "user-1",
      displayName: "Newest",
      onboardingAnswers: ["newest blocker"],
    });
    expect(newestReceipt).toEqual(secondReceipt);
  });

  it("rejects a stale account-scoped write before calling the profile RPC", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "account-b" } },
      error: null,
    });

    const issue = await saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Stale A",
      onboardingAnswers: ["A blocker"],
    }).catch((error: unknown) => error);

    expect(issue).toBeInstanceOf(CloudAccountIdentityMismatchError);
    expect(issue).toMatchObject({ code: "account_identity_mismatch", retryable: false });
    expect((issue as Error).message).toContain("signed-in account changed");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels account A without letting its queued profile write run under account B", async () => {
    let releaseAccountA!: (value: { data: null; error: null }) => void;
    let currentUserId = "account-a";
    getUser.mockImplementation(async () => ({
      data: { user: { id: currentUserId } },
      error: null,
    }));
    rpc.mockImplementationOnce(() => new Promise<{ data: null; error: null }>((resolve) => {
      releaseAccountA = resolve;
    }));

    const activeAccountA = saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Account A",
      onboardingAnswers: ["A active"],
    });
    const activeAccountAResult = activeAccountA.catch((error: unknown) => error);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    const queuedAccountA = saveAuthenticatedLearnerProfile({
      accountId: "account-a",
      displayName: "Stale A",
      onboardingAnswers: ["A queued"],
    });
    const queuedAccountAResult = queuedAccountA.catch((error: unknown) => error);
    cancelAuthenticatedLearnerProfileWrites("account-a");

    currentUserId = "account-b";
    const accountB = saveAuthenticatedLearnerProfile({
      accountId: "account-b",
      displayName: "Account B",
      onboardingAnswers: ["B blocker"],
    });
    releaseAccountA({ data: null, error: null });

    await expect(activeAccountAResult).resolves.toMatchObject({
      message: expect.stringContaining("signed-in account changed"),
    });
    await expect(queuedAccountAResult).resolves.toMatchObject({
      message: expect.stringContaining("signed-in account changed"),
    });
    await expect(accountB).resolves.toEqual({
      accountId: "account-b",
      displayName: "Account B",
      onboardingAnswers: ["B blocker"],
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "save_learner_profile",
      "save_learner_profile",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      payload: { expectedAccountId: "account-a", displayName: "Account A" },
    });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      payload: { expectedAccountId: "account-b", displayName: "Account B" },
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("Stale A");
  });
});

function cloudState(overrides: Partial<CloudLearningState> = {}): CloudLearningState {
  return {
    displayName: "Learner",
    onboardingCompleted: false,
    onboardingAnswers: [],
    plans: [],
    deadlineMilestones: [],
    sessionCompletions: [],
    sessionInterruptions: [],
    activeSessionCheckpoints: [],
    ...overrides,
  };
}

function sessionInterruption(
  overrides: Partial<SessionInterruption> = {},
): SessionInterruption {
  return {
    id: "00000000-0000-4000-8000-000000000081",
    planId: "00000000-0000-4000-8000-000000000082",
    planSessionId: "00000000-0000-4000-8000-000000000083",
    startedAt: "2026-08-17T17:50:00.000Z",
    interruptedAt: NOW,
    plannedMinutes: 25,
    actualMinutes: 10,
    completedSteps: 1,
    totalSteps: 5,
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<ActiveSessionCheckpointV1> = {},
): ActiveSessionCheckpointV1 {
  return {
    version: 1,
    accountId: "user-1",
    runId: "00000000-0000-4000-8000-000000000001",
    planId: "00000000-0000-4000-8000-000000000002",
    planSessionId: "00000000-0000-4000-8000-000000000003",
    status: "working",
    startedAt: "2026-08-17T17:50:00.000Z",
    savedAt: NOW,
    activeSeconds: 420,
    plannedMinutes: 25,
    completedSteps: 1,
    totalSteps: 5,
    resumeStep: 1,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: "2026-08-17T17:40:00.000Z",
    evidence: {
      correctAnswers: 1,
      totalAnswers: 1,
      conceptEvidence: [],
      confidenceEvidence: [],
      observedGap: "No gap observed yet.",
      completedImmediateRepairs: 0,
    },
    ...overrides,
  } as ActiveSessionCheckpointV1;
}

function routeCheckpoint(
  overrides: Partial<ActiveSessionCheckpointV2> = {},
): ActiveSessionCheckpointV2 {
  return {
    ...checkpoint(),
    version: 2,
    routeRevisionId: ROUTE_REVISION_ID,
    ...overrides,
  } as ActiveSessionCheckpointV2;
}

function committedRouteFixture() {
  const session: LearningPlanSession = {
    id: "00000000-0000-4000-8000-000000000103",
    sequence: 1,
    title: "Retrieve ATP coupling",
    objective: "Explain how ATP coupling drives an endergonic reaction.",
    method: "Retrieval practice",
    methodReason: "Recall the causal chain before checking the explanation.",
    scheduledFor: NOW,
    estimatedMinutes: 25,
    amountLabel: "25 min",
    learningMode: "study",
    topicIds: ["00000000-0000-4000-8000-000000000104"],
    contentTargets: ["ATP coupling"],
    completionEvidence: ["Explain ATP coupling without notes."],
    status: "ready",
  };
  const plan = {
    id: "00000000-0000-4000-8000-000000000102",
    learningItemId: "00000000-0000-4000-8000-000000000101",
    title: "Cellular energy",
    topic: "ATP coupling",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    creationIntent: "plan",
    rationale: "Build durable retrieval.",
    createdAt: NOW,
    materials: [],
    sessions: [session],
  } as LearningPlan;
  const route = adaptLegacySessionToStudyRoute({
    plan,
    session,
    adaptedAt: NOW,
    identity: {
      routeLineageId: "00000000-0000-4000-8000-000000000105",
      routeRevisionId: ROUTE_REVISION_ID,
      lifecycleStatus: "committed",
      committedAt: NOW,
    },
  }).route;
  if (!route) throw new Error("The test route could not be created.");
  return { plan, session, route };
}

function studyRouteRow(route: StudyRoute) {
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

function learningItemRow(plan: LearningPlan) {
  return {
    id: plan.learningItemId,
    title: plan.title,
    kind: plan.kind,
    topic: plan.topic,
    deadline: plan.deadline,
    source_mode: plan.sourceMode,
    study_mode: plan.studyMode,
    created_at: plan.createdAt,
  };
}

function planRow(plan: LearningPlan) {
  return {
    id: plan.id,
    learning_item_id: plan.learningItemId,
    status: plan.status,
    rationale: plan.rationale,
    generation_inputs: {
      learningIntent: plan.learningIntent,
      intent: plan.creationIntent,
    },
    knowledge_map: null,
    created_at: plan.createdAt,
  };
}

function planSessionRow(plan: LearningPlan, session: LearningPlanSession) {
  return {
    id: session.id,
    plan_id: plan.id,
    sequence: session.sequence,
    title: session.title,
    objective: session.objective,
    method: session.method,
    method_rationale: session.methodReason,
    scheduled_for: session.scheduledFor,
    estimated_minutes: session.estimatedMinutes,
    status: session.status,
    step_data: {
      amountLabel: session.amountLabel,
      learningMode: session.learningMode,
      topicIds: session.topicIds,
      contentTargets: session.contentTargets,
      completionEvidence: session.completionEvidence,
    },
    committed_route_revision_id: null,
  };
}

function sessionRow(activeSessionCheckpoint: ActiveSessionCheckpointV1) {
  return {
    id: activeSessionCheckpoint.planSessionId,
    plan_id: activeSessionCheckpoint.planId,
    sequence: 1,
    title: "ATP coupling",
    objective: "Explain ATP coupling.",
    method: "Self-explanation",
    method_rationale: "Make the causal chain explicit.",
    scheduled_for: NOW,
    estimated_minutes: 25,
    status: "ready",
    step_data: { activeSessionCheckpoint },
    committed_route_revision_id: null,
  };
}

function installMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

function mockCloudQueries({
  profile,
  sessions = [],
  items = [],
  plans = [],
  routes = [],
  materials = [],
  milestones = [],
  milestoneError = null,
}: {
  profile: { display_name: string; onboarding_completed_at: string | null } | null;
  sessions?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
  routes?: Array<Record<string, unknown>>;
  materials?: Array<Record<string, unknown>>;
  milestones?: Array<Record<string, unknown>>;
  milestoneError?: unknown;
}) {
  from.mockImplementation((table: string) => {
    const result = {
      data: table === "profiles"
        ? profile
        : table === "learner_profiles"
          ? null
          : table === "learning_items"
            ? items
            : table === "plans"
              ? plans
              : table === "materials"
                ? materials
                : table === "study_routes"
                  ? routes
                : table === "plan_sessions"
                  ? sessions
                  : table === "deadline_milestones"
                    ? milestones
                    : [],
      error: table === "deadline_milestones" ? milestoneError : null,
    };
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.eq = vi.fn(() => builder);
    builder.not = vi.fn(() => builder);
    builder.order = vi.fn(() => Promise.resolve(result));
    return builder;
  });
}

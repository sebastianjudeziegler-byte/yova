import { beforeEach, describe, expect, it } from "vitest";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { routeSession, withStudyOutside } from "@/lib/routing/session-route";
import { clearBaselineCheckpoint, loadBaselineCheckpoint, routeFingerprint, saveBaselineCheckpoint, type BaselineCheckpoint } from "./baseline-checkpoint";
import { initialShapeAState, shapeAReducer } from "./shape-a";
import { initialShapeCState } from "./shape-c";
import type { TopicWorkload } from "@/lib/plan-generation/topic-plan-contract";

const route = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: false, topicHasProblems: false, answers: emptyOnboardingAnswers() });

function memoryStorage() {
  const store = new Map<string, string>();
  return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
}

function checkpoint(overrides: Partial<BaselineCheckpoint> = {}): BaselineCheckpoint {
  return {
    version: 1, planId: "plan-1", planSessionId: "session-1", produceStep: null, studyLocation: "inside", routeFingerprint: routeFingerprint(route),
    savedAt: "2026-09-16T10:00:00.000Z", elapsedSeconds: 312, started: true,
    aState: shapeAReducer(initialShapeAState(route), { type: "continue" }), cState: initialShapeCState(route),
    direction: null, learnBlock: null, practiceKeyPoints: [], tips: {},
    ...overrides,
  };
}

// Brief 1.5 item 8: returning mid-session goes straight back to where the learner was.
describe("baseline session checkpoints", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => { storage = memoryStorage(); });

  it("saves and restores the exact step, per account and session", () => {
    saveBaselineCheckpoint(storage, "account-a", checkpoint());
    const restored = loadBaselineCheckpoint(storage, "account-a", "session-1");
    expect(restored?.aState.index).toBe(1);
    expect(restored?.elapsedSeconds).toBe(312);
    expect(loadBaselineCheckpoint(storage, "account-b", "session-1")).toBeNull();
    expect(loadBaselineCheckpoint(storage, "account-a", "session-2")).toBeNull();
  });

  it("keeps one checkpoint per session and clears it on finish", () => {
    saveBaselineCheckpoint(storage, "account-a", checkpoint());
    saveBaselineCheckpoint(storage, "account-a", checkpoint({ planSessionId: "session-2" }));
    clearBaselineCheckpoint(storage, "account-a", "session-1");
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1")).toBeNull();
    expect(loadBaselineCheckpoint(storage, "account-a", "session-2")).not.toBeNull();
  });

  it("ignores a checkpoint for a route that has since changed shape, and unreadable storage", () => {
    saveBaselineCheckpoint(storage, "account-a", checkpoint());
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1", routeFingerprint(withStudyOutside(route)))).toBeNull();
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1", routeFingerprint(route))).not.toBeNull();
    storage.setItem("yova.baseline-sessions.v1:account-a", "{not json");
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1")).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => saveBaselineCheckpoint(throwing, "account-a", checkpoint())).not.toThrow();
    expect(loadBaselineCheckpoint(throwing, "account-a", "session-1")).toBeNull();
    expect(saveBaselineCheckpoint(throwing, "account-a", checkpoint())).toBe(false);
  });

  it("ordinary workload resumes retain identity while changed questions or target scope require fresh content", () => {
    const workload = { topicSubtopics: [{ topicId: "topic-1", subtopics: ["Osmosis"] }], questionCount: 8, recallQuestionCount: 2, transferQuestionCount: 6, produceSteps: 1 } as TopicWorkload;
    const fingerprint = routeFingerprint(route, { workload, learningGoal: "A-level application" });
    saveBaselineCheckpoint(storage, "account-a", checkpoint({ routeFingerprint: fingerprint }));
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1", routeFingerprint(route, { workload: structuredClone(workload), learningGoal: "A-level application" }))).not.toBeNull();
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1", routeFingerprint(route, { workload: { ...workload, questionCount: 12 }, learningGoal: "A-level application" }))).toBeNull();
    expect(loadBaselineCheckpoint(storage, "account-a", "session-1", routeFingerprint(route, { workload, learningGoal: "Introductory vocabulary" }))).toBeNull();
  });
});

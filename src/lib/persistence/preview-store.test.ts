import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionCompletion, SessionInterruption, YovaPreviewSnapshot } from "@/lib/domain";
import { loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";
import { LEARNER_ANSWER_COUNT } from "@/lib/personalization/learner-profile";
import {
  defaultPersonalizationState,
  PERSONALIZATION_STATE_ANSWER_INDEX,
  readPersonalizationStateFromAnswers,
  serializePersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";

const STORAGE_KEY = "yova.preview.v1";

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

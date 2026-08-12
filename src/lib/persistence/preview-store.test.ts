import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInterruption, YovaPreviewSnapshot } from "@/lib/domain";
import { loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";

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

function snapshot(sessionInterruption: SessionInterruption): YovaPreviewSnapshot {
  return {
    version: 1,
    account: null,
    signedIn: false,
    onboardingAnswers: [],
    onboardingCompleted: true,
    alphaEntered: true,
    plans: [],
    sessionCompletions: [],
    sessionInterruptions: [sessionInterruption],
    updatedAt: "2026-08-11T20:08:00.000Z",
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

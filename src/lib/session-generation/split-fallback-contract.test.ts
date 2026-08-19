import { describe, expect, it } from "vitest";
import { PlanAdjustmentRequestSchema } from "@/lib/learning/adjustment-schema";
import { buildContentBasedReplacementSessions } from "@/lib/learning/content-based-plan-adjustment";
import {
  buildOutsideYovaFallbackLesson,
  builtInLessonFitsTime,
} from "@/lib/session-generation/built-in-fallback";

const adjustmentRequest = {
  planId: "10000000-1000-4000-8000-100000000001",
  deadline: null,
  studyMode: "outside_yova" as const,
};

const originalSession = {
  id: "20000000-2000-4000-8000-200000000001",
  sequence: 1,
  title: "Build the cellular respiration model",
  objective: "Explain how the Krebs cycle transfers energy to NADH and FADH2.",
  method: "Active retrieval with a source check",
  method_rationale: "It turns source review into an attempt the learner can check and improve.",
  scheduled_for: "2026-08-19T18:00:00.000Z",
  estimated_minutes: 15,
  status: "ready" as const,
  step_data: {
    learningMode: "learn",
    topicIds: ["30000000-3000-4000-8000-300000000001"],
    contentTargets: ["Krebs cycle energy transfer"],
    completionEvidence: ["Explain where NADH and FADH2 receive high-energy electrons"],
  },
};

describe("split-session fallback duration contract", () => {
  it("keeps every API-supported split duration inside the outside-YOVA fallback range", () => {
    const supportedSplitMinutes = Array.from({ length: 180 }, (_, index) => index + 1)
      .filter((futureSessionMinutes) => PlanAdjustmentRequestSchema.safeParse({
        ...adjustmentRequest,
        futureSessionMinutes,
      }).success);

    expect(supportedSplitMinutes[0]).toBe(10);
    expect(supportedSplitMinutes.at(-1)).toBe(90);

    for (const splitMinutes of supportedSplitMinutes) {
      const parts = buildContentBasedReplacementSessions([{
        ...originalSession,
        estimated_minutes: splitMinutes + 5,
      }], splitMinutes, 1);

      expect(parts.length, `${splitMinutes}-minute split`).toBeGreaterThan(1);
      expect(parts.every((part) => part.segmentCount > 1)).toBe(true);
      expect(parts.every((part) => part.estimatedMinutes === splitMinutes)).toBe(true);

      for (const learningMode of ["learn", "study"] as const) {
        const fallback = buildOutsideYovaFallbackLesson({
          topic: "how the Krebs cycle produces NADH and FADH2",
          objective: originalSession.objective,
          method: originalSession.method,
          methodReason: originalSession.method_rationale,
          learningMode,
          availableMinutes: splitMinutes,
        });

        expect(fallback, `${learningMode} fallback at ${splitMinutes} minutes`).not.toBeNull();
        expect(
          fallback && builtInLessonFitsTime(fallback.activities, splitMinutes),
          `${learningMode} fallback fit at ${splitMinutes} minutes`,
        ).toBe(true);
      }
    }
  });
});

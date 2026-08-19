import { describe, expect, it } from "vitest";
import { PlanAdjustmentResponseSchema } from "@/lib/learning/adjustment-schema";

describe("plan adjustment response", () => {
  it("retains split provenance for a later adjustment", () => {
    const originSessionId = "10000000-1000-4000-8000-100000000001";
    const parsed = PlanAdjustmentResponseSchema.parse({
      planId: "20000000-2000-4000-8000-200000000001",
      deadline: null,
      studyMode: "outside_yova",
      sessions: [{
        id: originSessionId,
        sequence: 1,
        title: "Krebs cycle · Part 1 of 2",
        objective: "Explain how the cycle transfers energy.",
        method: "Active retrieval with a source check",
        methodReason: "A bounded attempt makes the first knowledge gap visible.",
        scheduledFor: "2026-08-19T18:00:00.000Z",
        estimatedMinutes: 10,
        amountLabel: "1 focused target + evidence check · about 10 min",
        learningMode: "learn",
        topicIds: ["30000000-3000-4000-8000-300000000001"],
        contentTargets: ["Krebs cycle energy transfer"],
        completionEvidence: ["Explain where NADH receives high-energy electrons"],
        originSessionId,
        originalContentMinutes: 15,
        segmentIndex: 1,
        segmentCount: 2,
        status: "ready",
      }],
      persistence: "supabase",
    });

    expect(parsed.sessions[0]).toMatchObject({
      originSessionId,
      originalContentMinutes: 15,
      segmentIndex: 1,
      segmentCount: 2,
    });
  });
});

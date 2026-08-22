import { describe, expect, it } from "vitest";
import type { LearningPlanSession } from "@/lib/domain";
import {
  buildDeferredSessionContinuation,
  isDeferredSessionContinuation,
  sessionResourceHasDeferredPlanTargets,
} from "@/lib/learning/session-continuation";

const TOPIC_1 = "00000000-0000-4000-8000-000000000001";
const TOPIC_2 = "00000000-0000-4000-8000-000000000002";
const TOPIC_3 = "00000000-0000-4000-8000-000000000003";
const CONTINUATION_ID = "00000000-0000-4000-8000-000000000010";

function session(overrides: Partial<LearningPlanSession> = {}): LearningPlanSession {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    sequence: 2,
    title: "Cellular respiration stages",
    objective: "Learn the stages, locations, and outputs of cellular respiration.",
    method: "Guided explanation and retrieval",
    methodReason: "Build the causal model before checking it independently.",
    scheduledFor: "2026-08-21T17:00:00.000Z",
    estimatedMinutes: 30,
    amountLabel: "Three targets · about 30 min",
    learningMode: "learn",
    topicIds: [TOPIC_1, TOPIC_2, TOPIC_3],
    contentTargets: ["Glycolysis inputs and outputs", "Krebs cycle location and outputs", "Electron transport chain mechanism"],
    completionEvidence: ["Explain glycolysis inputs and outputs", "Explain the Krebs cycle location and outputs", "Explain the electron transport chain mechanism"],
    status: "ready",
    resource: {
      rationale: "The current window can teach and check only the first target safely.",
      coverage: {
        focus: "Build an accurate model of glycolysis before later stages.",
        essentialIdeas: ["Glycolysis converts glucose into pyruvate in the cytosol."],
        completionEvidence: ["Explain glycolysis inputs and outputs"],
        evidenceMap: [{
          essentialIdea: "Glycolysis converts glucose into pyruvate in the cytosol.",
          activityConcept: "Glycolysis",
        }],
        deferredContent: ["Krebs cycle location and outputs", "Electron transport chain mechanism"],
      },
      activities: [],
      generatedAt: "2026-08-21T17:00:00.000Z",
      origin: "generated",
    },
    ...overrides,
  };
}

describe("deferred guided-session continuation", () => {
  it("preserves the topic superset and exact deferred targets before the next session", () => {
    const current = session();
    const continuation = buildDeferredSessionContinuation({
      completedSession: current,
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
      nextUnfinishedSession: { scheduledFor: "2026-08-21T17:25:00.000Z" },
      deadline: "2026-08-21T18:00:00.000Z",
    });

    expect(sessionResourceHasDeferredPlanTargets(current)).toBe(true);
    expect(continuation).toMatchObject({
      id: CONTINUATION_ID,
      sequence: 3,
      scheduledFor: "2026-08-21T17:10:00.000Z",
      estimatedMinutes: 15,
      status: "ready",
      topicIds: [TOPIC_1, TOPIC_2, TOPIC_3],
      contentTargets: ["Krebs cycle location and outputs", "Electron transport chain mechanism"],
      completionEvidence: [
        "Explain or apply this remaining saved target independently: Krebs cycle location and outputs",
        "Explain or apply this remaining saved target independently: Electron transport chain mechanism",
      ],
    });
  });

  it("synthesizes bounded deferred-only evidence when stored evidence is not positional", () => {
    const continuation = buildDeferredSessionContinuation({
      completedSession: session({
        topicIds: [TOPIC_1],
        completionEvidence: ["Compare every respiration stage and explain how their outputs connect"],
      }),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 10,
      continuationId: CONTINUATION_ID,
      nextUnfinishedSession: { scheduledFor: "2026-08-21T17:30:00.000Z" },
    });

    expect(continuation?.topicIds).toEqual([TOPIC_1]);
    expect(continuation?.completionEvidence).toEqual([
      "Explain or apply this remaining saved target independently: Krebs cycle location and outputs",
      "Explain or apply this remaining saved target independently: Electron transport chain mechanism",
    ]);
    expect(continuation?.completionEvidence).not.toContain(
      "Compare every respiration stage and explain how their outputs connect",
    );
  });

  it("never guesses a target-to-topic mapping from equal-length arrays", () => {
    const continuation = buildDeferredSessionContinuation({
      completedSession: session({
        topicIds: [TOPIC_1, TOPIC_2],
        completionEvidence: ["Compare every respiration stage and explain how their outputs connect"],
      }),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 10,
      continuationId: CONTINUATION_ID,
      nextUnfinishedSession: { scheduledFor: "2026-08-21T17:30:00.000Z" },
    });

    expect(continuation?.topicIds).toEqual([TOPIC_1, TOPIC_2]);
    expect(continuation?.completionEvidence).toEqual([
      "Explain or apply this remaining saved target independently: Krebs cycle location and outputs",
      "Explain or apply this remaining saved target independently: Electron transport chain mechanism",
    ]);
  });

  it("recognizes only the canonical durable continuation markers", () => {
    const continuation = buildDeferredSessionContinuation({
      completedSession: session(),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
    });

    expect(continuation && isDeferredSessionContinuation(continuation)).toBe(true);
    expect(isDeferredSessionContinuation({
      title: "Continue cellular respiration stages",
      methodReason: "Continue the learner's existing curriculum.",
    })).toBe(false);
    expect(isDeferredSessionContinuation({
      title: "Cellular respiration stages",
      methodReason: continuation!.methodReason,
    })).toBe(false);
  });

  it("fails closed when an imminent protected review leaves less than ten minutes", () => {
    expect(buildDeferredSessionContinuation({
      completedSession: session(),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
      nextUnfinishedSession: { scheduledFor: "2026-08-21T17:19:00.000Z" },
      deadline: "2026-08-21T18:00:00.000Z",
    })).toBeNull();
  });

  it("fails closed when the final goal deadline leaves less than ten minutes", () => {
    expect(buildDeferredSessionContinuation({
      completedSession: session(),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
      deadline: "2026-08-21T17:18:00.000Z",
    })).toBeNull();
  });

  it("does not turn model-invented deferred prose or protected review scope into curriculum", () => {
    const current = session({
      resource: {
        ...session().resource!,
        coverage: {
          ...session().resource!.coverage!,
          deferredContent: ["A model-invented optional extension"],
        },
      },
    });
    expect(sessionResourceHasDeferredPlanTargets(current)).toBe(false);
    expect(buildDeferredSessionContinuation({
      completedSession: current,
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
    })).toBeNull();
    expect(buildDeferredSessionContinuation({
      completedSession: session({ reviewType: "verify" }),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
    })).toBeNull();
  });

  it("does not complete and recreate a session when every stored target was deferred", () => {
    expect(buildDeferredSessionContinuation({
      completedSession: session({
        resource: {
          ...session().resource!,
          coverage: {
            ...session().resource!.coverage!,
            deferredContent: [...session().contentTargets!],
          },
        },
      }),
      completedAt: "2026-08-21T17:10:00.000Z",
      plannedMinutes: 20,
      continuationId: CONTINUATION_ID,
    })).toBeNull();
  });
});

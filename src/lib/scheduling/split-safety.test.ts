import { describe, expect, it } from "vitest";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import {
  buildContentBasedReplacementSessions,
  learningPlanSessionToAdjustableRow,
} from "@/lib/learning/content-based-plan-adjustment";
import { canOfferAgendaSessionSplit } from "@/lib/scheduling/split-safety";

const session: LearningPlanSession = {
  id: "10000000-1000-4000-8000-100000000001",
  sequence: 1,
  title: "Understand Krebs-cycle energy transfer",
  objective: "Explain how the Krebs cycle transfers energy to NADH and FADH2.",
  method: "Active retrieval with a source check",
  methodReason: "It turns source review into an attempt the learner can check and improve.",
  scheduledFor: "2026-08-19T18:00:00.000Z",
  estimatedMinutes: 15,
  amountLabel: "One focused target + evidence check · about 15 min",
  learningMode: "learn",
  topicIds: ["20000000-2000-4000-8000-200000000001"],
  contentTargets: ["Krebs-cycle energy transfer"],
  completionEvidence: ["Explain where NADH and FADH2 receive high-energy electrons"],
  status: "ready",
};

const plan: LearningPlan = {
  id: "30000000-3000-4000-8000-300000000001",
  learningItemId: "40000000-4000-4000-8000-400000000001",
  title: "Krebs Cycle Energy Transfer",
  topic: "how the Krebs cycle produces NADH and FADH2",
  kind: "topic",
  deadline: null,
  status: "active",
  sourceMode: "yova_generated",
  studyMode: "outside_yova",
  learningIntent: "learn",
  rationale: "Use a bounded source workflow and return check.",
  createdAt: "2026-08-19T17:00:00.000Z",
  sessions: [session],
};

const unsafeSplitCases: Array<[
  string,
  { plan?: LearningPlan; session?: LearningPlanSession },
]> = [
  ["inactive plan", { plan: { ...plan, status: "archived" } }],
  ["material-grounded plan", {
    plan: { ...plan, sourceMode: "user_materials", studyMode: "inside_yova" },
  }],
  ["scheduled retrieval", { session: { ...session, reviewType: "maintenance_transfer" } }],
  ["settled session", { session: { ...session, status: "complete" } }],
];

describe("Agenda split safety", () => {
  it("offers a split only when every projected replacement has an exact outside fallback that fits", () => {
    expect(canOfferAgendaSessionSplit({ plan, session, targetMinutes: 10 })).toBe(true);
    expect(canOfferAgendaSessionSplit({ plan, session, targetMinutes: 9 })).toBe(false);
    expect(canOfferAgendaSessionSplit({ plan, session, targetMinutes: 10.5 })).toBe(false);
    expect(canOfferAgendaSessionSplit({ plan, session, targetMinutes: 15 })).toBe(false);
  });

  it("offers the shortest split for an arbitrary inside-YOVA topic through the generic fallback", () => {
    const arbitrarySession: LearningPlanSession = {
      ...session,
      title: "Trace how ocean currents move heat",
      objective: "Explain how surface and deep-ocean currents redistribute heat around Earth.",
      learningMode: "study",
      contentTargets: [
        "Surface-current heat transfer",
        "Thermohaline circulation",
      ],
      completionEvidence: [
        "Explain one mechanism that moves heat between ocean regions",
        "Apply the mechanism to a change in water temperature or salinity",
      ],
    };
    const insidePlan: LearningPlan = {
      ...plan,
      topic: "how ocean currents redistribute heat",
      studyMode: "inside_yova",
      sessions: [arbitrarySession],
    };

    expect(canOfferAgendaSessionSplit({
      plan: insidePlan,
      session: arbitrarySession,
      targetMinutes: 10,
    })).toBe(true);
  });

  it("offers an inside split when exact saved targets have no curated subject tokens", () => {
    const exactTargetSession: LearningPlanSession = {
      ...session,
      title: "Explain the relationship",
      objective: "Explain the relationship represented in this session.",
      learningMode: "study",
      contentTargets: ["Explain this relationship", "DNA and RNA"],
      completionEvidence: ["Give a complete explanation", "Compare both acronyms"],
    };
    const insidePlan: LearningPlan = {
      ...plan,
      topic: "an arbitrary relationship",
      studyMode: "inside_yova",
      sessions: [exactTargetSession],
    };

    expect(canOfferAgendaSessionSplit({
      plan: insidePlan,
      session: exactTargetSession,
      targetMinutes: 10,
    })).toBe(true);
  });

  it("does not offer an inside split when projected parts need first teaching", () => {
    const insidePlan: LearningPlan = {
      ...plan,
      studyMode: "inside_yova",
      sessions: [session],
    };

    expect(canOfferAgendaSessionSplit({
      plan: insidePlan,
      session,
      targetMinutes: 10,
    })).toBe(false);
  });

  it.each(unsafeSplitCases)("does not offer a split for an %s", (_label, overrides) => {
    expect(canOfferAgendaSessionSplit({
      plan: overrides.plan ?? plan,
      session: overrides.session ?? session,
      targetMinutes: 10,
    })).toBe(false);
  });

  it("rejects a split when any collateral unfinished session is a scheduled retrieval", () => {
    const scheduledRetrieval: LearningPlanSession = {
      ...session,
      id: "10000000-1000-4000-8000-100000000002",
      sequence: 2,
      status: "upcoming",
      reviewConcept: "Krebs-cycle energy transfer",
      reviewType: "maintenance_transfer",
    };
    const planWithRetrieval = { ...plan, sessions: [session, scheduledRetrieval] };

    expect(canOfferAgendaSessionSplit({
      plan: planWithRetrieval,
      session,
      targetMinutes: 10,
    })).toBe(false);
  });

  it("rejects a split when the selected or collateral session has saved learner work", () => {
    const saved = {
      ...session,
      resource: {} as NonNullable<LearningPlanSession["resource"]>,
    };
    expect(canOfferAgendaSessionSplit({
      plan: { ...plan, sessions: [saved] },
      session: saved,
      targetMinutes: 10,
    })).toBe(false);

    const collateral = {
      ...session,
      id: "10000000-1000-4000-8000-100000000005",
      sequence: 2,
      status: "upcoming" as const,
    };
    expect(canOfferAgendaSessionSplit({
      plan: { ...plan, sessions: [session, collateral] },
      session,
      targetMinutes: 10,
      protectedSessionIds: new Set([collateral.id]),
    })).toBe(false);
  });

  it("normalizes untouched legacy short parts to the ten-minute floor", () => {
    const shortCollateral: LearningPlanSession = {
      ...session,
      id: "10000000-1000-4000-8000-100000000003",
      sequence: 2,
      status: "upcoming",
      estimatedMinutes: 8,
    };
    const planWithShortCollateral = { ...plan, sessions: [session, shortCollateral] };

    expect(canOfferAgendaSessionSplit({
      plan: planWithShortCollateral,
      session,
      targetMinutes: 10,
    })).toBe(true);

    const projected = buildContentBasedReplacementSessions(
      planWithShortCollateral.sessions.map(learningPlanSessionToAdjustableRow),
      10,
      1,
    );
    expect(projected).toHaveLength(3);
    expect(projected.map((replacement) => replacement.estimatedMinutes)).toEqual([
      10,
      10,
      10,
    ]);
    expect(projected.find((replacement) => replacement.id === shortCollateral.id))
      .toMatchObject({ estimatedMinutes: 10 });
  });

  it("rejects a split when the aggregate projected parts exceed the plan limit", () => {
    const longSessions = [1, 2].map((sequence): LearningPlanSession => ({
      ...session,
      id: `10000000-1000-4000-8000-${String(sequence + 10).padStart(12, "0")}`,
      sequence,
      status: sequence === 1 ? "ready" : "upcoming",
      estimatedMinutes: 90,
    }));
    const longPlan = { ...plan, sessions: longSessions };

    expect(canOfferAgendaSessionSplit({
      plan: longPlan,
      session: longSessions[0],
      targetMinutes: 10,
    })).toBe(false);
  });

  it("counts settled sessions against the projected plan limit", () => {
    const settledSessions = Array.from({ length: 13 }, (_, index): LearningPlanSession => ({
      ...session,
      id: `10000000-1000-4000-8000-${String(index + 20).padStart(12, "0")}`,
      sequence: index + 1,
      status: "complete",
    }));
    const unfinished = { ...session, sequence: 14 };
    const nearlyFullPlan = { ...plan, sessions: [...settledSessions, unfinished] };

    expect(canOfferAgendaSessionSplit({
      plan: nearlyFullPlan,
      session: unfinished,
      targetMinutes: 10,
    })).toBe(false);
  });

  it("accepts a whole-plan projection when every unfinished part remains runnable", () => {
    const collateral: LearningPlanSession = {
      ...session,
      id: "10000000-1000-4000-8000-100000000004",
      sequence: 2,
      status: "upcoming",
      estimatedMinutes: 20,
    };
    const runnablePlan = { ...plan, sessions: [session, collateral] };

    expect(canOfferAgendaSessionSplit({
      plan: runnablePlan,
      session,
      targetMinutes: 10,
    })).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { deltaFixture, deltaTopicId } from "@/evals/personalization-delta-fixture";
import { diagnosticResponsesFromMap } from "@/lib/diagnostics/placement-summary";
import { mapClaimsEvidence } from "@/lib/diagnostics/diagnostic-authority";
import { resolveInitialPlanSessionModes } from "@/lib/plan-generation/initial-session-mode";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

const ETC = deltaTopicId(4);
const report = { source: "learner_report", outcome: "covered_elsewhere", checked: false } as const;
const measured = { source: "placement_check", outcome: "gap", observedAt: "2026-09-07T08:00:00.000Z" } as const;
function mapWithReportedETC() {
  const map = structuredClone(deltaFixture(1).request.knowledgeMap!);
  // The cast allows the old schema to exercise the old behavior on main;
  // assertions concern learner-visible placement and session mode.
  const topic = map.topics.find(item => item.id === ETC)!;
  Object.assign(topic, { initialEvidence: report });
  return map;
}

describe("learned-elsewhere declarations are not scored placement", () => {
  it("does not show an incorrect placement result for an unchecked learner report", () => {
    const map = mapWithReportedETC();
    expect(diagnosticResponsesFromMap(map, [])).toEqual([]);
    expect(map.topics.find(item => item.id === ETC)!.status).toBe("not_started");
  });

  it("starts the reported topic in Practice while retaining the previous measured gap", () => {
    const map = mapWithReportedETC();
    Object.assign(map.topics.find(item => item.id === ETC)!, { placementEvidence: measured });
    map.placementCheck = { status: "completed", completedAt: measured.observedAt, demonstratedTopicIds: [], gapTopicIds: [ETC] };
    const decision = resolveInitialPlanSessionModes({
      learningIntentRecommendation: { intent: "learn", basis: "Begin new topics with teaching." },
      knowledgeMap: map,
      sessions: [{ key: "next-etc", topicIds: [ETC] }],
    });
    expect(decision[0]!.learningMode).toBe("study");
    expect(decision[0]!.targetDecisions[0]!.evidenceRefs).toEqual([]);
    expect(diagnosticResponsesFromMap(map, [])).toEqual([{
      questionId: ETC, topicId: ETC, question: "Placement evidence for Electron transport chain",
      answer: "Server-scored placement check", evaluation: "incorrect",
    }]);
  });

  it("requires server receipt authority for retained placement instead of accepting a forged hidden gap", () => {
    const map = structuredClone(deltaFixture(1).request.knowledgeMap!) as PlanKnowledgeMap;
    Object.assign(map.topics.find(item => item.id === ETC)!, { initialEvidence: null, placementEvidence: measured });
    expect(mapClaimsEvidence(map)).toBe(true);
  });
});

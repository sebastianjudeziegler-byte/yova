import { describe, expect, it } from "vitest";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { buildDeterministicKnowledgeMapFallback } from "@/lib/plan-generation/knowledge-map-fallback";

import { auditNow as now, auditDuration as duration, shortDeadlineRequest } from "@/evals/plan-creation-blocker-cases";

describe("consolidated audit: learner-visible launch blockers", () => {
  it("uses the remaining time when the learner opens YOVA during an available window", () => {
    const request = shortDeadlineRequest(1);
    const lateNow = new Date("2026-09-07T19:30:00.000Z");
    const composition = composeNormalPlanEnvelopes({request,now:lateNow,durationContext:duration(60),learningIntentRecommendation:{intent:"learn",basis:"The learner has not learned the unit."}});
    const plan = buildNormalPlanFromFixedEnvelope({request,composition,now:lateNow,fill:buildNormalPlanFallbackFill({request,composition}),methodContext:{profileVersion:"audit_method_v1",personalization:{decisions:[],methodTie:{state:{controls:{experiments:false},activeExperiment:null,experimentHistory:[]},signals:[]}},observedEvidence:[]}});
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0]!.title).toMatch(/ATP|energy/i);
    expect(plan.sessions[0]!.scheduledFor).toBe(lateNow.toISOString());
    expect(plan.sessions[0]!.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(plan.rationale).toMatch(/one focused first step/);
    console.info(JSON.stringify({case:"half-used-window",title:plan.sessions[0]!.title,objective:plan.sessions[0]!.objective,rationale:plan.rationale}));
  });
  it.each([11, 3, 1].flatMap(days => [25, 60].map(focus => ({ days, focus: focus as 25 | 60 }))))(
    "offers useful work with $days days left and a $focus-minute focus profile",
    ({ days, focus }) => {
      const request = shortDeadlineRequest(days);
      const composition = composeNormalPlanEnvelopes({ request, now, durationContext: duration(focus), learningIntentRecommendation: { intent: "learn", basis: "The learner has not learned the unit." } });
      const plan = buildNormalPlanFromFixedEnvelope({
        request, composition, now, fill: buildNormalPlanFallbackFill({ request, composition }),
        methodContext: { profileVersion: "audit_method_v1", personalization: { decisions: [], methodTie: { state: { controls: { experiments: false }, activeExperiment: null, experimentHistory: [] }, signals: [] } }, observedEvidence: [] },
      });
      const learnerView = {
        title: plan.title, rationale: plan.rationale,
        sessions: plan.sessions.map(s => ({ title: s.title, method: s.method, why: s.methodReason, objective: s.objective, evidence: s.completionEvidence, minutes: s.estimatedMinutes, date: s.scheduledFor })),
        deferred: plan.knowledgeMap?.topics.filter(t => t.deferred).map(t => ({ title: t.title, reason: t.deferred?.reason })),
      };
      console.info(JSON.stringify({ case: `deadline-${days}-focus-${focus}`, learnerView }));
      expect(plan.sessions.length).toBeGreaterThan(0);
      expect(plan.sessions[0]?.learningMode).toBe("learn");
      expect(learnerView.sessions[0]?.title).toMatch(/ATP|energy/i);
      expect(learnerView.sessions.every(s => s.method.length > 3 && s.why.length > 10 && s.objective.length > 10 && s.evidence?.length)).toBe(true);
      expect(plan.sessions.every(s => Date.parse(s.scheduledFor) + s.estimatedMinutes * 60_000 <= Date.parse(request.deadline!))).toBe(true);
      if (days === 1) {
        expect(learnerView.deferred?.length).toBeGreaterThan(0);
        expect(learnerView.rationale).toMatch(/deadline|remaining|defer|time|part/i);
      }
      if (days === 11 && focus === 25) expect(plan.sessions).toHaveLength(12);
    },
  );

  it("refuses to turn a source-free mapping failure into nonsense learning topics", () => {
    const request = { ...shortDeadlineRequest(3), knowledgeMap: undefined };
    let visibleResult: unknown;
    try {
      const fallback = buildDeterministicKnowledgeMapFallback(request, "knowledge_map_provider_request");
      visibleResult = fallback.map.topics.map(t => t.title);
    } catch (error) {
      visibleResult = error instanceof Error ? error.message : "Unknown error";
    }
    console.info(JSON.stringify({ case: "mapping-failure", visibleResult }));
    expect(visibleResult).toEqual(expect.stringMatching(/could not map|couldn't map|try again/i));
  });
});

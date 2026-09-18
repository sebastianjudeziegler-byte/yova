import { describe, expect, it } from "vitest";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  NormalPlanEnvelopeComposerError,
  composeNormalPlanEnvelopes,
  type NormalPlanDurationContext,
} from "@/lib/plan-generation/normal-plan-envelopes";

const NOW = new Date("2026-08-10T08:00:00.000Z");
const OBSERVED_AT = "2026-08-09T12:00:00.000Z";
const IDS = Array.from({ length: 10 }, (_, index) => (
  `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`
));

describe("topic composition compatibility and safety", () => {
  it("keeps each topic in the queue with later independent practice", () => {
    const result=compose(request({intent:"learn",topics:[topic(0),topic(1)]}));
    expect(result.version).toBe(NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION);
    expect(result.envelopes.filter(b=>b.learningMode==="learn").map(b=>b.topicIds)).toEqual([[IDS[0]],[IDS[1]]]);
    expect(result.envelopes.filter(b=>b.learningMode==="study").map(b=>b.topicIds)).toEqual([[IDS[0]],[IDS[1]]]);
    expect(result.deferrals).toEqual([]);
  });
  it("uses practice placeholders for an explicit study request",()=>{
    const result=compose(request({intent:"study",topics:[topic(0),topic(1)]}));
    expect(result.envelopes).toHaveLength(2);
    expect(result.envelopes.every(b=>b.learningMode==="study"&&b.workload?.practicePlaceholder)).toBe(true);
  });
  it("placement gaps take precedence over stale knowledge status",()=>{
    const gap=topic(0,{status:"secure",initialEvidence:{source:"placement_check",outcome:"gap",observedAt:OBSERVED_AT}});
    const result=compose(request({intent:"study",topics:[gap],placementCheck:{status:"completed",completedAt:OBSERVED_AT,gapTopicIds:[IDS[0]!],demonstratedTopicIds:[]}}));
    expect(result.envelopes[0]!.learningMode).toBe("learn");
    expect(result.envelopes.at(-1)!.learningMode).toBe("study");
  });
  it("keeps prerequisites ahead of dependents without reordering unrelated map topics by model ratings",()=>{
    const result=compose(request({intent:"learn",topics:[topic(1,{prerequisiteTopicIds:[IDS[0]!]}),topic(0),topic(2)]}));
    expect(result.envelopes.filter(b=>b.learningMode==="learn").map(b=>b.topicIds[0])).toEqual([IDS[0],IDS[1],IDS[2]]);
  });
  it("preserves explicit and transitive map deferrals",()=>{
    const result=compose(request({intent:"learn",topics:[topic(0,{deferred:{reason:"Outside the accepted unit for this plan."}}),topic(1,{prerequisiteTopicIds:[IDS[0]!]}),topic(2)]}));
    expect(result.deferrals.map(d=>d.reasonCode)).toEqual(["accepted_map_deferral","prerequisite_deferred"]);
    expect(new Set(result.envelopes.flatMap(b=>b.topicIds))).toEqual(new Set([IDS[2]]));
  });
  it("keeps measured prerequisite provenance on the dependent topic",()=>{
    const result=compose(request({intent:"learn",topics:[topic(0,{status:"evidenced",initialEvidence:{source:"placement_check",outcome:"demonstrated",observedAt:OBSERVED_AT}}),topic(1,{prerequisiteTopicIds:[IDS[0]!]} )],placementCheck:{status:"completed",completedAt:OBSERVED_AT,demonstratedTopicIds:[IDS[0]!],gapTopicIds:[]}}));
    expect(result.envelopes.find(b=>b.topicIds.includes(IDS[1]!))!.prerequisiteEvidenceRefs).toContain(`placement:${IDS[0]}:${OBSERVED_AT}`);
  });
  it.each(["evidenced","secure"] as const)("preserves %s prerequisite provenance",status=>{
    const result=compose(request({intent:"learn",topics:[topic(0,{status}),topic(1,{prerequisiteTopicIds:[IDS[0]!]} )]}));
    expect(result.envelopes.find(b=>b.topicIds.includes(IDS[1]!))!.prerequisiteEvidenceRefs).toContain(`knowledge-map-topic:${IDS[0]}:status:${status}`);
  });
  it("rejects duplicate IDs, missing prerequisites and cycles",()=>{
    expectComposerError(()=>compose(request({intent:"learn",topics:[topic(0),topic(0)]})),"duplicate_topic_id");
    expectComposerError(()=>compose(request({intent:"learn",topics:[topic(0,{prerequisiteTopicIds:[IDS[9]!]})]})),"unknown_prerequisite");
    expectComposerError(()=>compose(request({intent:"learn",topics:[topic(0,{prerequisiteTopicIds:[IDS[1]!]}),topic(1,{prerequisiteTopicIds:[IDS[0]!]})]})),"prerequisite_cycle");
  });
  it("rejects a passed deadline without pretending a plan can meet it",()=>{
    expectComposerError(()=>compose(request({intent:"learn",topics:[topic(0)],deadline:"2026-08-09T08:00:00.000Z"})),"deadline_passed");
  });
  it("is deterministic, deeply frozen, and never mutates inputs",()=>{
    const currentRequest=request({intent:"learn",topics:[topic(0),topic(1)]});
    const context=durationContext(),before=structuredClone({request:currentRequest,context});
    const a=compose(currentRequest,context),b=compose(currentRequest,context);
    expect(a).toEqual(b);expect({request:currentRequest,context}).toEqual(before);
    expect(Object.isFrozen(a)).toBe(true);expect(Object.isFrozen(a.envelopes[0]!.timing)).toBe(true);
    expect(Reflect.set(a.envelopes[0]!,"learningMode","study")).toBe(false);
  });
});

function compose(
  currentRequest: PlanGenerationRequest,
  context = durationContext(),
  now = NOW,
) {
  return composeNormalPlanEnvelopes({
    request: currentRequest,
    learningIntentRecommendation: {
      intent: currentRequest.learningIntent,
      basis: currentRequest.learningIntent === "learn"
        ? "The learner said the material is new."
        : "The learner said this is review.",
    },
    durationContext: context,
    now,
    searchDays: 1,
  });
}

function request({
  intent,
  topics,
  scope: currentScope = scope(),
  placementCheck = {
    status: "skipped" as const,
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
  availability = [{ day: "Monday", window: "Morning", minutes: 60 }],
  deadline = null,
  goal = "Build a reliable understanding of the accepted knowledge-map scope.",
  startingContext = intent === "learn" ? "This material is new to me." : "I have learned this before.",
}: {
  intent: "learn" | "study";
  topics: PlanKnowledgeMap["topics"];
  scope?: PlanKnowledgeMap["scopeJudgment"];
  placementCheck?: PlanKnowledgeMap["placementCheck"];
  availability?: PlanGenerationRequest["availability"];
  deadline?: string | null;
  goal?: string;
  startingContext?: string;
}): PlanGenerationRequest {
  const knowledgeMap: PlanKnowledgeMap = {
    version: 1,
    scopeJudgment: currentScope,
    topics,
    placementCheck,
  };
  return {
    intent: "plan",
    learningIntent: intent,
    goal,
    startingContext,
    materialMode: "none",
    materials: [],
    studyMode: "inside",
    deadline,
    timeZone: "UTC",
    diagnosticResponses: [],
    availability,
    profileSummary: "Use a clear ordinary plan while evidence is still limited.",
    knowledgeMap,
  };
}

function topic(
  index: number,
  overrides: Partial<PlanKnowledgeMap["topics"][number]> = {},
): PlanKnowledgeMap["topics"][number] {
  return {
    id: IDS[index]!,
    title: `Concept ${index + 1}`,
    description: `Understand and explain the relationship for concept ${index + 1}.`,
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    ...overrides,
  };
}

function scope(
  overrides: Partial<PlanKnowledgeMap["scopeJudgment"]> = {},
): PlanKnowledgeMap["scopeJudgment"] {
  return {
    band: "unit_or_exam",
    label: "Bounded test scope",
    minimumSessions: 1,
    recommendedSessions: 2,
    maximumSessions: 4,
    minimumTeachingSessions: 0,
    explanation: "This accepted fixture defines a bounded scope for deterministic composition.",
    ...overrides,
  };
}

function durationContext({
  sustainableMinutes = null,
  preferredWindow = null,
}: {
  sustainableMinutes?: 10 | 15 | 25 | 45 | 60 | null;
  preferredWindow?: "morning" | "afternoon" | "evening" | "late_night" | "varies" | null;
} = {}): NormalPlanDurationContext {
  return {
    profileVersion: "authorized_profile_snapshot:test-v1",
    profile: {
      sustainableMinutes,
      startingFrictionRisk: null,
      fatigueRisk: null,
      preferredWindow,
      evidenceRefs: {
        sustainableMinutes: sustainableMinutes === null ? [] : ["profile:sustainable"],
        startingFrictionRisk: [],
        fatigueRisk: [],
        preferredWindow: preferredWindow === null ? [] : ["profile:window"],
      },
    },
    recentOutcomes: [],
  };
}

function expectComposerError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error("Expected the composer to reject the fixture.");
  } catch (error) {
    expect(error).toBeInstanceOf(NormalPlanEnvelopeComposerError);
    expect((error as NormalPlanEnvelopeComposerError).code).toBe(code);
  }
}

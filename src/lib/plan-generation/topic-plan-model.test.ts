import { describe, expect, it } from "vitest";
import { composeNormalPlanEnvelopes, type NormalPlanDurationContext } from "./normal-plan-envelopes";
import { PlanGenerationRequestSchema } from "./schema";
import { emptyOnboardingAnswers, type OnboardingAnswerValues } from "@/lib/onboarding/answers";

const now = new Date("2026-09-17T08:00:00.000Z");
const id = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function run(answers: OnboardingAnswerValues = {}, options: { deadline?: string | null; subtopics?: number; covered?: boolean; availability?: { day: string; window: string; minutes: number }[] } = {}) {
  const request = PlanGenerationRequestSchema.parse({ intent: "plan", learningIntent: "learn", goal: "Learn A-level biology cell transport and explain unfamiliar applications.", materialMode: "none", materials: [], studyMode: "inside", deadline: options.deadline ?? null, timeZone: "UTC", diagnosticResponses: [], profileSummary: "Use my saved learner profile.", availability: options.availability ?? [{ day: "Every day", window: "Morning", minutes: 180 }, { day: "Every day", window: "Evening", minutes: 180 }], knowledgeMap: { version: 1, scopeJudgment: { band: "unit_or_exam", label: "Cell transport", minimumSessions: 2, recommendedSessions: 4, maximumSessions: 6, minimumTeachingSessions: 1, explanation: "Learn transport and apply it to unfamiliar situations." }, topics: [1, 2].map(i => ({ id: id(i), title: i === 1 ? "Diffusion" : "Osmosis", description: "Explain the movement of particles across membranes.", subtopics: Array.from({ length: options.subtopics ?? 6 }, (_, n) => `Transport relationship ${i}.${n}`), prerequisiteTopicIds: i === 2 ? [id(1)] : [], status: "not_started", initialEvidence: options.covered ? { source: "learner_report", outcome: "covered_elsewhere", checked: false } : null, sourceReferences: [], origin: "ai_generated", deferred: null })), placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } } });
  const durationContext: NormalPlanDurationContext = { profileVersion: "authorized_profile:test", profile: { sustainableMinutes: 45, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } }, recentOutcomes: [], onboardingAnswers: { ...emptyOnboardingAnswers(), answers } };
  return composeNormalPlanEnvelopes({ request, durationContext, now, learningIntentRecommendation: { intent: "learn", basis: "The learner is studying these new topics." } });
}

describe("Brief 2 topic plan model", () => {
  it("has deterministic topic blocks and carries a substantive content-derived workload", () => {
    const plan = run({ session_length: "minutes_45_60", prove_knowing: "answer_questions" });
    expect(plan.planModel?.version).toBe("topic_plan_v2");
    expect(plan.envelopes.every(block => block.workload?.estimatedMinutes === block.timing.activeMinutes)).toBe(true);
    const practice = plan.envelopes.find(block => block.learningMode === "study")!;
    expect(practice.workload?.questionCount).toBeGreaterThan(15);
    expect(practice.timing.activeMinutes).toBeLessThanOrEqual(60);
    expect(plan.deferrals).toEqual([]);
  });
  it.each([
    ["Q1", { energy_window: "evening" }, "P1.energy.evening"],
    ["Q2", { session_length: "minutes_10_15" }, "P2.capacity.minutes_10_15"],
    ["Q3", { focus_loss: "often" }, "P3.focus.often"],
    ["Q4", { guidance: "learner_choice" }, "P4.guidance.learner_choice"],
    ["Q5", { difficulty_help: "step_by_step" }, "P5.difficulty.step_by_step"],
    ["Q6", { prove_knowing: "map_it" }, "P6.produce.map_it"],
    ["Q7", { gist_detail: "detail_leaning" }, "P7.weighting.detail_leaning"],
    ["Q8", { starting_pattern: "often_delay" }, "P8.start.often_delay"],
    ["Q9", { support_needs: ["frequent_check_ins"] }, "P9.support.frequent_check_ins"],
    ["Q10", { extra_context: "forget_during_tests" }, "P10.extra.forget_during_tests"],
  ] as const)("records the effective %s rule", (_, answers, rule) => {
    const plan = run(answers as OnboardingAnswerValues);
    expect(plan.planModel?.ruleIds).toContain(rule);
    expect(plan.planModel?.personalizationSentence).not.toBe("");
  });
  it("changes block count, timing and placement between supported and independent profiles", () => {
    const supported = run({ session_length: "minutes_10_15", focus_loss: "often", difficulty_help: "step_by_step", energy_window: "morning", starting_pattern: "often_delay" });
    const independent = run({ session_length: "minutes_45_60", focus_loss: "rarely", energy_window: "evening", starting_pattern: "on_time" });
    expect(supported.envelopes.length).toBeGreaterThan(independent.envelopes.length);
    expect(supported.envelopes[0]!.scheduledFor).not.toBe(independent.envelopes[0]!.scheduledFor);
    expect(supported.envelopes[0]!.timing.activeMinutes).toBeLessThan(independent.envelopes[0]!.timing.activeMinutes);
  });
  it("enacts each plan-level adaptation rather than recording an unused rule",()=>{
    const energy=run({energy_window:"evening"});
    expect(new Date(energy.envelopes.find(b=>b.learningMode==="learn")!.scheduledFor).getUTCHours()).toBe(19);
    const focus=run({focus_loss:"often"});
    const dates=focus.envelopes.map(b=>b.scheduledFor.slice(0,10));
    expect(new Set(dates).size).toBe(dates.length);
    const choice=run({guidance:"learner_choice"});
    expect(choice.planModel?.scheduleMode).toBe("learner_placed");
    expect(choice.envelopes.every(b=>b.workload?.suggestedDate===false)).toBe(true);
    const steps=run({difficulty_help:"step_by_step",session_length:"minutes_10_15"});
    const learnDates=steps.envelopes.filter(b=>b.learningMode==="learn").map(b=>b.scheduledFor.slice(0,10));
    expect(new Set(learnDates).size).toBe(learnDates.length);
    const detail=run({gist_detail:"detail_leaning"}).envelopes.find(b=>b.learningMode==="study")!.workload!;
    const gist=run({gist_detail:"gist_leaning"}).envelopes.find(b=>b.learningMode==="study")!.workload!;
    expect(detail.transferQuestionCount/detail.questionCount).toBeGreaterThan(gist.transferQuestionCount/gist.questionCount);
    const delayed=run({starting_pattern:"often_delay"});
    expect(Date.parse(delayed.envelopes[0]!.scheduledFor)-now.getTime()).toBeLessThanOrEqual(86_400_000);
    expect(delayed.envelopes.every(b=>b.timing.activeMinutes>=delayed.envelopes[0]!.timing.activeMinutes)).toBe(true);
    const standardPractice=run().envelopes.find(b=>b.learningMode==="study")!;
    const earlier=run({support_needs:["frequent_check_ins"]}).envelopes.find(b=>b.learningMode==="study")!;
    expect(Date.parse(earlier.scheduledFor)).toBeLessThan(Date.parse(standardPractice.scheduledFor));
    expect(run({extra_context:"forget_during_tests"}).envelopes.filter(b=>b.learningMode==="study")).toHaveLength(4);
    expect(run({extra_context:"long_plan_shutdown"}).planModel?.collapsedQueue).toBe(true);
  });
  it("reserves supported return practice before later learning fills every available day",()=>{
    const plan=run({session_length:"minutes_10_15",focus_loss:"often",difficulty_help:"step_by_step",support_needs:["shorter_sections","frequent_check_ins"],extra_context:"forget_during_tests"});
    const firstTopicLearn=plan.envelopes.filter(block=>block.topicIds[0]===id(1)&&block.learningMode==="learn");
    const lastLearn=firstTopicLearn.at(-1)!;
    const rounds=plan.envelopes.filter(block=>block.topicIds[0]===id(1)&&block.learningMode==="study").sort((a,b)=>a.workload!.practiceRound-b.workload!.practiceRound);
    const firstGap=(Date.parse(rounds[0]!.scheduledFor)-Date.parse(lastLearn.scheduledFor)-lastLearn.timing.activeMinutes*60_000)/86_400_000;
    expect(firstGap).toBeGreaterThanOrEqual(1);
    expect(firstGap).toBeLessThan(2);
    expect(Date.parse(rounds[1]!.scheduledFor)-Date.parse(rounds[0]!.scheduledFor)).toBeGreaterThanOrEqual(7*86_400_000);
    expect(plan.envelopes.map(block=>block.scheduledFor)).toEqual(plan.envelopes.map(block=>block.scheduledFor).sort());
    expect(plan.envelopes.findIndex(block=>block===rounds[0])).toBeLessThan(plan.envelopes.findLastIndex(block=>block.learningMode==="learn"));
  });
  it.each([[7,3],[14,5]])("measures later return spacing from the preceding practice for a %i-day deadline",(days,laterGap)=>{
    const plan=run({extra_context:"forget_during_tests"},{deadline:new Date(now.getTime()+days*86_400_000).toISOString(),subtopics:1});
    const rounds=plan.envelopes.filter(block=>block.topicIds[0]===id(1)&&block.learningMode==="study").sort((a,b)=>a.workload!.practiceRound-b.workload!.practiceRound);
    expect(Date.parse(rounds[1]!.scheduledFor)-Date.parse(rounds[0]!.scheduledFor)).toBeGreaterThanOrEqual(laterGap*86_400_000);
  });

  it("does not credit a produce preference that support overrides",()=>{
    const plan=run({prove_knowing:"explain_back",support_needs:["reduced_text_visual_structure"]});
    expect(plan.planModel?.ruleIds).not.toContain("P6.produce.explain_back");
  });
  it("keeps every subtopic exactly once across no more than three learn blocks", () => {
    const plan = run({ session_length: "minutes_10_15", support_needs: ["shorter_sections"] }, { subtopics: 12 });
    const learns = plan.envelopes.filter(block => block.topicIds.includes(id(1)) && block.learningMode === "learn");
    expect(learns).toHaveLength(3);
    const parts = learns.flatMap(block => block.workload?.topicSubtopics[0]?.subtopics ?? []);
    expect(parts).toHaveLength(12);
    expect(new Set(parts).size).toBe(12);
  });
  it("never splits a topic without subtopics or a practice placeholder", () => {
    const plan = run({ session_length: "minutes_10_15" }, { subtopics: 0, covered: true });
    expect(plan.envelopes.every(block => block.learningMode === "study")).toBe(true);
    expect(plan.envelopes).toHaveLength(2);
  });
  // Brief 2.5 root cause 2 replaces "keeps the full queue" (blocks after the
  // deadline, with a note): first passes lead and nothing lands after it.
  it("puts first passes first under a close deadline and places nothing after it", () => {
    const deadline = "2026-09-18T21:00:00.000Z";
    const plan = run({ difficulty_help: "step_by_step" }, { deadline, availability: [{ day: "Every day", window: "Evening", minutes: 60 }] });
    expect(plan.envelopes.every(block => Date.parse(block.scheduledFor) + block.timing.activeMinutes * 60_000 <= Date.parse(deadline))).toBe(true);
    expect(plan.envelopes[0]!.learningMode).toBe("learn");
    for (const topicId of [id(1), id(2)]) expect(plan.envelopes.some(block => block.topicIds.includes(topicId)) || plan.deferrals.some(item => item.topicId === topicId && /deadline/i.test(item.reason))).toBe(true);
    expect(plan.planModel?.ruleIds).toContain("plan.deadline.first_passes");
  });
  it("refuses, with the fix named, when no study window falls before the deadline", () => {
    expect(() => run({}, { deadline: "2026-09-17T10:00:00.000Z", availability: [{ day: "Every day", window: "Evening", minutes: 60 }] }))
      .toThrow(/before the deadline/);
  });
});

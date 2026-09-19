import { describe, expect, it } from "vitest";
import { composeNormalPlanEnvelopes, type NormalPlanDurationContext } from "./normal-plan-envelopes";
import { PlanGenerationRequestSchema } from "./schema";
import { emptyOnboardingAnswers, type OnboardingAnswerValues } from "@/lib/onboarding/answers";

/**
 * Brief 2.5 root cause 4 (finding 20). The plan's "why" text
 * stitched every fired rule's canned reason: nine sentences, "dense topics stop
 * at three learning blocks" on a plan with no learning blocks, and "a
 * 11-minute". It must be "because you said X, YOVA did Y", only for what the
 * plan actually does.
 */
const now = new Date("2026-09-18T09:00:00.000Z");
const id = (i: number) => `93000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function compose(answers: OnboardingAnswerValues, options: { covered?: boolean; deadlineDays?: number; subtopics?: number } = {}) {
  const request = PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: "learn", goal: "Learn cell transport and explain unfamiliar applications.",
    materialMode: "none", materials: [], studyMode: "inside", timeZone: "UTC", diagnosticResponses: [], profileSummary: "Use my saved learner profile.",
    deadline: options.deadlineDays ? new Date(now.getTime() + options.deadlineDays * 86_400_000).toISOString() : null,
    availability: [{ day: "Every day", window: "Morning", minutes: 120 }, { day: "Every day", window: "Evening", minutes: 120 }],
    knowledgeMap: { version: 1, scopeJudgment: { band: "unit_or_exam", label: "Cell transport", minimumSessions: 2, recommendedSessions: 4, maximumSessions: 12, minimumTeachingSessions: 1, explanation: "Learn transport and apply it." },
      topics: [1, 2].map(i => ({ id: id(i), title: i === 1 ? "Diffusion" : "Osmosis", description: "Explain movement of particles across membranes.",
        subtopics: Array.from({ length: options.subtopics ?? 12 }, (_, n) => `Transport idea ${i}.${n}`), prerequisiteTopicIds: [], status: "not_started",
        initialEvidence: options.covered ? { source: "learner_report", outcome: "covered_elsewhere", checked: false } : null, sourceReferences: [], origin: "ai_generated", deferred: null })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } },
  });
  const durationContext: NormalPlanDurationContext = { profileVersion: "authorized_profile:sentence", profile: { sustainableMinutes: 45, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } }, recentOutcomes: [], onboardingAnswers: { ...emptyOnboardingAnswers(), answers } };
  return composeNormalPlanEnvelopes({ request, durationContext, now, learningIntentRecommendation: { intent: "learn", basis: "These topics are new." } }).planModel!;
}
const sentences = (text: string) => text.split(/(?<=\.)\s+(?=Because )/).filter(Boolean);

describe("the plan's why text is because-you-said, for what the plan does", () => {
  it("never claims learning blocks on a plan with none", () => {
    const model = compose({ session_length: "minutes_10_15", focus_loss: "often", prove_knowing: "explain_back" }, { covered: true });
    expect(model.topicNotes.every(note => note.learnBlockCount === 0)).toBe(true);
    expect(model.personalizationSentence).not.toMatch(/learning block|three learning blocks|Dense topics/i);
  });
  it("says the learner's own ceiling without 'a 11-minute'", () => {
    const model = compose({ session_length: "minutes_10_15", support_needs: ["shorter_sections"] });
    expect(model.personalizationSentence).not.toMatch(/\ba 11-minute\b/);
    expect(model.personalizationSentence).toMatch(/Because you said 10 to 15 minutes feels realistic, YOVA keeps each block to at most 11 minutes\./);
  });
  it("does not claim an extra practice round the deadline left out", () => {
    const model = compose({ extra_context: "forget_during_tests" }, { deadlineDays: 1, subtopics: 1 });
    const extraRoundPlaced = model.ruleIds.includes("P10.extra.forget_during_tests");
    expect(model.personalizationSentence.includes("extra practice round")).toBe(extraRoundPlaced);
  });
  it("is one because-you-said sentence per enacted rule and nothing else", () => {
    const model = compose({ energy_window: "evening", session_length: "minutes_20_30", guidance: "learner_choice", gist_detail: "detail_leaning", starting_pattern: "often_delay" });
    const parts = sentences(model.personalizationSentence);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(part).toMatch(/^Because (you said|your deadline is) [^,]+, .+\.$/);
    expect(model.personalizationSentence).toContain("Because you said “I intend to begin but often delay”, YOVA makes the first block short");
  });
});

import { describe, expect, it } from "vitest";
import { composeNormalPlanEnvelopes, NormalPlanEnvelopeComposerError, type NormalPlanDurationContext } from "./normal-plan-envelopes";
import { buildDeadlinePriority } from "./deadline-priority";
import { PlanGenerationRequestSchema } from "./schema";
import { emptyOnboardingAnswers, type OnboardingAnswerValues } from "@/lib/onboarding/answers";

/**
 * Brief 2.5 root cause 2 (findings 8-13, 32, 36, 62, 72). The scheduler looked
 * for time a year past the deadline and only noted "after the deadline", so a
 * test-prep plan was a queue of blocks after the test. No block may finish
 * after the deadline: spacing compresses first, then the lowest-priority
 * practice is left out with a reason, then the lowest-priority topics are
 * deferred with a reason. A deadline minutes away gets the priority card.
 */
const now = new Date("2026-09-18T09:00:00.000Z"); // a Friday morning, as in the audit
const MINUTE = 60_000, DAY = 86_400_000;
const id = (i: number) => `92000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const titles = ["ATP and energy transfer", "Glycolysis", "Link reaction", "Krebs cycle", "Electron transport chain", "Chemiosmosis"];

function request(deadlineInMs: number, availability = [{ day: "Every day", window: "Evening", minutes: 45 }]) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: "learn", goal: "I have a biology test on cellular respiration.",
    materialMode: "none", materials: [], studyMode: "inside",
    deadline: new Date(now.getTime() + deadlineInMs).toISOString(), timeZone: "UTC", diagnosticResponses: [],
    availability, profileSummary: "Use my saved learner profile.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: { band: "unit_or_exam", label: "Cellular respiration", minimumSessions: 6, recommendedSessions: 12, maximumSessions: 14, minimumTeachingSessions: 6, explanation: "Learn each stage, then practise it." },
      topics: titles.map((title, index) => ({
        id: id(index + 1), title, description: `Explain ${title} and its place in respiration.`,
        subtopics: ["Inputs and outputs", "Where it happens", "Why it matters"], prerequisiteTopicIds: index ? [id(index)] : [],
        status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null,
      })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
}
function compose(req: ReturnType<typeof request>, answers: OnboardingAnswerValues = {}) {
  const durationContext: NormalPlanDurationContext = { profileVersion: "authorized_profile:deadline", profile: { sustainableMinutes: 45, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } }, recentOutcomes: [], onboardingAnswers: { ...emptyOnboardingAnswers(), answers } };
  return composeNormalPlanEnvelopes({ request: req, durationContext, now, learningIntentRecommendation: { intent: "learn", basis: "These topics have not been learned yet." } });
}
const afterDeadline = (plan: ReturnType<typeof compose>, deadline: string) => plan.envelopes.filter(block => Date.parse(block.scheduledFor) + block.timing.activeMinutes * MINUTE > Date.parse(deadline));

describe("no block is ever suggested after the deadline", () => {
  it.each([["3-day", 3], ["8-day", 8]] as const)("%s deadline: zero blocks after it, and every topic is scheduled or deferred with a reason", (_, days) => {
    const req = request(days * DAY);
    const plan = compose(req);
    expect(afterDeadline(plan, req.deadline!)).toEqual([]);
    expect(plan.planModel?.constraints?.join(" ") ?? "").not.toMatch(/after the deadline/);
    const scheduled = new Set(plan.envelopes.flatMap(block => block.topicIds));
    for (const topicId of titles.map((_, i) => id(i + 1))) {
      const deferral = plan.deferrals.find(item => item.topicId === topicId);
      expect(scheduled.has(topicId) || deferral?.reasonCode === "deadline_capacity", `topic ${topicId}`).toBe(true);
      if (deferral) expect(deferral.reason).toMatch(/deadline/i);
      // A scheduled topic is taught before the test, not only practised.
      if (scheduled.has(topicId)) expect(plan.envelopes.some(block => block.topicIds.includes(topicId) && block.learningMode === "learn")).toBe(true);
    }
  });

  it("8-day deadline keeps practice for the topics it teaches", () => {
    const plan = compose(request(8 * DAY));
    expect(plan.envelopes.some(block => block.learningMode === "study")).toBe(true);
    expect(plan.deferrals).toEqual([]);
  });

  it("3-day deadline states what was left out and why", () => {
    const plan = compose(request(3 * DAY));
    const leftOut = plan.deferrals.length + (plan.planModel?.constraints?.length ?? 0);
    expect(leftOut).toBeGreaterThan(0);
    expect([...plan.deferrals.map(item => item.reason), ...(plan.planModel?.constraints ?? [])].every(text => /deadline/i.test(text))).toBe(true);
  });

  it("9-minute deadline outside every study window: the priority card, not a plan", () => {
    const req = request(9 * MINUTE);
    const card = buildDeadlinePriority(req, now);
    expect(card?.kind).toBe("deadline_priority");
    expect(card?.priority.minutes).toBe(9);
    expect(card?.priority.startsAt).toBe(now.toISOString());
    expect(card?.priority.progressCredit).toBe(false);
    // The composer never falls back to blocks after the test.
    expect(() => compose(req)).toThrow(NormalPlanEnvelopeComposerError);
  });

  it("Q8 starts late: with every evening available the first block is within 24 hours, with no banner", () => {
    const plan = compose(request(8 * DAY), { starting_pattern: "often_delay" });
    expect(Date.parse(plan.envelopes[0]!.scheduledFor) - now.getTime()).toBeLessThanOrEqual(DAY);
    expect(plan.planModel?.constraints?.join(" ") ?? "").not.toMatch(/more than 24 hours/);
  });
});

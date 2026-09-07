import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import type { NormalPlanDurationContext } from "@/lib/plan-generation/normal-plan-envelopes";

export const auditNow = new Date("2026-09-07T08:00:00.000Z");
const topicTitles = ["ATP and energy transfer", "Glycolysis", "Link reaction", "Krebs cycle", "Electron transport chain", "Chemiosmosis"];

export function shortDeadlineRequest(days: number) {
  return PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: "learn",
    goal: "Teach me cellular respiration from scratch for my test, including ATP, glycolysis, the link reaction, Krebs cycle, electron transport and chemiosmosis.",
    startingContext: "I have not learned this unit yet. Teach me before independent practice.",
    materialMode: "none", materials: [], studyMode: "inside",
    deadline: new Date(auditNow.getTime() + days * 86_400_000 + 15 * 3_600_000).toISOString(),
    timeZone: "UTC", diagnosticResponses: [],
    availability: ["Monday", "Wednesday", "Friday"].map(day => ({ day, window: "Evening", minutes: 45 })),
    profileSummary: "I need a concrete example and a small first step before independent practice.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: { band: "unit_or_exam", label: "Cellular respiration test", minimumSessions: 12, recommendedSessions: 12, maximumSessions: 12, minimumTeachingSessions: 6, explanation: "Learn the six stages and ideas, then check each independently." },
      topics: topicTitles.map((title, index) => ({
        id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title, description: `Explain ${title} and how it contributes to cellular respiration.`,
        subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null,
        sourceReferences: [], origin: "ai_generated", deferred: null,
      })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
}

export function auditDuration(sustainableMinutes: 25 | 60): NormalPlanDurationContext {
  return { profileVersion: "audit_duration_v1", profile: {
    sustainableMinutes, startingFrictionRisk: null, fatigueRisk: null, preferredWindow: null,
    evidenceRefs: { sustainableMinutes: ["profile:focus-duration"], startingFrictionRisk: [], fatigueRisk: [], preferredWindow: [] },
  }, recentOutcomes: [] };
}


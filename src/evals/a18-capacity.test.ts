import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlanEvaluationCases } from "./plan-cases";
import { generateFixedPlanForJourney, historyEssayJourneyRequest } from "./fixed-plan-journey";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/config", () => ({ getOpenAIPlanConfig: () => ({ model: "capacity-replay" }) }));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => ({ responses: { parse: async () => {
  const request = historyEssayJourneyRequest(buildPlanEvaluationCases().find(item => item.id === "history_writing_outside")!.request);
  return { id: "a18-overfull", model: "capacity-replay", status: "completed", output: [], output_parsed: {
    title: "Comparative history essay", topic: request.goal, kind: "skill", deadline: request.deadline,
    rationale: "Study a comparative thesis and historical evidence before independently drafting the essay.", deferredTopics: [],
    sessions: Array.from({ length: 6 }, (_, index) => ({ title: `Draft the history essay part ${index + 1}`, objective: "Use historical evidence to explain the comparison in an essay paragraph.",
      scheduledFor: "2026-09-11T18:00:00.000Z", estimatedMinutes: 25, amountLabel: "One essay paragraph", learningMode: index < 3 ? "learn" : "study",
      topicIds: [request.knowledgeMap!.topics[index % 3]!.id], contentTargets: [request.knowledgeMap!.topics[index % 3]!.title], completionEvidence: ["Draft an evidence-supported comparison without looking at the example."] })),
  } };
} } }) }));
vi.mock("@/lib/openai/normal-plan-fill-generator", () => ({ generateNormalPlanFillWithOpenAI: async (fixed: Parameters<typeof buildNormalPlanFallbackFill>[0]) => ({
  fill: buildNormalPlanFallbackFill(fixed), model: "capacity-replay", responseId: "fixed-copy", generationStats: { firstAttemptPassed: true },
}) }));

describe("A18 permanent capacity replay", () => {
  afterEach(() => vi.useRealTimers());
  it("degrades before provider fill and retains a runnable history plan in the saved windows", async () => {
    const now = new Date("2026-09-10T09:00:00.000Z");
    vi.useFakeTimers(); vi.setSystemTime(now);
    const request = historyEssayJourneyRequest(buildPlanEvaluationCases(now).find(item => item.id === "history_writing_outside")!.request);
    const generated = await generateFixedPlanForJourney(request, now);
    expect(generated.plan.sessions).toHaveLength(6);
    expect(generated.plan.sessions.every(session => session.estimatedMinutes === 10)).toBe(true);
    expect(generated.plan.sessions[0]!.learningMode).toBe("learn");
    expect(generated.plan.sessions.some(session => session.learningMode === "study")).toBe(true);
    expect(generated.plan.rationale).toMatch(/short|10.minute/i);
    expect(generated.plan.sessions.every(session => Date.parse(session.scheduledFor) < Date.parse(request.deadline!))).toBe(true);
  });
});

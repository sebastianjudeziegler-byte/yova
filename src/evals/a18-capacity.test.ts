import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePlanDraft } from "./plan-rubric";
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
  it("retains every history topic as learning and practice in the saved windows, with explicit deadline conflicts", async () => {
    const now = new Date("2026-09-10T09:00:00.000Z");
    vi.useFakeTimers(); vi.setSystemTime(now);
    const request = historyEssayJourneyRequest(buildPlanEvaluationCases(now).find(item => item.id === "history_writing_outside")!.request);
    const generated = await generateFixedPlanForJourney(request, now);
    expect(generated.plan.sessions).toHaveLength(6);
    expect(generated.plan.sessions.some(session => session.estimatedMinutes < 25)).toBe(true);
    expect(new Set(generated.plan.sessions.flatMap(session => session.topicIds))).toEqual(new Set(request.knowledgeMap!.topics.map(topic => topic.id)));
    expect(generated.plan.sessions[0]!.learningMode).toBe("learn");
    expect(generated.plan.sessions.some(session => session.learningMode === "study")).toBe(true);
    expect(generated.plan.planModel?.constraints.some(note => /after the deadline/i.test(note))).toBe(true);
    expect(generated.plan.sessions.every(session => session.workload && session.estimatedMinutes <= session.workload.ceilingMinutes)).toBe(true);
    expect(evaluatePlanDraft(generated.draft, request, "writing", generated.composition).requiredFailures).toEqual([]);
    const droppedTopic = structuredClone(generated.draft);
    for (const session of droppedTopic.sessions) session.topicIds = session.topicIds.filter(id => id !== request.knowledgeMap!.topics[0]!.id);
    expect(evaluatePlanDraft(droppedTopic, request, "writing", generated.composition).requiredFailures).toContain("Every mapped topic is scheduled or explicitly deferred");
    const late = structuredClone(generated.draft);
    late.sessions[0]!.scheduledFor = new Date(Date.parse(request.deadline!) + 86400000).toISOString();
    expect(evaluatePlanDraft(late, request, "writing", generated.composition).requiredFailures).toContain("Deadline conflicts are explicit and dates match the code-owned queue");
  });
});

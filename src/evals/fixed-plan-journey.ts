import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import { generatePlanWithOpenAI } from "@/lib/openai/plan-generator";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";

// The accepted map used by the history-writing connected journey. It fixes
// scope before filling copy, just as the learner's accepted creation map does.
export function historyEssayJourneyRequest(request: PlanGenerationRequest): PlanGenerationRequest {
  const titles = ["A comparative history thesis", "Historical evidence for a comparison", "A comparative history paragraph"];
  return { ...request, knowledgeMap: {
    version: 1,
    scopeJudgment: { band: "focused_skill", label: "A comparative history essay", minimumSessions: 6, recommendedSessions: 6, maximumSessions: 6, minimumTeachingSessions: 3, explanation: "Study the thesis, evidence and paragraph structure, then practice each part of the essay." },
    topics: titles.map((title, index) => ({ id: `a1800000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, title,
      description: ["Write a comparative thesis that makes a defensible claim about two historical subjects.", "Select relevant historical evidence and connect it to the comparative thesis.", "Draft a comparative paragraph linking a claim, evidence and historical reasoning."][index]!,
      subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null })),
    placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  } };
}
export async function generateFixedPlanForJourney(request: PlanGenerationRequest, now = new Date()) {
  const generated = await generatePlanWithOpenAI(request);
  return { ...generated, plan: materializePlanDraft(generated.draft, request, now) };
}

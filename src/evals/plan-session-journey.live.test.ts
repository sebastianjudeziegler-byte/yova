import { describe, expect, test, vi } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { evaluatePlanDraft } from "@/evals/plan-rubric";
import { evaluateSessionDraft } from "@/evals/session-rubric";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";

vi.mock("server-only", () => ({}));

const liveEvaluationEnabled = process.env.YOVA_RUN_LIVE_JOURNEY_EVALS === "1";
const requestedCase = process.env.YOVA_JOURNEY_EVAL_CASE?.trim();
const journeyCaseIds = new Set([
  "product_rule_narrow_15",
  "world_war_one_guide_15",
  "calculus_broad_pathway_30",
  "history_writing_outside",
]);
const evaluationCases = buildPlanEvaluationCases()
  .filter((evaluationCase) => journeyCaseIds.has(evaluationCase.id))
  .filter((evaluationCase) => !requestedCase || evaluationCase.id === requestedCase);

describe.skipIf(!liveEvaluationEnabled)("live plan-to-session journeys", () => {
  test("the requested journey exists", () => {
    expect(evaluationCases.length, `Unknown YOVA_JOURNEY_EVAL_CASE: ${requestedCase}`).toBeGreaterThan(0);
  });

  test.each(evaluationCases)("$label", async (evaluationCase) => {
    const { generatePlanWithOpenAI } = await import("@/lib/openai/plan-generator");
    const { generateProductionSessionWithOpenAI } = await import("@/lib/openai/session-generation-strategy");

    const generatedPlan = await generatePlanWithOpenAI(evaluationCase.request);
    const planResult = evaluatePlanDraft(
      generatedPlan.draft,
      evaluationCase.request,
      evaluationCase.taskFamily,
    );
    const plan = materializePlanDraft(generatedPlan.draft, evaluationCase.request);
    const firstSession = plan.sessions[0];
    expect(firstSession).toBeDefined();

    const previewContext = buildPreviewSessionContext({
      plan,
      session: firstSession!,
      onboardingAnswers: onboardingAnswersFor(evaluationCase.request.profileSummary),
      completions: [],
      interruptions: [],
    });
    const generationContext = {
      ...previewContext,
      materials: evaluationCase.request.materials
        .filter((material) => material.textContent?.trim())
        .map((material) => ({
          name: material.name,
          text: material.textContent!,
          truncated: false,
        })),
    };
    const generatedSession = await generateProductionSessionWithOpenAI(generationContext);
    const sessionResult = evaluateSessionDraft(
      generatedSession.draft,
      generationContext,
      evaluationCase.taskFamily,
      expectedSourceTermsFor(evaluationCase.id),
      generatedSession.deliveryPolicy,
    );

    console.info(`\nYOVA connected journey · ${evaluationCase.label}`);
    console.info(`Plan · ${plan.sessions.length} sessions · ${planResult.score}/100 · ${(generatedPlan.generationStats.elapsedMs / 1_000).toFixed(1)}s`);
    console.info(`First session · ${firstSession!.learningMode} · ${firstSession!.method} · ${firstSession!.estimatedMinutes} min`);
    console.info(`Lesson · ${generatedSession.draft.activities.length} activities · ${sessionResult.score}/100 · ${(generatedSession.generationStats.elapsedMs / 1_000).toFixed(1)}s`);
    console.info(`Personalization · ${generatedSession.draft.methodBriefing.personalization.join(" | ")}\n`);

    expect(planResult.requiredFailures).toEqual([]);
    expect(planResult.score).toBeGreaterThanOrEqual(80);
    expect(sessionResult.requiredFailures).toEqual([]);
    expect(sessionResult.score).toBeGreaterThanOrEqual(80);
    expect(generatedSession.draft.methodBriefing.learningMode).toBe(firstSession!.learningMode);
    expect(generatedSession.draft.coverage.focus).not.toMatch(/learning topic|current objective|relevant concept/i);
    if (evaluationCase.request.learningIntent === "learn") {
      expect(firstSession!.learningMode).toBe("learn");
      expect(generatedSession.draft.activities.some((activity) => (
        activity.type === "instruction" && Boolean(activity.teaching)
      ))).toBe(true);
    }
  }, 210_000);
});

function onboardingAnswersFor(profileSummary: string): string[] {
  const answers = Array.from({ length: 16 }, () => "");
  answers[0] = "Large or unclear tasks are hard to start";
  answers[1] = "Give me clear structure";
  answers[3] = "One concrete example first";
  answers[4] = "I use short focused sessions";
  answers[5] = "I start more consistently with a small first action";
  answers[7] = "Understand first, then retain it";
  answers[10] = "The big picture before the details";
  answers[11] = "I forget some ideas after a few days";
  answers[12] = "Give me a small hint before the answer";
  answers[13] = "Show one step at a time";
  answers[14] = profileSummary;
  return answers;
}

function expectedSourceTermsFor(caseId: string): string[] {
  if (caseId === "world_war_one_guide_15") return ["militarism", "alliances"];
  return [];
}

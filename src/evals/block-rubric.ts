import { WorkBlockSchema } from "@/lib/session-blocks/schema";
import { planBlockContents } from "@/lib/session-blocks/plan";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { SessionQualityResult } from "./session-rubric";

/** Evaluate the approved block contract. Legacy lesson phase/wording checks
 * stay in session-rubric for legacy drafts, not newly reviewed work blocks. */
export function evaluateWorkBlockDraft(draft: GeneratedSessionDraft, context: SessionGenerationContext): SessionQualityResult {
  const checks: SessionQualityResult["checks"] = [];
  const add = (id: string, label: string, passed: boolean, detail: string) => checks.push({ id, label, passed, points: 20, earned: passed ? 20 : 0, required: true, detail });
  const parsed = WorkBlockSchema.safeParse(Reflect.get(draft, "block"));
  add("block_shape", "Saved work has valid source, practice and completion boundaries", parsed.success, parsed.success ? "Validated every activity and topic/question/source binding." : parsed.error.message);
  if (parsed.success) {
    const block = parsed.data;
    let expected: ReturnType<typeof planBlockContents> | null = null;
    try { expected = planBlockContents(context); } catch { /* A missing source must fail this evaluation too. */ }
    add("block_scope", "Work preserves assigned topic, mode, objective and duration", JSON.stringify(block.topicIds) === JSON.stringify(context.session.topicIds)
      && block.learningMode === context.session.learningMode && block.objective === context.session.objective
      && block.estimatedMinutes === context.session.estimatedMinutes
      && block.activities.reduce((sum, activity) => sum + activity.estimatedMinutes, 0) === context.session.estimatedMinutes,
    "No model-selected topic, timing or work-mode change.");
    add("block_source", "Practice uses only its assigned usable sections", Boolean(expected && JSON.stringify(block.sources) === JSON.stringify(expected.sources)), "Compare exact topic-scoped source identities and content; no title keyword requirement.");
    add("block_support", "Job and profile are visible in delivered practice", Boolean(expected && Object.entries(expected.personalization).every(([key, value]) => Reflect.get(block.personalization, key) === value)
      && block.questions.length === expected.slots.length && block.questions.every((question, index) => {
        const slot = expected!.slots[index]!;
        return question.id === slot.id && question.topicId === slot.topicId && question.format === slot.format
          && Boolean(question.hints.length) === expected!.personalization.hintsAvailable
          && Boolean(question.workedExample) === (expected!.personalization.examplesFirst && index === 0)
          && question.reflectBeforeCheck === expected!.personalization.reflective;
      })), "Practice format/count, worked example, hints and reflection match the deterministic block plan.");
    add("block_review", "The complete saved set passed its bounded semantic review", block.semanticReview.status === "passed" && block.semanticReview.policyVersion === "block_semantic_v1", "Generation ran semantic review before delivering this candidate; evaluation does not make another provider call.");
  }
  const requiredFailures = checks.filter(check => !check.passed).map(check => check.label);
  const score = checks.reduce((sum, check) => sum + check.earned, 0);
  return { checks, score, requiredFailures, passed: score >= 80 && requiredFailures.length === 0 };
}

import { z } from "zod";
import { parseOnboardingAnswers } from "@/lib/onboarding/answers";
import { isOnboardingOptionId, type OnboardingQuestionId } from "@/lib/onboarding/questions";

const answer = (id: OnboardingQuestionId) => z.string().max(80).refine(
  value => isOnboardingOptionId(id, value),
  "Use an available onboarding option ID.",
);

/** Bounded transport for local preview; cloud routes load the stored profile. */
export const OnboardingAnswersRequestSchema = z.object({
  version: z.literal(1),
  answers: z.object({
    energy_window: answer("energy_window").optional(),
    session_length: answer("session_length").optional(),
    focus_loss: answer("focus_loss").optional(),
    guidance: answer("guidance").optional(),
    difficulty_help: answer("difficulty_help").optional(),
    prove_knowing: answer("prove_knowing").optional(),
    gist_detail: answer("gist_detail").optional(),
    starting_pattern: answer("starting_pattern").optional(),
    support_needs: z.array(answer("support_needs")).max(7).optional(),
    extra_context: answer("extra_context").optional(),
  }).strict(),
  legacy: z.object({
    common_blocker: z.string().max(80).optional(),
    improvement_goal: z.string().max(80).optional(),
  }).strict(),
}).strict().transform(value => parseOnboardingAnswers(value)!);

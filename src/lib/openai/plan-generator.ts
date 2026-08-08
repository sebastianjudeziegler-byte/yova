import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIPlanConfig } from "@/lib/openai/config";
import { buildPlanGeneratorInput, PLAN_GENERATOR_INSTRUCTIONS } from "@/lib/plan-generation/prompt";
import { validateGeneratedPlanQuality } from "@/lib/plan-generation/quality-gate";
import { alignGeneratedPlanToAvailability } from "@/lib/plan-generation/schedule-plan";
import { normalizeGeneratedPlanLearningContract } from "@/lib/plan-generation/normalize-learning-contract";
import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

// A multi-session learning plan is a larger structured response than a tutor
// message or a single session. Twelve seconds was causing otherwise healthy
// production requests to be abandoned before the model could finish. Keep the
// per-attempt ceiling below half of the 60-second route budget so one bounded
// educational-quality repair still has room to run.
export const PLAN_PROVIDER_ATTEMPT_TIMEOUT_MS = 28_000;

export type OpenAIPlanResult = {
  draft: GeneratedPlanDraft;
  model: string;
  responseId: string;
  generationStats: PlanGenerationStats;
};

export type PlanGenerationStats = {
  elapsedMs: number;
  attempts: number;
  firstAttemptPassed: boolean;
  failedValidator: GenerationValidator | null;
  repairAttempted: boolean;
  repairSucceeded: boolean | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export class OpenAIPlanGenerationError extends Error {
  constructor(
    message: string,
    public readonly reason: "refused" | "incomplete" | "invalid_output" | "provider_error",
    public readonly generationStats: PlanGenerationStats,
  ) {
    super(message);
    this.name = "OpenAIPlanGenerationError";
  }
}

export async function generatePlanWithOpenAI(
  request: PlanGenerationRequest,
): Promise<OpenAIPlanResult> {
  const startedAt = Date.now();
  const usage = {
    attempts: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };
  let failedValidator: GenerationValidator | null = null;
  let repairAttempted = false;
  const config = getOpenAIPlanConfig();
  const stats = (repairSucceeded: boolean | null): PlanGenerationStats => ({
    elapsedMs: Date.now() - startedAt,
    attempts: usage.attempts,
    firstAttemptPassed: usage.attempts === 1 && failedValidator === null,
    failedValidator,
    repairAttempted,
    repairSucceeded,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
  });
  if (!config) throw new OpenAIPlanGenerationError("OpenAI is not configured.", "provider_error", stats(null));

  try {
    const client = getOpenAIClient();
    const input = buildPlanGeneratorInput(request);
    const requestDraft = async (repairReason: string | null) => {
      usage.attempts += 1;
      const response = await client.responses.parse({
        model: config.model,
        instructions: repairReason
          ? `${PLAN_GENERATOR_INSTRUCTIONS}\n\nREPAIR ATTEMPT: The previous plan failed YOVA's educational quality gate: ${repairReason} Rebuild the complete plan and correct that failure without weakening the other requirements.`
          : PLAN_GENERATOR_INSTRUCTIONS,
        input,
        reasoning: { effort: "low" },
        text: {
          format: zodTextFormat(GeneratedPlanDraftSchema, "yova_learning_plan"),
          verbosity: "low",
        },
        max_output_tokens: 5_000,
        store: false,
      }, {
        maxRetries: 0,
        timeout: PLAN_PROVIDER_ATTEMPT_TIMEOUT_MS,
      });
      if (response.usage) {
        usage.inputTokens += response.usage.input_tokens;
        usage.cachedInputTokens += response.usage.input_tokens_details.cached_tokens;
        usage.cacheWriteTokens += response.usage.input_tokens_details.cache_write_tokens;
        usage.outputTokens += response.usage.output_tokens;
      }
      return response;
    };

    let response = await requestDraft(null);
    let finalIssue = "The model returned an invalid plan.";
    let finalReason: OpenAIPlanGenerationError["reason"] = "invalid_output";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refusal = response.output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content)
        .find((content) => content.type === "refusal");
      if (refusal) {
        failedValidator ??= "plan_response_status";
        throw new OpenAIPlanGenerationError("The model could not create this plan safely.", "refused", stats(false));
      }

      if (response.status !== "completed") {
        failedValidator ??= "plan_response_status";
        finalIssue = "The model did not finish the complete plan.";
        finalReason = "incomplete";
      } else {
        const parsedDraft = GeneratedPlanDraftSchema.safeParse(response.output_parsed);
        if (!parsedDraft.success) {
          failedValidator ??= "plan_structure";
          finalIssue = "The plan did not match YOVA's required data structure.";
          finalReason = "invalid_output";
        } else {
          const normalizedDraft = normalizeGeneratedPlanLearningContract(parsedDraft.data, request);
          const alignedDraft = alignGeneratedPlanToAvailability(normalizedDraft, request);
          const qualityIssue = validateGeneratedPlanQuality(alignedDraft, request);
          if (!qualityIssue) {
            return {
              draft: alignedDraft,
              model: response.model,
              responseId: response.id,
              generationStats: stats(repairAttempted ? true : null),
            };
          }
          failedValidator ??= "plan_quality_gate";
          finalIssue = qualityIssue;
          finalReason = "invalid_output";
        }
      }

      if (attempt === 0) {
        repairAttempted = true;
        response = await requestDraft(finalIssue);
      }
    }

    throw new OpenAIPlanGenerationError(
      `The model could not create a valid learning plan after one repair attempt. ${finalIssue}`,
      finalReason,
      stats(false),
    );
  } catch (error) {
    if (error instanceof OpenAIPlanGenerationError) throw error;
    failedValidator ??= "plan_provider_request";
    throw new OpenAIPlanGenerationError("The OpenAI request failed.", "provider_error", stats(repairAttempted ? false : null));
  }
}

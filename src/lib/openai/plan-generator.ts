import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIPlanConfig } from "@/lib/openai/config";
import { buildPlanGeneratorInput, PLAN_GENERATOR_INSTRUCTIONS } from "@/lib/plan-generation/prompt";
import { validateGeneratedPlanQuality } from "@/lib/plan-generation/quality-gate";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

export type OpenAIPlanResult = {
  draft: GeneratedPlanDraft;
  model: string;
  responseId: string;
};

export class OpenAIPlanGenerationError extends Error {
  constructor(
    message: string,
    public readonly reason: "refused" | "incomplete" | "invalid_output" | "provider_error",
  ) {
    super(message);
    this.name = "OpenAIPlanGenerationError";
  }
}

export async function generatePlanWithOpenAI(
  request: PlanGenerationRequest,
): Promise<OpenAIPlanResult> {
  const config = getOpenAIPlanConfig();
  if (!config) throw new OpenAIPlanGenerationError("OpenAI is not configured.", "provider_error");

  try {
    const client = getOpenAIClient();
    const input = buildPlanGeneratorInput(request);
    const requestDraft = (repairReason: string | null) => client.responses.parse({
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
      timeout: 12_000,
    });

    let response = await requestDraft(null);
    let finalIssue = "The model returned an invalid plan.";
    let finalReason: OpenAIPlanGenerationError["reason"] = "invalid_output";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refusal = response.output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content)
        .find((content) => content.type === "refusal");
      if (refusal) {
        throw new OpenAIPlanGenerationError("The model could not create this plan safely.", "refused");
      }

      if (response.status !== "completed") {
        finalIssue = "The model did not finish the complete plan.";
        finalReason = "incomplete";
      } else {
        const parsedDraft = GeneratedPlanDraftSchema.safeParse(response.output_parsed);
        if (!parsedDraft.success) {
          finalIssue = "The plan did not match YOVA's required data structure.";
          finalReason = "invalid_output";
        } else {
          const qualityIssue = validateGeneratedPlanQuality(parsedDraft.data, request);
          if (!qualityIssue) {
            return {
              draft: parsedDraft.data,
              model: response.model,
              responseId: response.id,
            };
          }
          finalIssue = qualityIssue;
          finalReason = "invalid_output";
        }
      }

      if (attempt === 0) {
        response = await requestDraft(finalIssue);
      }
    }

    throw new OpenAIPlanGenerationError(
      `The model could not create a valid learning plan after one repair attempt. ${finalIssue}`,
      finalReason,
    );
  } catch (error) {
    if (error instanceof OpenAIPlanGenerationError) throw error;
    throw new OpenAIPlanGenerationError("The OpenAI request failed.", "provider_error");
  }
}

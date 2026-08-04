import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIPlanConfig } from "@/lib/openai/config";
import { buildPlanGeneratorInput, PLAN_GENERATOR_INSTRUCTIONS } from "@/lib/plan-generation/prompt";
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
    const response = await getOpenAIClient().responses.parse({
      model: config.model,
      instructions: PLAN_GENERATOR_INSTRUCTIONS,
      input: buildPlanGeneratorInput(request),
      reasoning: { effort: "low" },
      text: {
        format: zodTextFormat(GeneratedPlanDraftSchema, "yova_learning_plan"),
        verbosity: "low",
      },
      max_output_tokens: 5_000,
      store: false,
    });

    const refusal = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .find((content) => content.type === "refusal");

    if (refusal) {
      throw new OpenAIPlanGenerationError("The model could not create this plan safely.", "refused");
    }

    if (response.status !== "completed") {
      throw new OpenAIPlanGenerationError("The model did not finish the plan.", "incomplete");
    }

    const parsedDraft = GeneratedPlanDraftSchema.safeParse(response.output_parsed);
    if (!parsedDraft.success) {
      throw new OpenAIPlanGenerationError("The model returned an invalid plan shape.", "invalid_output");
    }

    return {
      draft: parsedDraft.data,
      model: response.model,
      responseId: response.id,
    };
  } catch (error) {
    if (error instanceof OpenAIPlanGenerationError) throw error;
    throw new OpenAIPlanGenerationError("The OpenAI request failed.", "provider_error");
  }
}

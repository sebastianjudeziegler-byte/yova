import "server-only";
import { ZodError } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIPlanConfig } from "@/lib/openai/config";
import {
  classifyProviderError,
  type ProviderErrorMetadata,
} from "@/lib/openai/provider-error";
import type { PlanGenerationStats } from "@/lib/openai/plan-generator";
import type { NormalPlanEnvelopeComposition } from "@/lib/plan-generation/normal-plan-envelopes";
import {
  buildNormalPlanProviderFillSchema,
  type NormalPlanProviderFill,
} from "@/lib/plan-generation/normal-plan-provider-fill";
import {
  buildNormalPlanProviderFillInput,
  NORMAL_PLAN_PROVIDER_FILL_INSTRUCTIONS,
} from "@/lib/plan-generation/normal-plan-provider-prompt";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

/** A prose-only response is materially smaller than a complete legacy plan. */
export const NORMAL_PLAN_FILL_PROVIDER_TIMEOUT_MS = 30_000;
export const NORMAL_PLAN_FILL_MAX_OUTPUT_TOKENS = 3_500;

const NORMAL_PLAN_FILL_MIN_TIMEOUT_MS = 1_000;
const NORMAL_PLAN_FILL_SCHEMA_NAME = "yova_normal_plan_fill";

export type NormalPlanFillGenerationInput = Readonly<{
  request: PlanGenerationRequest;
  composition: NormalPlanEnvelopeComposition;
  /** The single request clock already used to compose the fixed envelopes. */
  now: Date;
}>;

export type NormalPlanFillGenerationOptions = Readonly<{
  /** Absolute route deadline in milliseconds since the Unix epoch. */
  deadlineAt?: number;
}>;

export type OpenAINormalPlanFillResult = Readonly<{
  fill: NormalPlanProviderFill;
  model: string;
  responseId: string;
  generationStats: PlanGenerationStats;
}>;

export type OpenAINormalPlanFillFailureReason =
  | "refused"
  | "incomplete"
  | "invalid_output"
  | "provider_error";

/**
 * A plan-generation-compatible failure that carries only bounded operational
 * metadata. The original exception remains available as a server-side cause,
 * but provider messages and learner content never enter the public fields.
 */
export class OpenAINormalPlanFillError extends Error {
  constructor(
    message: string,
    public readonly reason: OpenAINormalPlanFillFailureReason,
    public readonly generationStats: PlanGenerationStats,
    public readonly providerError: ProviderErrorMetadata | null = null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OpenAINormalPlanFillError";
  }
}

/**
 * Lets the provider write copy for code-owned slots in exactly one request.
 * It cannot add, remove, reorder, schedule, classify, or route a session.
 */
export async function generateNormalPlanFillWithOpenAI(
  input: NormalPlanFillGenerationInput,
  options: NormalPlanFillGenerationOptions = {},
): Promise<OpenAINormalPlanFillResult> {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new TypeError("Normal-plan prose generation requires one valid supplied clock.");
  }

  // Validate the internal request/composition boundary before spending an API
  // call. The same exact schema is then used for structured output and for the
  // post-response defensive parse.
  const schema = buildNormalPlanProviderFillSchema({
    request: input.request,
    composition: input.composition,
  });
  const providerInput = buildNormalPlanProviderFillInput(input);
  const startedAt = Date.now();
  const config = getOpenAIPlanConfig();
  const usage = {
    attempts: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };
  let failedValidator: GenerationValidator | null = null;
  const stats = (firstAttemptPassed: boolean): PlanGenerationStats => ({
    elapsedMs: Math.max(0, Date.now() - startedAt),
    attempts: usage.attempts,
    firstAttemptPassed,
    failedValidator,
    repairAttempted: false,
    repairSucceeded: null,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    model: config?.model ?? null,
    validationIssueCode: null,
  });

  if (!config) {
    failedValidator = "plan_provider_request";
    throw new OpenAINormalPlanFillError(
      "OpenAI is not configured for normal-plan copy generation.",
      "provider_error",
      stats(false),
    );
  }

  try {
    usage.attempts = 1;
    const response = await getOpenAIClient().responses.parse({
      model: config.model,
      instructions: NORMAL_PLAN_PROVIDER_FILL_INSTRUCTIONS,
      input: providerInput,
      reasoning: { effort: "low" },
      text: {
        format: zodTextFormat(schema, NORMAL_PLAN_FILL_SCHEMA_NAME),
        verbosity: "low",
      },
      max_output_tokens: NORMAL_PLAN_FILL_MAX_OUTPUT_TOKENS,
      store: false,
    }, {
      maxRetries: 0,
      timeout: providerTimeoutWithinDeadline(options.deadlineAt),
    });

    recordUsage(response.usage, usage);

    if (containsRefusal(response.output)) {
      failedValidator = "plan_response_status";
      throw new OpenAINormalPlanFillError(
        "The model could not create normal-plan copy safely.",
        "refused",
        stats(false),
      );
    }

    if (response.status !== "completed") {
      failedValidator = "plan_response_status";
      throw new OpenAINormalPlanFillError(
        "The model did not finish the normal-plan copy response.",
        "incomplete",
        stats(false),
      );
    }

    const parsed = schema.safeParse(response.output_parsed);
    if (!parsed.success) {
      failedValidator = "plan_structure";
      throw new OpenAINormalPlanFillError(
        "The model response did not match the fixed normal-plan copy slots.",
        "invalid_output",
        stats(false),
      );
    }

    return {
      fill: parsed.data as NormalPlanProviderFill,
      model: response.model,
      responseId: response.id,
      generationStats: stats(true),
    };
  } catch (error) {
    if (error instanceof OpenAINormalPlanFillError) throw error;
    if (error instanceof ZodError || error instanceof SyntaxError) {
      failedValidator = "plan_structure";
      throw new OpenAINormalPlanFillError(
        "The model response did not match the fixed normal-plan copy slots.",
        "invalid_output",
        stats(false),
        null,
        error,
      );
    }
    failedValidator = "plan_provider_request";
    throw new OpenAINormalPlanFillError(
      "The OpenAI normal-plan copy request failed.",
      "provider_error",
      stats(false),
      classifyProviderError(error),
      error,
    );
  }
}

function providerTimeoutWithinDeadline(deadlineAt: number | undefined) {
  if (deadlineAt === undefined) return NORMAL_PLAN_FILL_PROVIDER_TIMEOUT_MS;
  if (!Number.isFinite(deadlineAt)) {
    throw new TypeError("The normal-plan provider deadline must be finite.");
  }
  const availableMs = Math.floor(deadlineAt - Date.now());
  if (availableMs < NORMAL_PLAN_FILL_MIN_TIMEOUT_MS) {
    throw new Error("The route deadline is too close for a normal-plan provider request.");
  }
  return Math.min(NORMAL_PLAN_FILL_PROVIDER_TIMEOUT_MS, availableMs);
}

function containsRefusal(output: unknown) {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) return false;
    return item.content.some((content) => isRecord(content) && content.type === "refusal");
  });
}

function recordUsage(
  responseUsage: unknown,
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  },
) {
  if (!isRecord(responseUsage)) return;
  const inputDetails = isRecord(responseUsage.input_tokens_details)
    ? responseUsage.input_tokens_details
    : null;
  usage.inputTokens += tokenCount(responseUsage.input_tokens);
  usage.cachedInputTokens += tokenCount(inputDetails?.cached_tokens);
  usage.cacheWriteTokens += tokenCount(inputDetails?.cache_write_tokens);
  usage.outputTokens += tokenCount(responseUsage.output_tokens);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

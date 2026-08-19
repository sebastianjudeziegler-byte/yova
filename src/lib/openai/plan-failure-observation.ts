import type { GenerationObservation } from "@/lib/analytics/generation-observation";
import type { OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";

type PlanFailureDiagnostics = NonNullable<GenerationObservation["diagnostics"]>;

export function planFailureDiagnostics(
  failure: OpenAIPlanGenerationError,
): PlanFailureDiagnostics {
  return {
    planFailureReason: failure.reason,
    ...(failure.generationStats.validationIssueCode
      ? { planValidationIssueCode: failure.generationStats.validationIssueCode }
      : {}),
    ...(failure.providerError
      ? {
          providerCategory: failure.providerError.category,
          ...(failure.providerError.status !== null
            ? { providerStatus: failure.providerError.status }
            : {}),
          ...(failure.providerError.code !== null
            ? { providerCode: failure.providerError.code }
            : {}),
        }
      : {}),
  };
}

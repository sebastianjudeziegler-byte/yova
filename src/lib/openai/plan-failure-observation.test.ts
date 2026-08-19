import { describe, expect, it } from "vitest";
import { planFailureDiagnostics } from "@/lib/openai/plan-failure-observation";
import type { OpenAIPlanGenerationError } from "@/lib/openai/plan-generator";

describe("planFailureDiagnostics", () => {
  it("returns only bounded provider and validator facts", () => {
    const failure = {
      reason: "provider_error",
      providerError: {
        category: "timeout",
        status: 408,
        code: "request_timeout",
      },
      generationStats: { validationIssueCode: "schedule_fit" },
      message: "private learner content",
      stack: "private upstream body",
    } as unknown as OpenAIPlanGenerationError;

    const diagnostics = planFailureDiagnostics(failure);

    expect(diagnostics).toEqual({
      planFailureReason: "provider_error",
      planValidationIssueCode: "schedule_fit",
      providerCategory: "timeout",
      providerStatus: 408,
      providerCode: "request_timeout",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("private");
  });
});

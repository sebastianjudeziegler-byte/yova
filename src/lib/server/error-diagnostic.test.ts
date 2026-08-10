import { describe, expect, it } from "vitest";
import { z } from "zod";
import { privacySafeErrorDiagnostic } from "@/lib/server/error-diagnostic";

describe("privacySafeErrorDiagnostic", () => {
  it("identifies a PostgREST plain-object error without logging its message or details", () => {
    const diagnostic = privacySafeErrorDiagnostic({
      code: "42703",
      details: "A sensitive row value could appear here",
      hint: null,
      message: "column plans.knowledge_map does not exist",
    });

    expect(diagnostic).toEqual({ reason: "PostgrestError", code: "42703" });
    expect(JSON.stringify(diagnostic)).not.toContain("knowledge_map");
    expect(JSON.stringify(diagnostic)).not.toContain("sensitive");
  });

  it("summarizes Zod failures without logging input values or issue messages", () => {
    const schema = z.object({ title: z.string().min(8), count: z.number() });
    const result = schema.safeParse({ title: "secret", count: "private value" });
    if (result.success) throw new Error("Expected the fixture to fail validation.");

    const diagnostic = privacySafeErrorDiagnostic(result.error);

    expect(diagnostic).toEqual({
      reason: "ZodError",
      issueCount: 2,
      issueCodes: ["too_small", "invalid_type"],
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    expect(JSON.stringify(diagnostic)).not.toContain("private value");
  });

  it("preserves a safe built-in error name but never its message", () => {
    const diagnostic = privacySafeErrorDiagnostic(new TypeError("learner content must stay private"));

    expect(diagnostic).toEqual({ reason: "Error", name: "TypeError" });
    expect(JSON.stringify(diagnostic)).not.toContain("learner content");
  });

  it("surfaces safe generation failure metadata without exposing repair detail", () => {
    const error = new Error("private learner content");
    Object.assign(error, {
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        failedValidator: "session_semantic_validation",
        repairReason: "semantic_validation",
        repairDetail: "The learner wrote a private answer here.",
      },
    });

    const diagnostic = privacySafeErrorDiagnostic(error);

    expect(diagnostic).toEqual({
      reason: "Error",
      name: "SessionGenerationFailure",
      attempts: 3,
      failedValidator: "session_semantic_validation",
      repairReason: "semantic_validation",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private answer");
  });

  it("classifies arbitrary thrown values without serializing them", () => {
    const diagnostic = privacySafeErrorDiagnostic("private thrown value");

    expect(diagnostic).toEqual({ reason: "UnknownThrowable", thrownType: "string" });
    expect(JSON.stringify(diagnostic)).not.toContain("private thrown value");
  });
});

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
      structuralDiagnostic: {
        stage: "uncaught_zod",
        issueCount: 2,
        issues: [
          { code: "too_small", path: ["title"] },
          { code: "invalid_type", path: ["count"] },
        ],
        truncated: false,
      },
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
        recoveryMode: "safe_study",
        validationIssueCode: "streamed_target_subject",
        repairDetail: "The learner wrote a private answer here.",
      },
      structuralDiagnostic: {
        stage: "draft_followup_parse",
        issueCount: 2,
        issues: [
          { code: "custom", path: ["activities", 0, "teaching"] },
          { code: "custom", path: ["activities", 2, "correctAnswer"] },
        ],
        truncated: false,
        message: "The learner wrote a private answer here.",
      },
    });

    const diagnostic = privacySafeErrorDiagnostic(error);

    expect(diagnostic).toEqual({
      reason: "Error",
      name: "SessionGenerationFailure",
      attempts: 3,
      failedValidator: "session_semantic_validation",
      repairReason: "semantic_validation",
      recoveryMode: "safe_study",
      validationIssueCode: "streamed_target_subject",
      structuralDiagnostic: {
        stage: "draft_followup_parse",
        issueCount: 2,
        issues: [
          { code: "custom", path: ["activities", 0, "teaching"] },
          { code: "custom", path: ["activities", 2, "correctAnswer"] },
        ],
        truncated: false,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private answer");
  });

  it("caps structural issues and drops unsafe codes, paths, messages, and values", () => {
    const error = new Error("private learner content");
    const safeIssues = Array.from({ length: 14 }, (_, index) => ({
      code: "custom",
      path: ["activities", index, "teaching"],
      message: `private answer ${index}`,
      input: { answer: `private value ${index}` },
    }));
    Object.assign(error, {
      name: "SessionGenerationFailure",
      generationStats: { attempts: 3 },
      structuralDiagnostic: {
        stage: "provider_repair_parse",
        issueCount: 15,
        issues: [
          {
            code: "private learner code",
            path: ["activities", "private learner path"],
            message: "private learner message",
          },
          ...safeIssues,
        ],
        truncated: false,
        repairDetail: "private repair detail",
      },
    });

    const diagnostic = privacySafeErrorDiagnostic(error);

    expect(diagnostic.structuralDiagnostic).toMatchObject({
      stage: "provider_repair_parse",
      issueCount: 15,
      truncated: true,
    });
    expect(diagnostic.structuralDiagnostic?.issues).toHaveLength(12);
    expect(diagnostic.structuralDiagnostic?.issues[0]).toEqual({
      code: "custom",
      path: ["activities", 0, "teaching"],
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("private learner");
    expect(serialized).not.toContain("private answer");
    expect(serialized).not.toContain("private value");
    expect(serialized).not.toContain("repair detail");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("input");
  });

  it("surfaces the bounded teaching recovery marker without learner content", () => {
    const error = new Error("private learner content");
    Object.assign(error, {
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        failedValidator: "session_completion_contract",
        repairReason: "semantic_validation",
        recoveryMode: "safe_learn",
      },
    });

    expect(privacySafeErrorDiagnostic(error)).toEqual({
      reason: "Error",
      name: "SessionGenerationFailure",
      attempts: 3,
      failedValidator: "session_completion_contract",
      repairReason: "semantic_validation",
      recoveryMode: "safe_learn",
    });
  });

  it("drops a free-form validation issue instead of logging it", () => {
    const error = new Error("private learner content");
    Object.assign(error, {
      generationStats: {
        validationIssueCode: "The learner's private Product Rule target failed.",
      },
    });

    const diagnostic = privacySafeErrorDiagnostic(error);

    expect(diagnostic).toEqual({ reason: "Error", name: "Error" });
    expect(JSON.stringify(diagnostic)).not.toContain("Product Rule");
  });

  it("classifies arbitrary thrown values without serializing them", () => {
    const diagnostic = privacySafeErrorDiagnostic("private thrown value");

    expect(diagnostic).toEqual({ reason: "UnknownThrowable", thrownType: "string" });
    expect(JSON.stringify(diagnostic)).not.toContain("private thrown value");
  });
});

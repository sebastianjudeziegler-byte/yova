import { z } from "zod";

export type PrivacySafeErrorDiagnostic = {
  reason: "ZodError" | "PostgrestError" | "Error" | "UnknownThrowable";
  name?: string;
  code?: string;
  issueCount?: number;
  issueCodes?: string[];
  thrownType?: string;
};

/**
 * Converts an unknown server exception into metadata that is useful in logs
 * without copying messages, input values, database details, or hints that can
 * contain learner-provided content.
 */
export function privacySafeErrorDiagnostic(error: unknown): PrivacySafeErrorDiagnostic {
  if (error instanceof z.ZodError) {
    return {
      reason: "ZodError",
      issueCount: error.issues.length,
      issueCodes: Array.from(new Set(error.issues.map((issue) => issue.code))).slice(0, 5),
    };
  }

  if (isPostgrestError(error)) {
    return {
      reason: "PostgrestError",
      code: safeIdentifier(error.code),
    };
  }

  if (error instanceof Error) {
    return {
      reason: "Error",
      name: safeIdentifier(error.name) ?? "Error",
    };
  }

  return {
    reason: "UnknownThrowable",
    thrownType: error === null ? "null" : typeof error,
  };
}

function isPostgrestError(error: unknown): error is { code: string } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && ("details" in candidate || "hint" in candidate);
}

function safeIdentifier(value: string) {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed) ? trimmed : undefined;
}

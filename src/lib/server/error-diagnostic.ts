import { z } from "zod";

export type PrivacySafeErrorDiagnostic = {
  reason: "ZodError" | "PostgrestError" | "Error" | "UnknownThrowable";
  name?: string;
  code?: string;
  issueCount?: number;
  issueCodes?: string[];
  thrownType?: string;
  failedValidator?: string;
  attempts?: number;
  repairReason?: string;
  recoveryMode?: string;
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
    const generation = readGenerationDiagnostic(error);
    return {
      reason: "Error",
      name: safeIdentifier(error.name) ?? "Error",
      ...generation,
    };
  }

  return {
    reason: "UnknownThrowable",
    thrownType: error === null ? "null" : typeof error,
  };
}

function readGenerationDiagnostic(error: Error) {
  const candidate = error as Error & { generationStats?: unknown };
  if (!candidate.generationStats || typeof candidate.generationStats !== "object") return {};
  const stats = candidate.generationStats as Record<string, unknown>;
  const attempts = typeof stats.attempts === "number" && Number.isInteger(stats.attempts)
    ? Math.max(0, Math.min(stats.attempts, 10))
    : undefined;
  const failedValidator = typeof stats.failedValidator === "string"
    ? safeIdentifier(stats.failedValidator)
    : undefined;
  const repairReason = typeof stats.repairReason === "string"
    ? safeIdentifier(stats.repairReason)
    : undefined;
  const recoveryMode = stats.recoveryMode === "safe_study" ? stats.recoveryMode : undefined;
  return {
    ...(failedValidator ? { failedValidator } : {}),
    ...(attempts === undefined ? {} : { attempts }),
    ...(repairReason ? { repairReason } : {}),
    ...(recoveryMode ? { recoveryMode } : {}),
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

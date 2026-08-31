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
  generationStrategy?: "full" | "reliable" | "streamed";
  generationStage?: "preflight" | "provider" | "validation" | "fallback" | "persistence" | "complete";
  generationCause?: "provider_request" | "incomplete_response" | "invalid_structure" | "semantic_validation" | "source_unavailable" | "authorization" | "provider_unconfigured" | "rate_limit" | "quota_exhausted" | "reservation_conflict" | "route_conflict" | "cache_conflict" | "cache_write" | "unexpected";
  degradedMode?: "source_grounded";
  validationIssueCode?: string;
  structuralDiagnostic?: PrivacySafeStructuralDiagnostic;
};

export type PrivacySafeStructuralDiagnostic = {
  stage:
    | "uncaught_zod"
    | "provider_initial_parse"
    | "provider_repair_parse"
    | "draft_initial_parse"
    | "draft_repair_parse"
    | "draft_followup_parse";
  issueCount: number;
  issues: Array<{
    code: string;
    path: Array<string | number>;
  }>;
  truncated: boolean;
};

const STRUCTURAL_DIAGNOSTIC_ISSUE_LIMIT = 12;
const STRUCTURAL_DIAGNOSTIC_COUNT_LIMIT = 10_000;
const STRUCTURAL_DIAGNOSTIC_STAGES = new Set<PrivacySafeStructuralDiagnostic["stage"]>([
  "uncaught_zod",
  "provider_initial_parse",
  "provider_repair_parse",
  "draft_initial_parse",
  "draft_repair_parse",
  "draft_followup_parse",
]);

/**
 * Converts an unknown server exception into metadata that is useful in logs
 * without copying messages, input values, database details, or hints that can
 * contain learner-provided content.
 */
export function privacySafeErrorDiagnostic(error: unknown): PrivacySafeErrorDiagnostic {
  if (error instanceof z.ZodError) {
    const structuralDiagnostic = readStructuralDiagnostic({
      stage: "uncaught_zod",
      issueCount: error.issues.length,
      issues: error.issues,
      truncated: false,
    });
    return {
      reason: "ZodError",
      issueCount: error.issues.length,
      issueCodes: Array.from(new Set(error.issues.map((issue) => issue.code))).slice(0, 5),
      ...(structuralDiagnostic ? { structuralDiagnostic } : {}),
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
    const structuralDiagnostic = readStructuralDiagnostic(
      (error as Error & { structuralDiagnostic?: unknown }).structuralDiagnostic,
    );
    return {
      reason: "Error",
      name: safeIdentifier(error.name) ?? "Error",
      ...generation,
      ...(structuralDiagnostic ? { structuralDiagnostic } : {}),
    };
  }

  return {
    reason: "UnknownThrowable",
    thrownType: error === null ? "null" : typeof error,
  };
}

function readStructuralDiagnostic(value: unknown): PrivacySafeStructuralDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.stage !== "string"
    || !STRUCTURAL_DIAGNOSTIC_STAGES.has(candidate.stage as PrivacySafeStructuralDiagnostic["stage"])
    || typeof candidate.issueCount !== "number"
    || !Number.isSafeInteger(candidate.issueCount)
    || candidate.issueCount < 0
    || !Array.isArray(candidate.issues)
    || candidate.issueCount < candidate.issues.length
  ) return undefined;

  let omittedUnsafeIssue = false;
  const issues: PrivacySafeStructuralDiagnostic["issues"] = [];
  for (const issue of candidate.issues.slice(0, STRUCTURAL_DIAGNOSTIC_ISSUE_LIMIT * 2)) {
    if (issues.length >= STRUCTURAL_DIAGNOSTIC_ISSUE_LIMIT) break;
    if (!issue || typeof issue !== "object") {
      omittedUnsafeIssue = true;
      continue;
    }
    const rawIssue = issue as Record<string, unknown>;
    const code = typeof rawIssue.code === "string" ? safeStructuralIssueCode(rawIssue.code) : undefined;
    const path = safeStructuralIssuePath(rawIssue.path);
    if (!code || !path) {
      omittedUnsafeIssue = true;
      continue;
    }
    issues.push({ code, path });
  }

  const issueCount = Math.min(candidate.issueCount, STRUCTURAL_DIAGNOSTIC_COUNT_LIMIT);
  return {
    stage: candidate.stage as PrivacySafeStructuralDiagnostic["stage"],
    issueCount,
    issues,
    truncated: candidate.truncated === true
      || candidate.issueCount > STRUCTURAL_DIAGNOSTIC_COUNT_LIMIT
      || candidate.issues.length > STRUCTURAL_DIAGNOSTIC_ISSUE_LIMIT
      || omittedUnsafeIssue
      || issueCount > issues.length,
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
  const recoveryMode = stats.recoveryMode === "safe_study" || stats.recoveryMode === "safe_learn"
    ? stats.recoveryMode
    : undefined;
  const generationStrategy = stats.strategy === "full"
    || stats.strategy === "reliable"
    || stats.strategy === "streamed"
    ? stats.strategy as NonNullable<PrivacySafeErrorDiagnostic["generationStrategy"]>
    : undefined;
  const generationStage = stats.stage === "preflight"
    || stats.stage === "provider"
    || stats.stage === "validation"
    || stats.stage === "fallback"
    || stats.stage === "persistence"
    || stats.stage === "complete"
    ? stats.stage as NonNullable<PrivacySafeErrorDiagnostic["generationStage"]>
    : undefined;
  const generationCause = stats.cause === "provider_request"
    || stats.cause === "incomplete_response"
    || stats.cause === "invalid_structure"
    || stats.cause === "semantic_validation"
    || stats.cause === "source_unavailable"
    || stats.cause === "authorization"
    || stats.cause === "provider_unconfigured"
    || stats.cause === "rate_limit"
    || stats.cause === "quota_exhausted"
    || stats.cause === "reservation_conflict"
    || stats.cause === "route_conflict"
    || stats.cause === "cache_conflict"
    || stats.cause === "cache_write"
    || stats.cause === "unexpected"
    ? stats.cause as NonNullable<PrivacySafeErrorDiagnostic["generationCause"]>
    : undefined;
  const degradedMode = stats.degradedMode === "source_grounded"
    ? stats.degradedMode as NonNullable<PrivacySafeErrorDiagnostic["degradedMode"]>
    : undefined;
  const validationIssueCode = typeof stats.validationIssueCode === "string"
    ? safeIdentifier(stats.validationIssueCode)
    : undefined;
  return {
    ...(failedValidator ? { failedValidator } : {}),
    ...(attempts === undefined ? {} : { attempts }),
    ...(repairReason ? { repairReason } : {}),
    ...(recoveryMode ? { recoveryMode } : {}),
    ...(generationStrategy ? { generationStrategy } : {}),
    ...(generationStage ? { generationStage } : {}),
    ...(generationCause ? { generationCause } : {}),
    ...(degradedMode ? { degradedMode } : {}),
    ...(validationIssueCode ? { validationIssueCode } : {}),
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

function safeStructuralIssueCode(value: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function safeStructuralIssuePath(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const path: Array<string | number> = [];
  for (const segment of value) {
    if (typeof segment === "number") {
      if (!Number.isInteger(segment) || segment < 0 || segment > 10_000) return undefined;
      path.push(segment);
      continue;
    }
    if (typeof segment !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(segment)) {
      return undefined;
    }
    path.push(segment);
  }
  return path;
}

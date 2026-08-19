export const PROVIDER_ERROR_CATEGORIES = [
  "timeout",
  "rate_limit",
  "authentication",
  "permission",
  "invalid_request",
  "not_found",
  "provider_server_error",
  "connection",
  "aborted",
  "unknown",
] as const;

export type ProviderErrorCategory = typeof PROVIDER_ERROR_CATEGORIES[number];

export type ProviderErrorMetadata = {
  category: ProviderErrorCategory;
  status: number | null;
  code: string | null;
};

/**
 * Reduces an upstream exception to bounded operational metadata. Provider
 * messages, response bodies, request payloads, and stack traces never cross
 * this boundary because they can contain learner content.
 */
export function classifyProviderError(error: unknown): ProviderErrorMetadata {
  const record = asRecord(error);
  const name = error instanceof Error
    ? error.name
    : typeof record?.name === "string"
      ? record.name
      : "";
  const status = boundedStatus(record?.status);
  const code = boundedCode(record?.code);
  const normalizedName = name.toLowerCase();
  const normalizedCode = code?.toLowerCase() ?? "";

  let category: ProviderErrorCategory = "unknown";
  if (
    normalizedName === "aborterror"
    || normalizedCode === "abort_err"
    || normalizedCode === "err_aborted"
  ) {
    category = "aborted";
  } else if (
    normalizedName.includes("timeout")
    || normalizedCode === "etimedout"
    || normalizedCode === "err_timeout"
    || status === 408
  ) {
    category = "timeout";
  } else if (normalizedName.includes("ratelimit") || status === 429) {
    category = "rate_limit";
  } else if (normalizedName.includes("authentication") || status === 401) {
    category = "authentication";
  } else if (normalizedName.includes("permission") || status === 403) {
    category = "permission";
  } else if (normalizedName.includes("notfound") || status === 404) {
    category = "not_found";
  } else if (
    normalizedName.includes("badrequest")
    || normalizedName.includes("unprocessable")
    || status === 400
    || status === 422
  ) {
    category = "invalid_request";
  } else if (normalizedName.includes("internalserver") || (status !== null && status >= 500)) {
    category = "provider_server_error";
  } else if (
    normalizedName.includes("connection")
    || normalizedCode === "econnreset"
    || normalizedCode === "econnrefused"
    || normalizedCode === "enotfound"
  ) {
    category = "connection";
  }

  return { category, status, code };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function boundedStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function boundedCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized) ? normalized : null;
}

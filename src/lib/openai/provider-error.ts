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
  const identities = [
    boundedIdentity(safeProperty(record, "name")),
    boundedConstructorName(error),
    boundedIdentity(safeProperty(record, "type")),
  ]
    .filter((identity): identity is string => identity !== null)
    .map(normalizeIdentity);
  const status = boundedStatus(safeProperty(record, "status"));
  const code = boundedCode(safeProperty(record, "code"));
  const normalizedCode = code?.toLowerCase() ?? "";
  const hasIdentity = (fragment: string) => identities.some((identity) => identity.includes(fragment));

  let category: ProviderErrorCategory = "unknown";
  if (
    hasIdentity("aborterror")
    || normalizedCode === "abort_err"
    || normalizedCode === "err_aborted"
  ) {
    category = "aborted";
  } else if (
    hasIdentity("timeout")
    || normalizedCode === "etimedout"
    || normalizedCode === "err_timeout"
    || status === 408
  ) {
    category = "timeout";
  } else if (hasIdentity("ratelimit") || status === 429) {
    category = "rate_limit";
  } else if (hasIdentity("authentication") || status === 401) {
    category = "authentication";
  } else if (hasIdentity("permission") || status === 403) {
    category = "permission";
  } else if (hasIdentity("notfound") || status === 404) {
    category = "not_found";
  } else if (
    hasIdentity("badrequest")
    || hasIdentity("invalidrequest")
    || hasIdentity("unprocessable")
    || status === 400
    || status === 422
  ) {
    category = "invalid_request";
  } else if (
    hasIdentity("internalserver")
    || identities.includes("servererror")
    || (status !== null && status >= 500)
  ) {
    category = "provider_server_error";
  } else if (
    hasIdentity("connection")
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

function safeProperty(record: Record<string, unknown> | null, property: string) {
  if (!record) return undefined;
  try {
    return record[property];
  } catch {
    return undefined;
  }
}

function boundedConstructorName(value: unknown) {
  try {
    if (!(value instanceof Error)) return null;
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (!prototype) return null;
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return typeof constructor === "function"
      ? boundedIdentity(constructor.name)
      : null;
  } catch {
    return null;
  }
}

function boundedIdentity(value: unknown) {
  if (typeof value !== "string") return null;
  const identity = value.trim();
  return /^[a-z][a-z0-9_.-]{0,63}$/i.test(identity) ? identity : null;
}

function normalizeIdentity(identity: string) {
  return identity.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
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

import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const PLAN_DRAFT_RECEIPT_VERSION = "v1" as const;
export const PLAN_DRAFT_RECEIPT_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const PLAN_DRAFT_RECEIPT_CLOCK_SKEW_MS = 60 * 1_000;
export const PLAN_DRAFT_RECEIPT_SECRET_MIN_LENGTH = 32;
export const PLAN_DRAFT_RECEIPT_MAX_CANONICAL_BYTES = 1_048_576;
export const PLAN_DRAFT_RECEIPT_MAX_LENGTH = 512;

const RECEIPT_PREFIX = "yova-draft";
const RECEIPT_DOMAIN = "yova.plan-draft-receipt.v1";
const CURRENT_SECRET_ENV = "YOVA_DRAFT_RECEIPT_SECRET";
const PREVIOUS_SECRET_ENV = "YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET";
const SECRET_MAX_LENGTH = 4_096;
const KID_LENGTH = 16;
const SIGNATURE_LENGTH = 43;
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 100_000;

export type PlanDraftReceiptSecrets = Readonly<{
  current: string;
  previous?: string;
}>;

export type PlanDraftReceiptMetadata = Readonly<{
  version: typeof PLAN_DRAFT_RECEIPT_VERSION;
  kid: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type PlanDraftReceiptVerification =
  | Readonly<{
      ok: true;
      metadata: PlanDraftReceiptMetadata;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "malformed_receipt"
        | "unsupported_version"
        | "invalid_time_window"
        | "not_yet_valid"
        | "expired"
        | "key_unavailable"
        | "signature_mismatch"
        | "invalid_payload"
        | "configuration_error";
    }>;

export type IssuePlanDraftReceiptInput = Readonly<{
  parsedPlan: unknown;
  normalizedGenerationContract: unknown;
  authenticatedUserId: string;
  issuedAt: Date | string | number;
  expiresAt: Date | string | number;
}>;

export type VerifyPlanDraftReceiptInput = Readonly<{
  parsedPlan: unknown;
  normalizedGenerationContract: unknown;
  authenticatedUserId: string;
  receipt: string;
  now?: Date | string | number;
}>;

export type PlanDraftReceiptOptions = Readonly<{
  /** Dependency injection for deterministic tests and deliberate key rotation. */
  secrets?: PlanDraftReceiptSecrets;
}>;

export class PlanDraftReceiptConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanDraftReceiptConfigurationError";
  }
}

export class PlanDraftReceiptInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanDraftReceiptInputError";
  }
}

/** Fails before metered generation when production cannot authenticate drafts. */
export function assertPlanDraftReceiptConfigured(
  options: PlanDraftReceiptOptions = {},
) {
  readSecrets(options.secrets);
}

/**
 * Issues a compact, stateless capability for one exact parsed plan and one
 * exact server-normalized generation contract. The caller owns schema parsing
 * and normalization; this boundary owns canonicalization, expiry, user
 * binding, key selection, and authentication.
 */
export function issuePlanDraftReceipt(
  input: IssuePlanDraftReceiptInput,
  options: PlanDraftReceiptOptions = {},
) {
  const secrets = readSecrets(options.secrets);
  const issuedAtMs = parseInstant(input.issuedAt, "issuedAt");
  const expiresAtMs = parseInstant(input.expiresAt, "expiresAt");
  assertIssueTimeWindow(issuedAtMs, expiresAtMs);
  const authenticatedUserId = parseAuthenticatedUserId(input.authenticatedUserId);
  const kid = keyId(secrets.current);
  const message = canonicalReceiptMessage({
    kid,
    authenticatedUserId,
    issuedAtMs,
    expiresAtMs,
    parsedPlan: input.parsedPlan,
    normalizedGenerationContract: input.normalizedGenerationContract,
  });
  const signature = sign(message, secrets.current);
  const receipt = [
    RECEIPT_PREFIX,
    PLAN_DRAFT_RECEIPT_VERSION,
    kid,
    String(issuedAtMs),
    String(expiresAtMs),
    signature,
  ].join(".");

  if (receipt.length > PLAN_DRAFT_RECEIPT_MAX_LENGTH) {
    throw new PlanDraftReceiptInputError("The plan draft receipt exceeded its encoded length limit.");
  }
  return Object.freeze({
    receipt,
    metadata: receiptMetadata(kid, issuedAtMs, expiresAtMs),
  });
}

/**
 * Verifies a receipt without throwing on attacker-controlled input. A server
 * configuration failure is also returned explicitly so a route can fail with
 * a retryable service error instead of mislabeling it as learner tampering.
 */
export function verifyPlanDraftReceipt(
  input: VerifyPlanDraftReceiptInput,
  options: PlanDraftReceiptOptions = {},
): PlanDraftReceiptVerification {
  const parsedReceipt = parseReceipt(input.receipt);
  if (!parsedReceipt.ok) return parsedReceipt;

  let secrets: ReturnType<typeof readSecrets>;
  try {
    secrets = readSecrets(options.secrets);
  } catch (error) {
    if (error instanceof PlanDraftReceiptConfigurationError) {
      return failure("configuration_error");
    }
    throw error;
  }

  const issuedAtMs = parseReceiptTime(parsedReceipt.issuedAt);
  const expiresAtMs = parseReceiptTime(parsedReceipt.expiresAt);
  if (
    issuedAtMs === null
    || expiresAtMs === null
    || !validTimeWindow(issuedAtMs, expiresAtMs)
  ) return failure("invalid_time_window");

  const nowMs = safeVerifyInstant(input.now ?? Date.now());
  if (nowMs === null) return failure("invalid_payload");
  if (nowMs < issuedAtMs - PLAN_DRAFT_RECEIPT_CLOCK_SKEW_MS) {
    return failure("not_yet_valid");
  }
  if (nowMs >= expiresAtMs) return failure("expired");

  const secret = secretForKid(secrets, parsedReceipt.kid);
  if (!secret) return failure("key_unavailable");

  let message: string;
  try {
    message = canonicalReceiptMessage({
      kid: parsedReceipt.kid,
      authenticatedUserId: parseAuthenticatedUserId(input.authenticatedUserId),
      issuedAtMs,
      expiresAtMs,
      parsedPlan: input.parsedPlan,
      normalizedGenerationContract: input.normalizedGenerationContract,
    });
  } catch (error) {
    if (error instanceof PlanDraftReceiptInputError) return failure("invalid_payload");
    throw error;
  }

  const expected = Buffer.from(sign(message, secret), "base64url");
  const received = decodeSignature(parsedReceipt.signature);
  if (
    !received
    || received.length !== expected.length
    || !timingSafeEqual(received, expected)
  ) return failure("signature_mismatch");

  return Object.freeze({
    ok: true,
    metadata: receiptMetadata(parsedReceipt.kid, issuedAtMs, expiresAtMs),
  });
}

type ReceiptMessageInput = {
  kid: string;
  authenticatedUserId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  parsedPlan: unknown;
  normalizedGenerationContract: unknown;
};

function canonicalReceiptMessage(input: ReceiptMessageInput) {
  const canonical = stableCanonicalJson({
    domain: RECEIPT_DOMAIN,
    version: PLAN_DRAFT_RECEIPT_VERSION,
    kid: input.kid,
    authenticatedUserId: input.authenticatedUserId,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    parsedPlan: input.parsedPlan,
    normalizedGenerationContract: input.normalizedGenerationContract,
  });
  if (Buffer.byteLength(canonical, "utf8") > PLAN_DRAFT_RECEIPT_MAX_CANONICAL_BYTES) {
    throw new PlanDraftReceiptInputError("The plan draft receipt payload exceeded its canonical size limit.");
  }
  return canonical;
}

function stableCanonicalJson(value: unknown) {
  const state = {
    active: new WeakSet<object>(),
    nodes: 0,
  };
  return canonicalValue(value, state, 0);
}

function canonicalValue(
  value: unknown,
  state: { active: WeakSet<object>; nodes: number },
  depth: number,
): string {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    throw new PlanDraftReceiptInputError("The plan draft receipt payload was too deeply nested.");
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PlanDraftReceiptInputError("The plan draft receipt payload contained a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new PlanDraftReceiptInputError("The plan draft receipt payload was not JSON-compatible.");
  }
  if (state.active.has(value)) {
    throw new PlanDraftReceiptInputError("The plan draft receipt payload contained a cycle.");
  }

  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new PlanDraftReceiptInputError("The plan draft receipt payload contained a sparse array.");
        }
        values.push(canonicalValue(value[index], state, depth + 1));
      }
      return `[${values.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PlanDraftReceiptInputError("The plan draft receipt payload contained a non-plain object.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new PlanDraftReceiptInputError("The plan draft receipt payload contained symbol keys.");
    }

    const entries = Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new PlanDraftReceiptInputError("The plan draft receipt payload contained an accessor.");
      }
      return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, state, depth + 1)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    state.active.delete(value);
  }
}

function sign(message: string, secret: string) {
  return createHmac("sha256", secret).update(message, "utf8").digest("base64url");
}

function keyId(secret: string) {
  return createHmac("sha256", secret)
    .update(`${RECEIPT_DOMAIN}.kid`, "utf8")
    .digest("base64url")
    .slice(0, KID_LENGTH);
}

function readSecrets(injected?: PlanDraftReceiptSecrets) {
  const current = validateSecret(
    injected?.current ?? process.env[CURRENT_SECRET_ENV],
    CURRENT_SECRET_ENV,
    true,
  );
  const previous = validateSecret(
    injected?.previous ?? (injected ? undefined : process.env[PREVIOUS_SECRET_ENV]),
    PREVIOUS_SECRET_ENV,
    false,
  );
  return Object.freeze({
    current,
    ...(previous && previous !== current ? { previous } : {}),
  });
}

function validateSecret(value: string | undefined, name: string, required: true): string;
function validateSecret(value: string | undefined, name: string, required: false): string | undefined;
function validateSecret(value: string | undefined, name: string, required: boolean) {
  if (value === undefined || value === "") {
    if (!required) return undefined;
    throw new PlanDraftReceiptConfigurationError(`${name} is required.`);
  }
  if (
    value.length < PLAN_DRAFT_RECEIPT_SECRET_MIN_LENGTH
    || value.length > SECRET_MAX_LENGTH
    || value.trim() !== value
  ) {
    throw new PlanDraftReceiptConfigurationError(
      `${name} must contain between ${PLAN_DRAFT_RECEIPT_SECRET_MIN_LENGTH} and ${SECRET_MAX_LENGTH} characters.`,
    );
  }
  return value;
}

function secretForKid(
  secrets: Readonly<{ current: string; previous?: string }>,
  kid: string,
) {
  if (keyId(secrets.current) === kid) return secrets.current;
  if (secrets.previous && keyId(secrets.previous) === kid) return secrets.previous;
  return null;
}

function parseReceipt(receipt: string):
  | { ok: true; kid: string; issuedAt: string; expiresAt: string; signature: string }
  | Extract<PlanDraftReceiptVerification, { ok: false }> {
  if (
    typeof receipt !== "string"
    || receipt.length < 1
    || receipt.length > PLAN_DRAFT_RECEIPT_MAX_LENGTH
  ) return failure("malformed_receipt");
  const parts = receipt.split(".");
  if (parts.length !== 6 || parts[0] !== RECEIPT_PREFIX) {
    return failure("malformed_receipt");
  }
  if (parts[1] !== PLAN_DRAFT_RECEIPT_VERSION) {
    return failure("unsupported_version");
  }
  const [, , kid, issuedAt, expiresAt, signature] = parts;
  if (
    !kid
    || !issuedAt
    || !expiresAt
    || !signature
    || !new RegExp(`^[A-Za-z0-9_-]{${KID_LENGTH}}$`, "u").test(kid)
    || !/^(?:0|[1-9]\d{0,15})$/u.test(issuedAt)
    || !/^(?:0|[1-9]\d{0,15})$/u.test(expiresAt)
    || !new RegExp(`^[A-Za-z0-9_-]{${SIGNATURE_LENGTH}}$`, "u").test(signature)
  ) return failure("malformed_receipt");
  return { ok: true, kid, issuedAt, expiresAt, signature };
}

function parseReceiptTime(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseInstant(value: Date | string | number, label: string) {
  const parsed = instantMilliseconds(value);
  if (parsed === null) {
    throw new PlanDraftReceiptInputError(`${label} must be a valid millisecond-precise instant.`);
  }
  return parsed;
}

function safeVerifyInstant(value: Date | string | number) {
  try {
    return parseInstant(value, "now");
  } catch (error) {
    if (error instanceof PlanDraftReceiptInputError) return null;
    throw error;
  }
}

function instantMilliseconds(value: Date | string | number) {
  const milliseconds = value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? Date.parse(value)
      : value;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

function assertIssueTimeWindow(issuedAtMs: number, expiresAtMs: number) {
  if (!validTimeWindow(issuedAtMs, expiresAtMs)) {
    throw new PlanDraftReceiptInputError(
      `A plan draft receipt must expire after issue and within ${PLAN_DRAFT_RECEIPT_MAX_LIFETIME_MS} milliseconds.`,
    );
  }
}

function validTimeWindow(issuedAtMs: number, expiresAtMs: number) {
  return expiresAtMs > issuedAtMs
    && expiresAtMs - issuedAtMs <= PLAN_DRAFT_RECEIPT_MAX_LIFETIME_MS;
}

function parseAuthenticatedUserId(value: string) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 200
    || value.trim() !== value
  ) {
    throw new PlanDraftReceiptInputError("An exact authenticated user id is required.");
  }
  return value;
}

function decodeSignature(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function receiptMetadata(kid: string, issuedAtMs: number, expiresAtMs: number) {
  return Object.freeze({
    version: PLAN_DRAFT_RECEIPT_VERSION,
    kid,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

function failure(
  reason: Extract<PlanDraftReceiptVerification, { ok: false }>["reason"],
) {
  return Object.freeze({ ok: false as const, reason });
}

import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { disabledBlurtingCanonicalJsonV18 } from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  disabledBlurtingCanonicalTextV18Schema,
  disabledBlurtingUnicodeScalarLengthV18,
  isDisabledBlurtingTrimStringCanonicalV18,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  DisabledBlurtingCanonicalUuidV18Schema,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";

export const DISABLED_BLURTING_ANSWER_HMAC_DOMAIN =
  "yova.blurting.answer_hmac.v18|" as const;
export const DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES = 32;
export const DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES = 4_096;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ActivityIndexSchema = z.number().int().min(0).max(23);
const RouteIdentitySchema = z.object({
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
}).strict();

const EvaluationIdentitySchema = z.object({
  evaluationReceiptId: DisabledBlurtingCanonicalUuidV18Schema,
  deliveryReceiptId: DisabledBlurtingCanonicalUuidV18Schema,
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  routeIdentity: RouteIdentitySchema,
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: ActivityIndexSchema,
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
}).strict();

const LearnerAnswerSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  maxCodePoints: DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
});

const AnswerHmacClaimV18Schema = EvaluationIdentitySchema.extend({
  learnerAnswer: LearnerAnswerSchema,
}).strict();

/** Exact JSON claim passed to private.blurting_evaluation_request_digest_v18. */
export const DisabledBlurtingEvaluationRequestDigestClaimV18Schema =
  EvaluationIdentitySchema.extend({
    answerHmac: Sha256HexSchema,
    evaluatorVersion: z.literal(DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION),
  }).strict();

export const DisabledBlurtingServerAnswerHmacBindingV18Schema =
  EvaluationIdentitySchema.extend({
  answerHmac: Sha256HexSchema,
}).strict();

export const DisabledBlurtingServerRequestDigestBindingV18Schema = z.object({
  requestClaim: DisabledBlurtingEvaluationRequestDigestClaimV18Schema,
  requestDigest: Sha256HexSchema,
}).strict();

/**
 * Non-authoritative cryptographic primitive behind the evaluator boundary.
 * Raw identity can derive only structural bytes/claims here; this module owns
 * no authority brand. Only the evaluator contract can brand the result, and it
 * does so only after validating its opaque repository-backed server input.
 * Neither the dedicated secret nor learner answer is returned.
 */
export function deriveDisabledBlurtingEvaluationDigestsV18(
  identityValue: unknown,
  learnerAnswerValue: unknown,
  secretValue: unknown,
) {
  const identity = EvaluationIdentitySchema.safeParse(identityValue);
  const learnerAnswer = LearnerAnswerSchema.safeParse(learnerAnswerValue);
  const secret = readSecret(secretValue);
  if (!identity.success || !learnerAnswer.success || !secret) return null;

  const answerClaim = AnswerHmacClaimV18Schema.safeParse({
    ...identity.data,
    learnerAnswer: learnerAnswer.data,
  });
  if (!answerClaim.success) return null;

  let answerHmacHex: string;
  try {
    answerHmacHex = createHmac("sha256", secret)
      .update(DISABLED_BLURTING_ANSWER_HMAC_DOMAIN, "utf8")
      .update(disabledBlurtingCanonicalJsonV18(answerClaim.data), "utf8")
      .digest("hex");
  } finally {
    secret.fill(0);
  }
  const answerHmac = DisabledBlurtingServerAnswerHmacBindingV18Schema.parse({
    ...identity.data,
    answerHmac: answerHmacHex,
  });

  const requestClaim = DisabledBlurtingEvaluationRequestDigestClaimV18Schema
    .safeParse({
      ...identity.data,
      answerHmac: answerHmacHex,
      evaluatorVersion: DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
    });
  if (!requestClaim.success) return null;

  const requestDigest = DisabledBlurtingServerRequestDigestBindingV18Schema.parse({
    requestClaim: requestClaim.data,
    requestDigest: createHash("sha256")
      .update(DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN, "utf8")
      .update(disabledBlurtingCanonicalJsonV18(requestClaim.data), "utf8")
      .digest("hex"),
  });
  return deepFreeze({ answerHmac, requestDigest });
}

/** Fixed-size constant-time comparison; it grants no authority. */
export function disabledBlurtingTimingSafeSha256HexEqualV18(
  left: unknown,
  right: unknown,
) {
  return Sha256HexSchema.safeParse(left).success
    && Sha256HexSchema.safeParse(right).success
    && timingSafeEqualHex(left as string, right as string);
}

function readSecret(value: unknown) {
  if (
    typeof value !== "string"
    || !isDisabledBlurtingTrimStringCanonicalV18(value)
    || disabledBlurtingUnicodeScalarLengthV18(value) === null
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) return null;
  const bytes = Buffer.from(value, "utf8");
  if (
    bytes.byteLength < DISABLED_BLURTING_HMAC_SECRET_MIN_BYTES
    || bytes.byteLength > DISABLED_BLURTING_HMAC_SECRET_MAX_BYTES
  ) return null;
  return bytes;
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === 32
    && rightBytes.byteLength === 32
    && timingSafeEqual(leftBytes, rightBytes);
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

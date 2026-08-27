import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { BROAD_RECALL_TRANSFER_RESULTS } from "@/lib/learning/broad-recall-progress";
import { DisabledBlurtingCanonicalInstantV18Schema } from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
  DisabledBlurtingCanonicalUuidV18Schema,
  DisabledBlurtingPublicIdentityV18Schema,
  DisabledBlurtingPublicResourceTemplateV18Schema,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

export const DISABLED_BLURTING_VERIFIED_COMPLETION_BOUNDARY =
  "disabled_server_loaded_completion_only" as const;
export const DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN =
  "yova.blurting.evaluation_request.v18|" as const;
export const DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN =
  "yova.blurting.evaluation_result.v18|" as const;
const DISABLED_BLURTING_DELIVERY_RECEIPT_DIGEST_DOMAIN =
  "yova.blurting.delivery_receipt.v18|" as const;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedInstantSchema = DisabledBlurtingCanonicalInstantV18Schema;
const ActivityIndexSchema = z.number().int().min(0).max(23);

const VerifiedResultBindingSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  result: z.enum(BROAD_RECALL_TRANSFER_RESULTS),
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const ExpectedBindingSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const RouteIdentitySchema = z.object({
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
}).strict();

const CompletionCurrentRouteAuthoritySchema = z.object({
  authority: z.literal("server_loaded_current_blurting_route_v18"),
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  committedRouteRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeLifecycle: z.literal("committed"),
  routeFingerprint: z.string().regex(/^sr1:[0-9a-f]{64}$/),
  methodId: z.literal("retrieval_practice"),
  supportingTechniqueId: z.literal("blurting_v1"),
  executionEnvironment: z.literal("inside_yova"),
}).strict().superRefine((route, context) => {
  if (route.committedRouteRevisionId !== route.routeRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["committedRouteRevisionId"],
      message: "Completion requires the current committed route pointer.",
    });
  }
});

const ExpectedResourceIdentitySchema = z.object({
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  resourceFingerprint: z.string().regex(/^sr1:[0-9a-f]{16}$/),
  resourceGeneratedAt: BoundedInstantSchema,
  resourceDigest: Sha256HexSchema,
}).strict();

const CompletionDeliveryResourceIdentitySchema =
  ExpectedResourceIdentitySchema.extend({
    publicPayloadDigest: Sha256HexSchema,
  }).strict();

/**
 * Exact final private row returned by a repository query over 006. The query
 * must select this row by authenticated owner and its primary key; the HMAC is
 * server-keyed and never derivable from browser JSON.
 */
export const DisabledBlurtingLoadedEvaluationReceiptRowV18Schema = z.object({
  authority: z.literal("server_loaded_blurting_evaluation_receipt_v18"),
  evaluationReceiptId: DisabledBlurtingCanonicalUuidV18Schema,
  deliveryReceiptId: DisabledBlurtingCanonicalUuidV18Schema,
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  routeIdentity: RouteIdentitySchema,
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: ActivityIndexSchema,
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
  answerHmac: Sha256HexSchema,
  evaluatorVersion: z.literal(DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION),
  state: z.enum(["succeeded", "unavailable"]),
  resultVector: z.array(VerifiedResultBindingSchema).min(1).max(3),
  requestDigest: Sha256HexSchema,
  resultDigest: Sha256HexSchema,
  issuedAt: BoundedInstantSchema,
  leasedUntil: z.null(),
  completedAt: BoundedInstantSchema,
  expiresAt: BoundedInstantSchema,
}).strict().superRefine((row, context) => {
  reportDuplicateBindings(row.resultVector, context, ["resultVector"]);
  if (
    row.state === "unavailable"
    && row.resultVector.some((binding) => binding.result !== "unverified")
  ) {
    context.addIssue({
      code: "custom",
      path: ["resultVector"],
      message: "An unavailable evaluator must leave every target unverified.",
    });
  }
  const issuedAt = Date.parse(row.issuedAt);
  const completedAt = Date.parse(row.completedAt);
  const expiresAt = Date.parse(row.expiresAt);
  if (expiresAt - issuedAt !== 2_592_000_000) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "An evaluation receipt expires exactly thirty days after issuance.",
    });
  }
  if (completedAt < issuedAt || completedAt >= expiresAt) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "Evaluation completion must be inside the receipt lifetime.",
    });
  }
});

const CompletionResourceRowSchema = z.object({
  authority: z.literal("server_loaded_blurting_resource_row_v18"),
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  routeIdentity: RouteIdentitySchema,
  resourceFingerprint: z.string().regex(/^sr1:[0-9a-f]{16}$/),
  resourceGeneratedAt: BoundedInstantSchema,
  state: z.literal("ready"),
  publicPayloadDigest: Sha256HexSchema,
  resourceDigest: Sha256HexSchema,
  publicPayload: DisabledBlurtingPublicResourceTemplateV18Schema,
}).strict().superRefine((row, context) => {
  const identity = row.publicPayload.identity;
  if (
    row.routeIdentity.planId !== identity.planId
    || row.routeIdentity.sessionId !== identity.sessionId
    || row.routeIdentity.routeRevisionId !== identity.routeRevisionId
    || row.resourceFingerprint !== identity.resourceFingerprint
    || row.resourceGeneratedAt !== identity.resourceGeneratedAt
  ) {
    context.addIssue({
      code: "custom",
      path: ["publicPayload", "identity"],
      message: "The loaded resource row must bind its exact public payload identity.",
    });
  }
});

const CompletionDeliveryReceiptSchema = z.object({
  authority: z.literal("blurting_delivery_receipt_v18"),
  state: z.literal("completed"),
  deliveryHandle: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: ActivityIndexSchema,
  routeIdentity: RouteIdentitySchema,
  resourceIdentity: CompletionDeliveryResourceIdentitySchema,
  receiptDigest: Sha256HexSchema,
  issuedAt: BoundedInstantSchema,
  lastSeenAt: BoundedInstantSchema,
  expiresAt: BoundedInstantSchema,
  disclosureStage: z.literal("complete"),
  recallDisclosedAt: BoundedInstantSchema,
  compareDisclosedAt: BoundedInstantSchema,
  repairDisclosedAt: BoundedInstantSchema,
  transferDisclosedAt: BoundedInstantSchema,
  completeDisclosedAt: BoundedInstantSchema,
  closedAt: BoundedInstantSchema,
}).strict().superRefine((receipt, context) => {
  const issuedAt = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (expiresAt - issuedAt !== 691_200_000) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "The joined delivery receipt expires exactly eight days after issuance.",
    });
  }
  let prior = issuedAt;
  for (const [field, value] of [
    ["recallDisclosedAt", receipt.recallDisclosedAt],
    ["compareDisclosedAt", receipt.compareDisclosedAt],
    ["repairDisclosedAt", receipt.repairDisclosedAt],
    ["transferDisclosedAt", receipt.transferDisclosedAt],
    ["completeDisclosedAt", receipt.completeDisclosedAt],
  ] as const) {
    const timestamp = Date.parse(value);
    if (timestamp < prior || timestamp >= expiresAt) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: "Joined disclosure timestamps must be monotonic and live.",
      });
    }
    prior = timestamp;
  }
  if (
    Date.parse(receipt.lastSeenAt) < Date.parse(receipt.completeDisclosedAt)
    || Date.parse(receipt.lastSeenAt) >= expiresAt
    || receipt.closedAt !== receipt.completeDisclosedAt
  ) {
    context.addIssue({
      code: "custom",
      path: ["lastSeenAt"],
      message: "The joined completion receipt must bind its terminal timestamps.",
    });
  }
  const expectedDigest = digestCanonicalJson(
    DISABLED_BLURTING_DELIVERY_RECEIPT_DIGEST_DOMAIN,
    {
      receiptId: receipt.deliveryHandle,
      resourceId: receipt.resourceIdentity.resourceId,
      userId: receipt.userId,
      planId: receipt.routeIdentity.planId,
      planSessionId: receipt.routeIdentity.sessionId,
      routeRevisionId: receipt.routeIdentity.routeRevisionId,
      runId: receipt.runId,
      activityIndex: receipt.activityIndex,
      publicPayloadDigest: receipt.resourceIdentity.publicPayloadDigest,
      resourceDigest: receipt.resourceIdentity.resourceDigest,
    },
  );
  if (receipt.receiptDigest !== expectedDigest) {
    context.addIssue({
      code: "custom",
      path: ["receiptDigest"],
      message: "The joined receipt digest must match the exact SQL 006 claim.",
    });
  }
});

/**
 * Reserved shape for a future repository's single joined load. Parsing it is
 * deliberately non-authoritative: this disabled module exposes no raw-to-brand
 * path, and the completion constructor accepts only its private runtime brand.
 */
export const DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema = z.object({
  authority: z.literal("server_loaded_blurting_completion_join_v18"),
  observedAt: BoundedInstantSchema,
  routeAuthority: CompletionCurrentRouteAuthoritySchema,
  resourceRow: CompletionResourceRowSchema,
  deliveryReceipt: CompletionDeliveryReceiptSchema,
  evaluationReceipt: DisabledBlurtingLoadedEvaluationReceiptRowV18Schema,
}).strict().superRefine((join, context) => {
  const resource = join.resourceRow;
  const delivery = join.deliveryReceipt;
  const evaluation = join.evaluationReceipt;
  const route = join.routeAuthority;
  if (
    route.userId !== resource.userId
    || route.planId !== resource.routeIdentity.planId
    || route.sessionId !== resource.routeIdentity.sessionId
    || route.routeRevisionId !== resource.routeIdentity.routeRevisionId
    || delivery.resourceIdentity.resourceId !== resource.resourceId
    || delivery.resourceIdentity.resourceFingerprint !== resource.resourceFingerprint
    || delivery.resourceIdentity.resourceGeneratedAt !== resource.resourceGeneratedAt
    || delivery.resourceIdentity.publicPayloadDigest !== resource.publicPayloadDigest
    || delivery.resourceIdentity.resourceDigest !== resource.resourceDigest
    || delivery.userId !== resource.userId
    || !sameRouteIdentity(delivery.routeIdentity, resource.routeIdentity)
  ) {
    context.addIssue({
      code: "custom",
      path: ["deliveryReceipt"],
      message: "The completion delivery must bind the exact ready resource row.",
    });
  }
  if (
    evaluation.deliveryReceiptId !== delivery.deliveryHandle
    || evaluation.resourceId !== resource.resourceId
    || evaluation.userId !== resource.userId
    || evaluation.runId !== delivery.runId
    || evaluation.activityIndex !== delivery.activityIndex
    || !sameRouteIdentity(evaluation.routeIdentity, resource.routeIdentity)
    || !sameOrderedBindings(
      evaluation.resultVector,
      resource.publicPayload.orderedTargets,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["evaluationReceipt"],
      message: "The evaluation row must bind its exact resource and delivery parents.",
    });
  }
  if (
    Date.parse(delivery.completeDisclosedAt) < Date.parse(evaluation.completedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["deliveryReceipt", "completeDisclosedAt"],
      message: "Completion cannot be disclosed before evaluation finishes.",
    });
  }
  const observedAt = Date.parse(join.observedAt);
  if (
    observedAt < Date.parse(delivery.lastSeenAt)
    || observedAt < Date.parse(delivery.completeDisclosedAt)
    || observedAt < Date.parse(evaluation.completedAt)
    || observedAt >= Date.parse(delivery.expiresAt)
    || observedAt >= Date.parse(evaluation.expiresAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["observedAt"],
      message: "Completion must use live DB-owned time from the joined load.",
    });
  }
});

export const DisabledBlurtingVerifiedCompletionExpectationV18Schema = z.object({
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  identity: DisabledBlurtingPublicIdentityV18Schema,
  resourceIdentity: ExpectedResourceIdentitySchema,
  orderedBindings: z.array(ExpectedBindingSchema).min(1).max(3),
}).strict().superRefine((expectation, context) => {
  reportDuplicateBindings(expectation.orderedBindings, context, ["orderedBindings"]);
  if (
    expectation.identity.resourceFingerprint
      !== expectation.resourceIdentity.resourceFingerprint
    || expectation.identity.resourceGeneratedAt
      !== expectation.resourceIdentity.resourceGeneratedAt
  ) {
    context.addIssue({
      code: "custom",
      path: ["resourceIdentity"],
      message: "Expected public and private resource identity must match exactly.",
    });
  }
});

const VerifiedReceiptProjectionSchema = z.object({
  authority: z.literal("verified_loaded_evaluation_row"),
  evaluationReceiptHandle: DisabledBlurtingCanonicalUuidV18Schema,
  deliveryReceiptHandle: DisabledBlurtingCanonicalUuidV18Schema,
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  resourceDigest: Sha256HexSchema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  requestDigest: Sha256HexSchema,
  resultDigest: Sha256HexSchema,
}).strict();

export const DisabledBlurtingVerifiedCompletionContextV18Schema = z.object({
  schemaVersion: z.literal(18),
  boundaryStatus: z.literal(DISABLED_BLURTING_VERIFIED_COMPLETION_BOUNDARY),
  receipt: VerifiedReceiptProjectionSchema,
  identity: DisabledBlurtingPublicIdentityV18Schema,
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
  evaluatorVersion: z.literal(DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION),
  resolution: z.enum(["evaluated", "evaluator_unavailable"]),
  orderedResults: z.array(VerifiedResultBindingSchema).min(1).max(3),
}).strict().superRefine((completion, context) => {
  reportDuplicateBindings(completion.orderedResults, context, ["orderedResults"]);
  if (
    completion.resolution === "evaluator_unavailable"
    && completion.orderedResults.some((binding) => binding.result !== "unverified")
  ) {
    context.addIssue({
      code: "custom",
      path: ["orderedResults"],
      message: "An unavailable evaluator must resolve every target as unverified.",
    });
  }
});

type ParsedVerifiedCompletion = z.infer<
  typeof DisabledBlurtingVerifiedCompletionContextV18Schema
>;
type ParsedVerifiedCompletionExpectation = z.infer<
  typeof DisabledBlurtingVerifiedCompletionExpectationV18Schema
>;
type ParsedRepositoryLoadedCompletionJoin = z.infer<
  typeof DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema
>;

const verifiedCompletionRuntimeBrand = Symbol(
  "disabled-blurting-verified-completion-v18",
);
const repositoryLoadedCompletionRuntimeBrand = Symbol(
  "disabled-blurting-repository-loaded-completion-v18",
);

export type DisabledBlurtingVerifiedCompletionContextV18 = DeepReadonly<
  ParsedVerifiedCompletion
> & Readonly<{
  [verifiedCompletionRuntimeBrand]: true;
}>;

export type DisabledBlurtingVerifiedCompletionExpectationV18 = DeepReadonly<
  ParsedVerifiedCompletionExpectation
>;

export type DisabledBlurtingRepositoryLoadedCompletionJoinV18 = DeepReadonly<
  ParsedRepositoryLoadedCompletionJoin
> & Readonly<{
  [repositoryLoadedCompletionRuntimeBrand]: true;
}>;

/**
 * The sole verified-context constructor. It accepts only the module-branded
 * joined repository result, rechecks current liveness and the caller's exact
 * resource/delivery/target expectation, then attaches a second runtime
 * capability. No raw-to-brand constructor exists while persistence is
 * disabled; a future repository-owned joined SELECT must add the private
 * capability issuance in this module before completion can become reachable.
 */
export function createDisabledBlurtingVerifiedCompletionContextV18(
  loadedCompletionJoinValue: DisabledBlurtingRepositoryLoadedCompletionJoinV18,
  expectationValue: unknown,
): DisabledBlurtingVerifiedCompletionContextV18 | null {
  if (!hasRepositoryLoadedCompletionRuntimeBrand(loadedCompletionJoinValue)) {
    return null;
  }
  const expectation = DisabledBlurtingVerifiedCompletionExpectationV18Schema.safeParse(
    expectationValue,
  );
  if (!expectation.success) return null;

  const expected = expectation.data;
  const join = loadedCompletionJoinValue;
  const receipt = join.evaluationReceipt;
  const delivery = join.deliveryReceipt;
  const resource = join.resourceRow;
  const observedAtMs = Date.parse(join.observedAt);
  if (
    receipt.userId !== expected.userId
    || receipt.resourceId !== expected.resourceIdentity.resourceId
    || resource.resourceDigest !== expected.resourceIdentity.resourceDigest
    || resource.resourceFingerprint !== expected.resourceIdentity.resourceFingerprint
    || resource.resourceGeneratedAt !== expected.resourceIdentity.resourceGeneratedAt
    || receipt.deliveryReceiptId !== expected.identity.deliveryHandle
    || receipt.runId !== expected.identity.runId
    || receipt.activityIndex !== expected.identity.activityIndex
    || !sameRouteIdentity(receipt.routeIdentity, expected.identity)
    || !sameOrderedBindings(
      expected.orderedBindings,
      resource.publicPayload.orderedTargets,
    )
    || !sameOrderedBindings(receipt.resultVector, expected.orderedBindings)
    || observedAtMs < Date.parse(receipt.completedAt)
    || observedAtMs < Date.parse(delivery.completeDisclosedAt)
    || observedAtMs < Date.parse(receipt.issuedAt)
    || observedAtMs >= Date.parse(receipt.expiresAt)
    || observedAtMs >= Date.parse(delivery.expiresAt)
  ) {
    return null;
  }

  const expectedRequestDigest = digestCanonicalJson(
    DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
    evaluationRequestClaim(receipt),
  );
  const resolution = receipt.state === "succeeded"
    ? "evaluated" as const
    : "evaluator_unavailable" as const;
  const expectedResultDigest = digestCanonicalJson(
    DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
    {
      evaluationReceiptId: receipt.evaluationReceiptId,
      requestDigest: expectedRequestDigest,
      resolution,
      orderedResults: receipt.resultVector,
    },
  );
  if (
    receipt.requestDigest !== expectedRequestDigest
    || receipt.resultDigest !== expectedResultDigest
  ) {
    return null;
  }

  const parsed = DisabledBlurtingVerifiedCompletionContextV18Schema.safeParse({
    schemaVersion: 18 as const,
    boundaryStatus: DISABLED_BLURTING_VERIFIED_COMPLETION_BOUNDARY,
    receipt: {
      authority: "verified_loaded_evaluation_row" as const,
      evaluationReceiptHandle: receipt.evaluationReceiptId,
      deliveryReceiptHandle: receipt.deliveryReceiptId,
      resourceId: receipt.resourceId,
      resourceDigest: resource.resourceDigest,
      userId: receipt.userId,
      requestDigest: receipt.requestDigest,
      resultDigest: receipt.resultDigest,
    },
    identity: expected.identity,
    requestToken: receipt.requestToken,
    evaluatorVersion: receipt.evaluatorVersion,
    resolution,
    orderedResults: receipt.resultVector,
  });
  return parsed.success ? brandAndFreeze(parsed.data) : null;
}

/** Rebinds only an already branded context; arbitrary wrapped JSON fails. */
export function readDisabledBlurtingVerifiedCompletionContextV18(
  value: unknown,
  expectationValue: unknown,
): DisabledBlurtingVerifiedCompletionContextV18 | null {
  if (!hasVerifiedCompletionRuntimeBrand(value)) return null;
  const expectation = DisabledBlurtingVerifiedCompletionExpectationV18Schema.safeParse(
    expectationValue,
  );
  if (!expectation.success) return null;
  if (
    value.receipt.userId !== expectation.data.userId
    || value.receipt.resourceId !== expectation.data.resourceIdentity.resourceId
    || value.receipt.resourceDigest
      !== expectation.data.resourceIdentity.resourceDigest
    || !sameIdentity(value.identity, expectation.data.identity)
    || !sameOrderedBindings(value.orderedResults, expectation.data.orderedBindings)
  ) {
    return null;
  }
  return value;
}

function evaluationRequestClaim(
  row: DeepReadonly<z.infer<typeof DisabledBlurtingLoadedEvaluationReceiptRowV18Schema>>,
) {
  return {
    evaluationReceiptId: row.evaluationReceiptId,
    deliveryReceiptId: row.deliveryReceiptId,
    resourceId: row.resourceId,
    userId: row.userId,
    routeIdentity: row.routeIdentity,
    runId: row.runId,
    activityIndex: row.activityIndex,
    requestToken: row.requestToken,
    answerHmac: row.answerHmac,
    evaluatorVersion: row.evaluatorVersion,
  };
}

function requireExactFinalCheckEvidenceId(
  binding: { targetId: string; evidenceId: string },
  context: z.RefinementCtx,
) {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "Verified Blurting results require the exact final-check evidence ID.",
    });
  }
}

function reportDuplicateBindings(
  bindings: readonly { targetId: string; evidenceId: string }[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(bindings.map((binding) => binding.targetId)).size !== bindings.length) {
    context.addIssue({ code: "custom", path, message: "Verified target IDs must be unique." });
  }
  if (new Set(bindings.map((binding) => binding.evidenceId)).size !== bindings.length) {
    context.addIssue({ code: "custom", path, message: "Verified evidence IDs must be unique." });
  }
}

function sameRouteIdentity(
  left: z.infer<typeof RouteIdentitySchema>,
  right: z.infer<typeof RouteIdentitySchema>,
) {
  return left.planId === right.planId
    && left.sessionId === right.sessionId
    && left.routeRevisionId === right.routeRevisionId;
}

function sameIdentity(
  left: z.infer<typeof DisabledBlurtingPublicIdentityV18Schema>,
  right: z.infer<typeof DisabledBlurtingPublicIdentityV18Schema>,
) {
  return left.planId === right.planId
    && left.sessionId === right.sessionId
    && left.routeRevisionId === right.routeRevisionId
    && left.deliveryHandle === right.deliveryHandle
    && left.runId === right.runId
    && left.resourceFingerprint === right.resourceFingerprint
    && left.resourceGeneratedAt === right.resourceGeneratedAt
    && left.activityIndex === right.activityIndex;
}

function sameOrderedBindings(
  left: readonly { targetId: string; evidenceId: string }[],
  right: readonly { targetId: string; evidenceId: string }[],
) {
  return left.length === right.length
    && left.every((binding, index) => (
      binding.targetId === right[index]?.targetId
      && binding.evidenceId === right[index]?.evidenceId
    ));
}

function digestCanonicalJson(domain: string, value: unknown) {
  return createHash("sha256").update(domain).update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Unsupported canonical JSON value.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  return `{${keys.map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`
  )).join(",")}}`;
}

function hasVerifiedCompletionRuntimeBrand(
  value: unknown,
): value is DisabledBlurtingVerifiedCompletionContextV18 {
  return Boolean(
    value
    && typeof value === "object"
    && verifiedCompletionRuntimeBrand in value
    && (value as Record<PropertyKey, unknown>)[verifiedCompletionRuntimeBrand] === true,
  );
}

function hasRepositoryLoadedCompletionRuntimeBrand(
  value: unknown,
): value is DisabledBlurtingRepositoryLoadedCompletionJoinV18 {
  return Boolean(
    value
    && typeof value === "object"
    && repositoryLoadedCompletionRuntimeBrand in value
    && (value as Record<PropertyKey, unknown>)[
      repositoryLoadedCompletionRuntimeBrand
    ] === true,
  );
}

function brandAndFreeze(
  value: ParsedVerifiedCompletion,
): DisabledBlurtingVerifiedCompletionContextV18 {
  Object.defineProperty(value, verifiedCompletionRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingVerifiedCompletionContextV18;
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

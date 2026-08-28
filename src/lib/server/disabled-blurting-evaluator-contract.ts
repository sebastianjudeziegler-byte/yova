import "server-only";

import { z } from "zod";
import { BROAD_RECALL_TRANSFER_RESULTS } from "@/lib/learning/broad-recall-progress";
import {
  DISABLED_BLURTING_ANSWER_HMAC_DOMAIN,
  DisabledBlurtingEvaluationRequestDigestClaimV18Schema,
  DisabledBlurtingServerAnswerHmacBindingV18Schema,
  DisabledBlurtingServerRequestDigestBindingV18Schema,
  deriveDisabledBlurtingEvaluationDigestsV18,
  disabledBlurtingTimingSafeSha256HexEqualV18,
} from "@/lib/server/disabled-blurting-hmac-authority-v18";
import {
  DisabledBlurtingDeliveryReceiptContextV18Schema,
  DisabledBlurtingLoadedResourceRowV18Schema,
  readDisabledBlurtingPrivateResourceV18,
  readDisabledBlurtingRepositoryExecutionCapabilityV18,
  toDisabledBlurtingTransferDisclosureV18,
  type DisabledBlurtingRepositoryExecutionCapabilityV18,
} from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
  DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  DisabledBlurtingCanonicalInstantV18Schema,
  disabledBlurtingCanonicalTextV18Schema,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  DisabledBlurtingCanonicalUuidV18Schema,
  DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
  readDisabledBlurtingEvaluatorTransportV18,
  type DisabledBlurtingEvaluatorTransportV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

export {
  DISABLED_BLURTING_ANSWER_HMAC_DOMAIN,
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
  DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
  DisabledBlurtingEvaluationRequestDigestClaimV18Schema,
};

export const DISABLED_BLURTING_EVALUATOR_BOUNDARY =
  "disabled_server_bound_evaluator_v18" as const;
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedInstantSchema = DisabledBlurtingCanonicalInstantV18Schema;
const EvaluationResultSchema = z.enum(BROAD_RECALL_TRANSFER_RESULTS);

type RouteIdentity = Readonly<{
  planId: string;
  sessionId: string;
  routeRevisionId: string;
}>;

const EvaluationTargetContractSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  concept: disabledBlurtingCanonicalTextV18Schema({
    minCodePoints: 2,
    maxCodePoints: 120,
  }),
  transferSuccessCriterion: disabledBlurtingCanonicalTextV18Schema({
    minCodePoints: 8,
    maxCodePoints: 600,
  }),
  referenceAnswer: disabledBlurtingCanonicalTextV18Schema({
    minCodePoints: 1,
    maxCodePoints: 1_200,
  }),
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const OrderedEvaluationResultSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  result: EvaluationResultSchema,
}).strict().superRefine(requireExactFinalCheckEvidenceId);

export const DisabledBlurtingEvaluationOutcomeV18Schema = z.object({
  evaluatorVersion: z.literal(DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION),
  requestToken: DisabledBlurtingCanonicalUuidV18Schema,
  resolution: z.enum(["evaluated", "evaluator_unavailable"]),
  orderedResults: z.array(OrderedEvaluationResultSchema).min(1).max(3),
}).strict().superRefine((outcome, context) => {
  reportDuplicateBindings(outcome.orderedResults, context, ["orderedResults"]);
  if (
    outcome.resolution === "evaluator_unavailable"
    && outcome.orderedResults.some((result) => result.result !== "unverified")
  ) {
    context.addIssue({
      code: "custom",
      path: ["orderedResults"],
      message: "Evaluator unavailability must leave every target unverified.",
    });
  }
});

/** Exact JSON claim passed to private.blurting_evaluation_result_digest_v18. */
export const DisabledBlurtingEvaluationResultDigestClaimV18Schema = z.object({
  evaluationReceiptId: DisabledBlurtingCanonicalUuidV18Schema,
  requestDigest: Sha256HexSchema,
  resolution: z.enum(["evaluated", "evaluator_unavailable"]),
  orderedResults: z.array(OrderedEvaluationResultSchema).min(1).max(3),
}).strict().superRefine((claim, context) => {
  reportDuplicateBindings(claim.orderedResults, context, ["orderedResults"]);
  if (
    claim.resolution === "evaluator_unavailable"
    && claim.orderedResults.some((result) => result.result !== "unverified")
  ) {
    context.addIssue({
      code: "custom",
      path: ["orderedResults"],
      message: "An unavailable result claim must contain only unverified results.",
    });
  }
});

type ParsedLoadedResourceRow = z.infer<
  typeof DisabledBlurtingLoadedResourceRowV18Schema
>;
type ParsedDeliveryReceipt = z.infer<
  typeof DisabledBlurtingDeliveryReceiptContextV18Schema
>;
type ParsedEvaluationTargetContract = z.infer<
  typeof EvaluationTargetContractSchema
>;
type ParsedEvaluationOutcome = z.infer<
  typeof DisabledBlurtingEvaluationOutcomeV18Schema
>;
type ParsedRequestClaim = z.infer<
  typeof DisabledBlurtingEvaluationRequestDigestClaimV18Schema
>;
type ParsedAnswerHmacBinding = z.infer<
  typeof DisabledBlurtingServerAnswerHmacBindingV18Schema
>;
type ParsedRequestDigestBinding = z.infer<
  typeof DisabledBlurtingServerRequestDigestBindingV18Schema
>;
type ParsedResultClaim = z.infer<
  typeof DisabledBlurtingEvaluationResultDigestClaimV18Schema
>;

const boundEvaluationInputRuntimeBrand = Symbol(
  "disabled-blurting-bound-evaluator-v18",
);
const answerHmacRuntimeBrand = Symbol(
  "disabled-blurting-server-answer-hmac-v18",
);
const requestDigestRuntimeBrand = Symbol(
  "disabled-blurting-server-request-digest-v18",
);
const evaluationOutcomeRuntimeBrand = Symbol(
  "disabled-blurting-evaluation-outcome-v18",
);
const requestDigestClaimRuntimeBrand = Symbol(
  "disabled-blurting-request-digest-claim-v18",
);
const digestAuthorityRuntimeBrand = Symbol(
  "disabled-blurting-evaluation-digest-authority-v18",
);

type ParsedBoundEvaluationInput = Readonly<{
  boundary: typeof DISABLED_BLURTING_EVALUATOR_BOUNDARY;
  authenticatedUserId: string;
  observedAt: string;
  transport: DisabledBlurtingEvaluatorTransportV18;
  deliveryReceiptId: string;
  resourceId: string;
  resourceDigest: string;
  evaluationTargets: readonly ParsedEvaluationTargetContract[];
}>;

export type DisabledBlurtingEvaluationServerInputV18 = DeepReadonly<
  ParsedBoundEvaluationInput
> & Readonly<{
  [boundEvaluationInputRuntimeBrand]: true;
}>;

/** Repository-bound server-HMAC output; plain derived bytes have no brand. */
export type DisabledBlurtingServerAnswerHmacV18 = DeepReadonly<
  ParsedAnswerHmacBinding
> & Readonly<{
  [answerHmacRuntimeBrand]: true;
}>;

/** Repository-bound canonical request digest; JSON cannot reproduce its brand. */
export type DisabledBlurtingServerRequestDigestV18 = DeepReadonly<
  ParsedRequestDigestBinding
> & Readonly<{
  [requestDigestRuntimeBrand]: true;
}>;

export type DisabledBlurtingEvaluationOutcomeV18 = DeepReadonly<
  ParsedEvaluationOutcome
> & Readonly<{
  [evaluationOutcomeRuntimeBrand]: true;
}>;
export type DisabledBlurtingEvaluationRequestDigestClaimV18 = DeepReadonly<
  ParsedRequestClaim
> & Readonly<{
  [requestDigestClaimRuntimeBrand]: true;
}>;
export type DisabledBlurtingEvaluationResultDigestClaimV18 = DeepReadonly<
  ParsedResultClaim
>;

/**
 * Opaque, server-only HMAC plus canonical request-digest authority, rebound to
 * one repository-authorized evaluator input. JSON cannot reproduce its brand.
 */
export type DisabledBlurtingEvaluationDigestAuthorityV18 = DeepReadonly<{
  answerHmac: DisabledBlurtingServerAnswerHmacV18;
  requestClaim: DisabledBlurtingEvaluationRequestDigestClaimV18;
  requestDigest: DisabledBlurtingServerRequestDigestV18;
}> & Readonly<{
  [digestAuthorityRuntimeBrand]: true;
}>;

type EvaluationConsistencyInput = Readonly<{
  authenticatedUserId: unknown;
  transportValue: unknown;
  privateResourceValue: unknown;
  loadedResourceRowValue: unknown;
  deliveryReceiptValue: unknown;
  observedAtValue: unknown;
}>;

type EvaluationConsistencyIssue =
  | "invalid_input"
  | "resource_or_transfer_unavailable"
  | "owner_mismatch"
  | "identity_mismatch"
  | "target_order_mismatch"
  | "private_target_contract_invalid";

/**
 * Sole evaluator-input constructor. It requires an opaque runtime capability
 * that this module cannot mint from JSON. Consequently this positive path is
 * intentionally unreachable until a repository implementation supplies the
 * joined-SELECT capability.
 */
export function bindDisabledBlurtingEvaluationServerInputV18(
  transportValue: unknown,
  repositoryCapabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingEvaluationServerInputV18 | null {
  const capability = readDisabledBlurtingRepositoryExecutionCapabilityV18(
    repositoryCapabilityValue,
  );
  const transferDisclosure = toDisabledBlurtingTransferDisclosureV18(
    repositoryCapabilityValue,
  );
  if (!capability || !transferDisclosure || transferDisclosure.stage !== "transfer") {
    return null;
  }
  const context = readConsistentEvaluationContext({
    authenticatedUserId: capability.routeAuthority.userId,
    transportValue,
    privateResourceValue: capability.resource,
    loadedResourceRowValue: capability.loadedResourceRow,
    deliveryReceiptValue: capability.deliveryReceipt,
    observedAtValue: capability.observedAt,
  });
  if (!context.ok) return null;

  return brandBoundEvaluationInput({
    boundary: DISABLED_BLURTING_EVALUATOR_BOUNDARY,
    authenticatedUserId: context.authenticatedUserId,
    observedAt: context.observedAt,
    transport: context.transport,
    deliveryReceiptId: context.deliveryReceipt.deliveryHandle,
    resourceId: context.loadedResourceRow.resourceId,
    resourceDigest: context.loadedResourceRow.resourceDigest,
    evaluationTargets: context.evaluationTargets,
  });
}

/**
 * Sole high-level digest-authority constructor. It accepts only the opaque
 * repository-bound evaluator input, keeps the learner answer transient, and
 * emits only branded answer-HMAC/request-digest material plus the exact claim
 * required by migration 006. It performs no environment lookup or I/O.
 */
export function createDisabledBlurtingEvaluationDigestAuthorityV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  evaluationReceiptIdValue: unknown,
  secretValue: unknown,
): DisabledBlurtingEvaluationDigestAuthorityV18 | null {
  if (!hasBoundEvaluationInputBrand(serverInput)) return null;
  const evaluationReceiptId = DisabledBlurtingCanonicalUuidV18Schema.safeParse(
    evaluationReceiptIdValue,
  );
  if (!evaluationReceiptId.success) return null;

  const identity = requestClaimIdentity(serverInput, evaluationReceiptId.data);
  const derived = deriveDisabledBlurtingEvaluationDigestsV18(
    identity,
    serverInput.transport.learnerAnswer,
    secretValue,
  );
  if (!derived) return null;
  const answerHmac = brandAnswerHmac({ ...derived.answerHmac });
  const requestDigest = brandRequestDigest({
    requestClaim: derived.requestDigest.requestClaim,
    requestDigest: derived.requestDigest.requestDigest,
  });

  const requestClaim = createDisabledBlurtingEvaluationRequestDigestClaimV18(
    serverInput,
    answerHmac,
  );
  if (
    !requestClaim
    || !sameExactRequestClaim(requestDigest.requestClaim, requestClaim)
  ) return null;

  return brandDigestAuthority({
    answerHmac,
    requestClaim,
    requestDigest,
  });
}

/** Constant-time replay verification for a previously issued authority. */
export function verifyDisabledBlurtingEvaluationDigestAuthorityV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  authorityValue: DisabledBlurtingEvaluationDigestAuthorityV18,
  secretValue: unknown,
) {
  if (
    !hasBoundEvaluationInputBrand(serverInput)
    || !hasDigestAuthorityBrand(authorityValue)
    || !hasAnswerHmacBrand(authorityValue.answerHmac)
    || !hasRequestDigestBrand(authorityValue.requestDigest)
    || !hasRequestDigestClaimBrand(authorityValue.requestClaim)
  ) return false;

  const identity = requestClaimIdentity(
    serverInput,
    authorityValue.requestClaim.evaluationReceiptId,
  );
  const derived = deriveDisabledBlurtingEvaluationDigestsV18(
    identity,
    serverInput.transport.learnerAnswer,
    secretValue,
  );
  return sameRequestClaimIdentity(authorityValue.requestClaim, identity)
    && sameExactRequestClaim(
      authorityValue.requestDigest.requestClaim,
      authorityValue.requestClaim,
    )
    && derived !== null
    && disabledBlurtingTimingSafeSha256HexEqualV18(
      authorityValue.answerHmac.answerHmac,
      derived.answerHmac.answerHmac,
    )
    && disabledBlurtingTimingSafeSha256HexEqualV18(
      authorityValue.requestDigest.requestDigest,
      derived.requestDigest.requestDigest,
    );
}

/** Creates the exact request-claim JSON consumed by migration 006. */
export function createDisabledBlurtingEvaluationRequestDigestClaimV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  answerHmac: DisabledBlurtingServerAnswerHmacV18,
): DisabledBlurtingEvaluationRequestDigestClaimV18 | null {
  if (
    !hasBoundEvaluationInputBrand(serverInput)
    || !hasAnswerHmacBrand(answerHmac)
  ) {
    return null;
  }
  const expected = requestClaimIdentity(serverInput, answerHmac.evaluationReceiptId);
  if (!sameRequestClaimIdentity(answerHmac, expected)) return null;

  const parsed = DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse({
    ...expected,
    answerHmac: answerHmac.answerHmac,
    evaluatorVersion: DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
  });
  return parsed.success ? brandRequestDigestClaim(parsed.data) : null;
}

/** Rebinds evaluator output to the exact authorized ordered target vector. */
export function createDisabledBlurtingEvaluationOutcomeV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  resolutionValue: unknown,
  orderedResultsValue: unknown,
): DisabledBlurtingEvaluationOutcomeV18 | null {
  if (!hasBoundEvaluationInputBrand(serverInput)) return null;
  const parsed = DisabledBlurtingEvaluationOutcomeV18Schema.safeParse({
    evaluatorVersion: DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
    requestToken: serverInput.transport.requestToken,
    resolution: resolutionValue,
    orderedResults: orderedResultsValue,
  });
  if (
    !parsed.success
    || !sameOrderedBindings(parsed.data.orderedResults, serverInput.transport.orderedBindings)
  ) {
    return null;
  }
  return brandEvaluationOutcome(parsed.data);
}

/** Unavailability always produces one ordered unverified result per target. */
export function unavailableDisabledBlurtingEvaluationOutcomeV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
): DisabledBlurtingEvaluationOutcomeV18 | null {
  if (!hasBoundEvaluationInputBrand(serverInput)) return null;
  return createDisabledBlurtingEvaluationOutcomeV18(
    serverInput,
    "evaluator_unavailable",
    serverInput.transport.orderedBindings.map((binding) => ({
      targetId: binding.targetId,
      evidenceId: binding.evidenceId,
      result: "unverified" as const,
    })),
  );
}

/** Creates the exact result-claim JSON consumed by migration 006. */
export function createDisabledBlurtingEvaluationResultDigestClaimV18(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  requestClaimValue: DisabledBlurtingEvaluationRequestDigestClaimV18,
  requestDigestValue: DisabledBlurtingServerRequestDigestV18,
  outcomeValue: DisabledBlurtingEvaluationOutcomeV18,
): DisabledBlurtingEvaluationResultDigestClaimV18 | null {
  if (
    !hasBoundEvaluationInputBrand(serverInput)
    || !hasRequestDigestClaimBrand(requestClaimValue)
    || !hasRequestDigestBrand(requestDigestValue)
    || !hasEvaluationOutcomeBrand(outcomeValue)
  ) {
    return null;
  }
  if (
    !sameRequestClaimIdentity(
      requestClaimValue,
      requestClaimIdentity(serverInput, requestClaimValue.evaluationReceiptId),
    )
    || !sameExactRequestClaim(requestDigestValue.requestClaim, requestClaimValue)
    || outcomeValue.requestToken !== serverInput.transport.requestToken
    || !sameOrderedBindings(outcomeValue.orderedResults, serverInput.transport.orderedBindings)
  ) {
    return null;
  }

  const parsed = DisabledBlurtingEvaluationResultDigestClaimV18Schema.safeParse({
    evaluationReceiptId: requestClaimValue.evaluationReceiptId,
    requestDigest: requestDigestValue.requestDigest,
    resolution: outcomeValue.resolution,
    orderedResults: outcomeValue.orderedResults,
  });
  return parsed.success ? deepFreeze(parsed.data) : null;
}

function readConsistentEvaluationContext(
  input: EvaluationConsistencyInput,
): ConsistencyResult {
  const authenticatedUserId = DisabledBlurtingCanonicalUuidV18Schema.safeParse(
    input.authenticatedUserId,
  );
  const observedAt = BoundedInstantSchema.safeParse(input.observedAtValue);
  const transport = readDisabledBlurtingEvaluatorTransportV18(input.transportValue);
  const loadedResourceRow = DisabledBlurtingLoadedResourceRowV18Schema.safeParse(
    input.loadedResourceRowValue,
  );
  const deliveryReceipt = DisabledBlurtingDeliveryReceiptContextV18Schema.safeParse(
    input.deliveryReceiptValue,
  );
  if (
    !authenticatedUserId.success
    || !observedAt.success
    || !transport
    || !loadedResourceRow.success
    || !deliveryReceipt.success
  ) {
    return { ok: false, issue: "invalid_input" };
  }

  const privateResource = readDisabledBlurtingPrivateResourceV18(
    input.privateResourceValue,
    loadedResourceRow.data,
  );
  if (
    !privateResource
    || loadedResourceRow.data.state !== "ready"
    || deliveryReceipt.data.state !== "active"
    || deliveryReceipt.data.disclosureStage !== "transfer"
    || Date.parse(observedAt.data) < Date.parse(deliveryReceipt.data.issuedAt)
    || Date.parse(observedAt.data) < Date.parse(
      deliveryReceipt.data.transferDisclosedAt ?? deliveryReceipt.data.expiresAt,
    )
    || Date.parse(observedAt.data) >= Date.parse(deliveryReceipt.data.expiresAt)
  ) {
    return { ok: false, issue: "resource_or_transfer_unavailable" };
  }
  if (
    authenticatedUserId.data !== loadedResourceRow.data.userId
    || authenticatedUserId.data !== deliveryReceipt.data.userId
  ) {
    return { ok: false, issue: "owner_mismatch" };
  }
  if (
    deliveryReceipt.data.resourceIdentity.resourceId
      !== loadedResourceRow.data.resourceId
    || deliveryReceipt.data.resourceIdentity.resourceFingerprint
      !== loadedResourceRow.data.resourceFingerprint
    || deliveryReceipt.data.resourceIdentity.resourceGeneratedAt
      !== loadedResourceRow.data.resourceGeneratedAt
    || deliveryReceipt.data.resourceIdentity.publicPayloadDigest
      !== loadedResourceRow.data.publicPayloadDigest
    || deliveryReceipt.data.resourceIdentity.resourceDigest
      !== loadedResourceRow.data.resourceDigest
    || !sameRouteIdentity(
      deliveryReceipt.data.routeIdentity,
      loadedResourceRow.data.routeIdentity,
    )
    || !samePublicIdentity(transport.identity, {
      ...loadedResourceRow.data.publicPayload.identity,
      deliveryHandle: deliveryReceipt.data.deliveryHandle,
      runId: deliveryReceipt.data.runId,
      activityIndex: deliveryReceipt.data.activityIndex,
    })
  ) {
    return { ok: false, issue: "identity_mismatch" };
  }
  if (
    !sameOrderedBindings(
      transport.orderedBindings,
      loadedResourceRow.data.publicPayload.orderedTargets,
    )
    || !sameOrderedBindings(transport.orderedBindings, privateResource.session.orderedTargets)
    || !sameOrderedBindings(
      transport.orderedBindings,
      privateResource.orderedEvaluationReferences,
    )
  ) {
    return { ok: false, issue: "target_order_mismatch" };
  }

  const evaluationTargets = privateResource.session.orderedTargets.map((target, index) => ({
    targetId: target.targetId,
    evidenceId: target.evidenceId,
    concept: target.concept,
    transferSuccessCriterion: target.transferSuccessCriterion,
    referenceAnswer: privateResource.orderedEvaluationReferences[index]?.referenceAnswer,
  }));
  const parsedTargets = z.array(EvaluationTargetContractSchema).min(1).max(3)
    .safeParse(evaluationTargets);
  if (!parsedTargets.success) {
    return { ok: false, issue: "private_target_contract_invalid" };
  }

  return {
    ok: true,
    authenticatedUserId: authenticatedUserId.data,
    observedAt: observedAt.data,
    transport,
    loadedResourceRow: loadedResourceRow.data,
    deliveryReceipt: deliveryReceipt.data,
    evaluationTargets: parsedTargets.data,
  };
}

type ConsistencyResult =
  | Readonly<{ ok: false; issue: EvaluationConsistencyIssue }>
  | Readonly<{
    ok: true;
    authenticatedUserId: string;
    observedAt: string;
    transport: DisabledBlurtingEvaluatorTransportV18;
    loadedResourceRow: ParsedLoadedResourceRow;
    deliveryReceipt: ParsedDeliveryReceipt;
    evaluationTargets: ParsedEvaluationTargetContract[];
  }>;

function requestClaimIdentity(
  serverInput: DisabledBlurtingEvaluationServerInputV18,
  evaluationReceiptId: string,
) {
  const identity = serverInput.transport.identity;
  return {
    evaluationReceiptId,
    deliveryReceiptId: serverInput.deliveryReceiptId,
    resourceId: serverInput.resourceId,
    userId: serverInput.authenticatedUserId,
    routeIdentity: {
      planId: identity.planId,
      sessionId: identity.sessionId,
      routeRevisionId: identity.routeRevisionId,
    },
    runId: identity.runId,
    activityIndex: identity.activityIndex,
    requestToken: serverInput.transport.requestToken,
  };
}

function sameRequestClaimIdentity(
  actual: Omit<ParsedRequestClaim, "answerHmac" | "evaluatorVersion">,
  expected: ReturnType<typeof requestClaimIdentity>,
) {
  return actual.evaluationReceiptId === expected.evaluationReceiptId
    && actual.deliveryReceiptId === expected.deliveryReceiptId
    && actual.resourceId === expected.resourceId
    && actual.userId === expected.userId
    && sameRouteIdentity(actual.routeIdentity, expected.routeIdentity)
    && actual.runId === expected.runId
    && actual.activityIndex === expected.activityIndex
    && actual.requestToken === expected.requestToken;
}

function requireExactFinalCheckEvidenceId(
  binding: { targetId: string; evidenceId: string },
  context: z.RefinementCtx,
) {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A Blurting evaluation target requires its exact final-check evidence ID.",
    });
  }
}

function reportDuplicateBindings(
  bindings: readonly { targetId: string; evidenceId: string }[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(bindings.map((binding) => binding.targetId)).size !== bindings.length) {
    context.addIssue({ code: "custom", path, message: "Target IDs must be unique." });
  }
  if (new Set(bindings.map((binding) => binding.evidenceId)).size !== bindings.length) {
    context.addIssue({ code: "custom", path, message: "Evidence IDs must be unique." });
  }
}

function samePublicIdentity(
  left: DisabledBlurtingEvaluatorTransportV18["identity"],
  right: DisabledBlurtingEvaluatorTransportV18["identity"],
) {
  return left.planId === right.planId
    && left.sessionId === right.sessionId
    && left.routeRevisionId === right.routeRevisionId
    && left.resourceFingerprint === right.resourceFingerprint
    && left.resourceGeneratedAt === right.resourceGeneratedAt
    && left.deliveryHandle === right.deliveryHandle
    && left.runId === right.runId
    && left.activityIndex === right.activityIndex;
}

function sameRouteIdentity(
  left: RouteIdentity,
  right: RouteIdentity,
) {
  return left.planId === right.planId
    && left.sessionId === right.sessionId
    && left.routeRevisionId === right.routeRevisionId;
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

function brandBoundEvaluationInput(
  value: ParsedBoundEvaluationInput,
): DisabledBlurtingEvaluationServerInputV18 {
  Object.defineProperty(value, boundEvaluationInputRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingEvaluationServerInputV18;
}

function brandAnswerHmac(
  value: ParsedAnswerHmacBinding,
): DisabledBlurtingServerAnswerHmacV18 {
  Object.defineProperty(value, answerHmacRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingServerAnswerHmacV18;
}

function brandRequestDigest(
  value: ParsedRequestDigestBinding,
): DisabledBlurtingServerRequestDigestV18 {
  Object.defineProperty(value, requestDigestRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingServerRequestDigestV18;
}

function brandEvaluationOutcome(
  value: ParsedEvaluationOutcome,
): DisabledBlurtingEvaluationOutcomeV18 {
  Object.defineProperty(value, evaluationOutcomeRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingEvaluationOutcomeV18;
}

function brandRequestDigestClaim(
  value: ParsedRequestClaim,
): DisabledBlurtingEvaluationRequestDigestClaimV18 {
  Object.defineProperty(value, requestDigestClaimRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingEvaluationRequestDigestClaimV18;
}

function brandDigestAuthority(
  value: Omit<
    DisabledBlurtingEvaluationDigestAuthorityV18,
    typeof digestAuthorityRuntimeBrand
  >,
): DisabledBlurtingEvaluationDigestAuthorityV18 {
  Object.defineProperty(value, digestAuthorityRuntimeBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value) as DisabledBlurtingEvaluationDigestAuthorityV18;
}

function hasBoundEvaluationInputBrand(
  value: unknown,
): value is DisabledBlurtingEvaluationServerInputV18 {
  return hasRuntimeBrand(value, boundEvaluationInputRuntimeBrand);
}

function hasAnswerHmacBrand(
  value: unknown,
): value is DisabledBlurtingServerAnswerHmacV18 {
  return hasRuntimeBrand(value, answerHmacRuntimeBrand)
    && DisabledBlurtingServerAnswerHmacBindingV18Schema.safeParse(value).success;
}

function hasRequestDigestBrand(
  value: unknown,
): value is DisabledBlurtingServerRequestDigestV18 {
  return hasRuntimeBrand(value, requestDigestRuntimeBrand)
    && DisabledBlurtingServerRequestDigestBindingV18Schema.safeParse(value).success;
}

function hasEvaluationOutcomeBrand(
  value: unknown,
): value is DisabledBlurtingEvaluationOutcomeV18 {
  return hasRuntimeBrand(value, evaluationOutcomeRuntimeBrand);
}

function hasRequestDigestClaimBrand(
  value: unknown,
): value is DisabledBlurtingEvaluationRequestDigestClaimV18 {
  return hasRuntimeBrand(value, requestDigestClaimRuntimeBrand);
}

function hasDigestAuthorityBrand(
  value: unknown,
): value is DisabledBlurtingEvaluationDigestAuthorityV18 {
  return hasRuntimeBrand(value, digestAuthorityRuntimeBrand);
}

function sameExactRequestClaim(
  left: ParsedRequestClaim,
  right: ParsedRequestClaim,
) {
  return sameRequestClaimIdentity(left, right)
    && left.answerHmac === right.answerHmac
    && left.evaluatorVersion === right.evaluatorVersion;
}

function hasRuntimeBrand(value: unknown, brand: symbol) {
  return Boolean(
    value
    && typeof value === "object"
    && brand in value
    && (value as Record<PropertyKey, unknown>)[brand] === true,
  );
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

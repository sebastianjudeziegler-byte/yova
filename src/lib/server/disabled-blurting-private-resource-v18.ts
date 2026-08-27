import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  readDisabledBlurtingVerifiedCompletionContextV18,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  DisabledCachedBlurtingSessionV18Schema,
} from "@/lib/session-generation/disabled-blurting-session-v18";
import {
  DisabledBlurtingCanonicalInstantV18Schema,
  disabledBlurtingCanonicalTextV18Schema,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  DISABLED_BLURTING_PUBLIC_BOUNDARY,
  DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
  DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION,
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  DisabledBlurtingCompareDisclosureV18Schema,
  DisabledBlurtingCanonicalUuidV18Schema,
  DisabledBlurtingCompleteDisclosureV18Schema,
  DisabledBlurtingPublicBootstrapV18Schema,
  DisabledBlurtingPublicResourceTemplateV18Schema,
  DisabledBlurtingRepairDisclosureV18Schema,
  DisabledBlurtingTransferDisclosureV18Schema,
  projectDisabledBlurtingSafeDiagnosticV18,
  type DisabledBlurtingPublicDeliveryV18,
  type DisabledBlurtingPublicResourceTemplateV18,
  type DisabledBlurtingSafeDiagnosticV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

export const DISABLED_BLURTING_SERVER_RESOURCE_VERSION =
  "blurting_server_resource_v18" as const;
export const DISABLED_BLURTING_SOURCE_AUTHORITY_VERSION =
  "blurting_source_authority_v1" as const;
export const DISABLED_BLURTING_PRIVATE_RESOURCE_BOUNDARY =
  "disabled_server_private_resource_only" as const;

/** Canonical domain separators reserved for a future dedicated resource store. */
export const DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS = Object.freeze({
  publicPayload: "yova.blurting.public.v18|",
  serverPayload: "yova.blurting.server.v18|",
  sourceSnapshot: "yova.blurting.source_snapshot.v1|",
  sourceChunk: "yova.blurting.source_chunk.v1|",
  resource: "yova.blurting.resource.v18|",
  deliveryReceipt: "yova.blurting.delivery_receipt.v18|",
} as const);

/** Pinned cross-runtime canonical JSON helper for SQL/TypeScript test vectors. */
export function disabledBlurtingCanonicalJsonV18(value: unknown) {
  return canonicalJson(value);
}

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const BoundedInstantSchema = DisabledBlurtingCanonicalInstantV18Schema;
const DISCLOSURE_STAGES = [
  "recall",
  "compare",
  "repair",
  "transfer",
  "complete",
] as const;
const DisclosureStageSchema = z.enum(DISCLOSURE_STAGES);

const CanonicalDigestsSchema = z.object({
  publicPayloadDigest: Sha256HexSchema,
  serverPayloadDigest: Sha256HexSchema,
  sourceSnapshotDigest: Sha256HexSchema,
  resourceDigest: Sha256HexSchema,
}).strict();

const SourceTypeSchema = z.enum(["user_materials", "trusted_external_source"]);
const SourceIdSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 200,
});
const SourceVersionIdSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 200,
});
const ChunkIdSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 200,
});
const SourceLabelSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 180,
});
const LocationLabelSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 120,
});
const CanonicalSourceTextSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 7_000,
});
const DisplayLabelSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 2,
  maxCodePoints: 120,
});
const EvaluationReferenceAnswerSchema = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: 1,
  maxCodePoints: 1_200,
});

const SourceManifestEntrySchema = z.object({
  sourceId: SourceIdSchema,
  sourceVersionId: SourceVersionIdSchema,
  chunkId: ChunkIdSchema,
  sourceLabel: SourceLabelSchema,
  locationLabel: LocationLabelSchema,
  contentDigest: Sha256HexSchema,
  canonicalText: CanonicalSourceTextSchema,
}).strict().superRefine((entry, context) => {
  if (sourceChunkDigest(entry.canonicalText) !== entry.contentDigest) {
    context.addIssue({
      code: "custom",
      path: ["contentDigest"],
      message: "Each source chunk digest must bind its exact canonical text.",
    });
  }
});

const SourceSnapshotSchema = z.object({
  sourceSnapshotId: DisabledBlurtingCanonicalUuidV18Schema,
  sourceType: SourceTypeSchema,
  requiredSourceIds: z.array(SourceIdSchema).min(1).max(20),
  manifest: z.array(SourceManifestEntrySchema).min(1).max(24),
}).strict().superRefine((snapshot, context) => {
  reportSourceSnapshotIssues(snapshot, context);
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 196_608) {
    context.addIssue({
      code: "custom",
      message: "The canonical source snapshot exceeds the server-side byte cap.",
    });
  }
});

const SourceAuthoritySchema = z.object({
  version: z.literal(DISABLED_BLURTING_SOURCE_AUTHORITY_VERSION),
  state: z.literal("server_bound"),
  sourceSnapshotId: DisabledBlurtingCanonicalUuidV18Schema,
  sourceType: SourceTypeSchema,
  requiredSourceIds: z.array(SourceIdSchema).min(1).max(20),
  sourceSnapshot: SourceSnapshotSchema,
}).strict().superRefine((authority, context) => {
  if (
    authority.sourceSnapshotId !== authority.sourceSnapshot.sourceSnapshotId
    || authority.sourceType !== authority.sourceSnapshot.sourceType
    || !sameStrings(
      authority.requiredSourceIds,
      authority.sourceSnapshot.requiredSourceIds,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceSnapshot"],
      message: "Source authority and its canonical snapshot must have exact identity parity.",
    });
  }
});

const PrivatePublicTargetSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  displayLabel: DisplayLabelSchema,
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const PrivateEvaluationReferenceSchema = z.object({
  targetId: DisabledBlurtingCanonicalUuidV18Schema,
  evidenceId: z.string().min(1).max(200),
  referenceAnswer: EvaluationReferenceAnswerSchema,
}).strict().superRefine(requireExactFinalCheckEvidenceId);

const DeliveryRouteIdentitySchema = z.object({
  planId: DisabledBlurtingCanonicalUuidV18Schema,
  sessionId: DisabledBlurtingCanonicalUuidV18Schema,
  routeRevisionId: DisabledBlurtingCanonicalUuidV18Schema,
}).strict();

const DeliveryResourceIdentitySchema = z.object({
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  resourceFingerprint: z.string().regex(/^sr1:[0-9a-f]{16}$/),
  resourceGeneratedAt: BoundedInstantSchema,
  publicPayloadDigest: Sha256HexSchema,
  resourceDigest: Sha256HexSchema,
}).strict();

/** Per-run identity loaded by the server separately from the reusable resource. */
export const DisabledBlurtingDeliveryReceiptContextV18Schema = z.object({
  authority: z.literal("blurting_delivery_receipt_v18"),
  state: z.enum(["active", "completed", "revoked"]),
  deliveryHandle: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  runId: DisabledBlurtingCanonicalUuidV18Schema,
  activityIndex: z.number().int().min(0).max(23),
  routeIdentity: DeliveryRouteIdentitySchema,
  resourceIdentity: DeliveryResourceIdentitySchema,
  receiptDigest: Sha256HexSchema,
  issuedAt: BoundedInstantSchema,
  lastSeenAt: BoundedInstantSchema,
  expiresAt: BoundedInstantSchema,
  disclosureStage: DisclosureStageSchema,
  recallDisclosedAt: BoundedInstantSchema,
  compareDisclosedAt: BoundedInstantSchema.nullable(),
  repairDisclosedAt: BoundedInstantSchema.nullable(),
  transferDisclosedAt: BoundedInstantSchema.nullable(),
  completeDisclosedAt: BoundedInstantSchema.nullable(),
  closedAt: BoundedInstantSchema.nullable(),
}).strict().superRefine((receipt, context) => {
  if (Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt) !== 691_200_000) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "A delivery receipt expires exactly eight days after issuance.",
    });
  }
  reportDisclosureStageIssues(receipt, context);
  const expectedReceiptDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.deliveryReceipt,
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
  if (receipt.receiptDigest !== expectedReceiptDigest) {
    context.addIssue({
      code: "custom",
      path: ["receiptDigest"],
      message: "The delivery receipt digest must match the exact SQL 006 claim.",
    });
  }
});

const PrivateResourceCoreShape = {
  serverContractVersion: z.literal(DISABLED_BLURTING_SERVER_RESOURCE_VERSION),
  boundaryStatus: z.literal(DISABLED_BLURTING_PRIVATE_RESOURCE_BOUNDARY),
  issuanceState: z.literal("disabled"),
  sourceAuthority: SourceAuthoritySchema,
  orderedPublicTargets: z.array(PrivatePublicTargetSchema).min(1).max(3),
  orderedEvaluationReferences: z.array(PrivateEvaluationReferenceSchema)
    .min(1)
    .max(3),
  session: DisabledCachedBlurtingSessionV18Schema,
} as const;

const DisabledBlurtingPrivateResourceCoreV18Schema = z.object(
  PrivateResourceCoreShape,
).strict().superRefine(reportPrivateResourceIssues);

/**
 * Complete server-only resource. The old full V18 shape is nested here rather
 * than imported by browser code, while source authority, canonical digests,
 * per-target evaluator references stay on the private side of the split.
 * Run/activity identity belongs only to the separate delivery receipt above.
 */
export const DisabledBlurtingPrivateResourceV18Schema = z.object({
  ...PrivateResourceCoreShape,
  canonicalDigests: CanonicalDigestsSchema,
}).strict().superRefine(reportPrivateResourceIssues);

function reportPrivateResourceIssues(
  resource: z.infer<typeof DisabledBlurtingPrivateResourceCoreV18Schema>,
  context: z.RefinementCtx,
) {
  const targets = resource.session.orderedTargets;
  if (!sameOrderedBindings(targets, resource.orderedPublicTargets)) {
    context.addIssue({
      code: "custom",
      path: ["orderedPublicTargets"],
      message: "Public labels must match the exact resource target order.",
    });
  }
  if (!sameOrderedBindings(targets, resource.orderedEvaluationReferences)) {
    context.addIssue({
      code: "custom",
      path: ["orderedEvaluationReferences"],
      message: "Private evaluator references must match the exact resource target order.",
    });
  }
}

/**
 * Identity of the DB row the server has already loaded. `resourceId` is a
 * lookup precondition, not digest input; the future repository must load the
 * resource value from this exact row before calling the reader below.
 */
const ResourceRowIdentityShape = {
  resourceId: DisabledBlurtingCanonicalUuidV18Schema,
  userId: DisabledBlurtingCanonicalUuidV18Schema,
  routeIdentity: DeliveryRouteIdentitySchema,
  resourceFingerprint: z.string().regex(/^sr1:[0-9a-f]{16}$/),
  resourceGeneratedAt: BoundedInstantSchema,
} as const;

export const DisabledBlurtingResourceSealIdentityV18Schema = z.object({
  authority: z.literal("server_owned_blurting_resource_identity_v18"),
  ...ResourceRowIdentityShape,
}).strict();

export const DisabledBlurtingLoadedResourceRowV18Schema = z.object({
  authority: z.literal("server_loaded_blurting_resource_row_v18"),
  ...ResourceRowIdentityShape,
  state: z.enum(["ready", "superseded", "retired"]),
  publicPayloadDigest: Sha256HexSchema,
  resourceDigest: Sha256HexSchema,
  publicPayload: DisabledBlurtingPublicResourceTemplateV18Schema,
}).strict();

const DisabledBlurtingCurrentRouteAuthorityV18Schema = z.object({
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
      message: "The plan-session pointer must select this exact committed route.",
    });
  }
});

/**
 * Reserved future repository join. Structural parsing grants no authority;
 * there is deliberately no raw-to-brand issuer while V18 persistence is off.
 */
export const DisabledBlurtingRepositoryExecutionCapabilityV18Schema = z.object({
  authority: z.literal("server_loaded_blurting_execution_capability_v18"),
  observedAt: BoundedInstantSchema,
  routeAuthority: DisabledBlurtingCurrentRouteAuthorityV18Schema,
  resource: DisabledBlurtingPrivateResourceV18Schema,
  loadedResourceRow: DisabledBlurtingLoadedResourceRowV18Schema,
  deliveryReceipt: DisabledBlurtingDeliveryReceiptContextV18Schema,
}).strict().superRefine((capability, context) => {
  const route = capability.routeAuthority;
  const resource = capability.resource;
  const row = capability.loadedResourceRow;
  const delivery = capability.deliveryReceipt;
  const sessionRoute = resource.session.routeIdentity;
  const identityMatches = route.userId === row.userId
    && route.planId === row.routeIdentity.planId
    && route.sessionId === row.routeIdentity.sessionId
    && route.routeRevisionId === row.routeIdentity.routeRevisionId
    && sessionRoute.planId === route.planId
    && sessionRoute.sessionId === route.sessionId
    && sessionRoute.routeRevisionId === route.routeRevisionId
    && delivery.userId === route.userId
    && sameRouteIdentity(delivery.routeIdentity, row.routeIdentity)
    && delivery.resourceIdentity.resourceId === row.resourceId
    && delivery.resourceIdentity.resourceFingerprint === row.resourceFingerprint
    && delivery.resourceIdentity.resourceGeneratedAt === row.resourceGeneratedAt
    && delivery.resourceIdentity.publicPayloadDigest === row.publicPayloadDigest
    && delivery.resourceIdentity.resourceDigest === row.resourceDigest;
  if (!identityMatches || row.state !== "ready") {
    context.addIssue({
      code: "custom",
      path: ["routeAuthority"],
      message: "The capability must join one current route, ready resource, and delivery.",
    });
  }
  const observedAt = Date.parse(capability.observedAt);
  const stageObservedAt = deliveryStageObservedAt(delivery);
  if (
    stageObservedAt === null
    || observedAt < Date.parse(delivery.issuedAt)
    || observedAt < Date.parse(delivery.lastSeenAt)
    || observedAt < Date.parse(stageObservedAt)
    || observedAt >= Date.parse(delivery.expiresAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["observedAt"],
      message: "Repository time must be live and no earlier than the authorized stage.",
    });
  }
});

type ParsedPrivateResource = z.infer<
  typeof DisabledBlurtingPrivateResourceV18Schema
>;
type ParsedPrivateResourceCore = z.infer<
  typeof DisabledBlurtingPrivateResourceCoreV18Schema
>;
type ParsedLoadedResourceRow = z.infer<
  typeof DisabledBlurtingLoadedResourceRowV18Schema
>;
type ParsedDeliveryReceipt = z.infer<
  typeof DisabledBlurtingDeliveryReceiptContextV18Schema
>;
type ParsedRepositoryExecutionCapability = z.infer<
  typeof DisabledBlurtingRepositoryExecutionCapabilityV18Schema
>;
type ParsedResourceSealIdentity = z.infer<
  typeof DisabledBlurtingResourceSealIdentityV18Schema
>;

const repositoryExecutionCapabilityRuntimeBrand = Symbol(
  "disabled-blurting-repository-execution-capability-v18",
);

export type DisabledBlurtingPrivateResourceV18 = DeepReadonly<
  ParsedPrivateResource
>;
export type DisabledBlurtingCanonicalResourceV18 = Readonly<{
  publicPayload: DisabledBlurtingPublicResourceTemplateV18;
  serverPayload: DisabledBlurtingPrivateResourceV18;
}>;
export type DisabledBlurtingRepositoryExecutionCapabilityV18 = DeepReadonly<
  ParsedRepositoryExecutionCapability
> & Readonly<{
  [repositoryExecutionCapabilityRuntimeBrand]: true;
}>;

/**
 * Canonically seals the private resource against an already loaded resource
 * row identity. This is a pure disabled builder; it writes no row and grants
 * no delivery authority.
 */
export function createDisabledBlurtingPrivateResourceV18(
  coreValue: unknown,
  resourceSealIdentityValue: unknown,
): DisabledBlurtingPrivateResourceV18 | null {
  return createDisabledBlurtingCanonicalResourceV18(
    coreValue,
    resourceSealIdentityValue,
  )?.serverPayload ?? null;
}

/** Builds the exact separate public_payload/server_payload pair stored by 006. */
export function createDisabledBlurtingCanonicalResourceV18(
  coreValue: unknown,
  resourceSealIdentityValue: unknown,
): DisabledBlurtingCanonicalResourceV18 | null {
  const core = DisabledBlurtingPrivateResourceCoreV18Schema.safeParse(coreValue);
  const row = DisabledBlurtingResourceSealIdentityV18Schema.safeParse(
    resourceSealIdentityValue,
  );
  if (!core.success || !row.success || !resourceRowMatchesCore(row.data, core.data)) {
    return null;
  }

  const runtime = core.data.session.phaseEnvelopes[0].runtime;
  const publicTemplate = DisabledBlurtingPublicResourceTemplateV18Schema.safeParse({
    ...publicResourceEnvelope(core.data, row.data),
    boundaryStatus: "disabled_public_resource_template_only" as const,
    initialRecall: {
      sourceClosedReminder: runtime.sourceClosedReminder,
      prompt: runtime.prompts[0]?.prompt,
    },
  });
  if (!publicTemplate.success) return null;

  const publicPayloadDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.publicPayload,
    publicTemplate.data,
  );
  const serverPayloadDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.serverPayload,
    core.data,
  );
  const sourceSnapshotDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.sourceSnapshot,
    core.data.sourceAuthority.sourceSnapshot,
  );
  const resourceDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.resource,
    {
      userId: row.data.userId,
      routeIdentity: row.data.routeIdentity,
      resourceFingerprint: row.data.resourceFingerprint,
      resourceGeneratedAt: row.data.resourceGeneratedAt,
      publicPayloadDigest,
      serverPayloadDigest,
      sourceSnapshotDigest,
    },
  );
  const parsed = DisabledBlurtingPrivateResourceV18Schema.safeParse({
    ...core.data,
    canonicalDigests: {
      publicPayloadDigest,
      serverPayloadDigest,
      sourceSnapshotDigest,
      resourceDigest,
    },
  });
  return parsed.success ? deepFreeze({
    publicPayload: publicTemplate.data,
    serverPayload: parsed.data,
  }) : null;
}

export function readDisabledBlurtingPrivateResourceV18(
  value: unknown,
  loadedResourceRowValue: unknown,
): DisabledBlurtingPrivateResourceV18 | null {
  const parsed = DisabledBlurtingPrivateResourceV18Schema.safeParse(value);
  const loadedRow = DisabledBlurtingLoadedResourceRowV18Schema.safeParse(
    loadedResourceRowValue,
  );
  if (!parsed.success || !loadedRow.success || loadedRow.data.state !== "ready") {
    return null;
  }
  const { canonicalDigests, ...core } = parsed.data;
  const expected = createDisabledBlurtingCanonicalResourceV18(
    core,
    {
      authority: "server_owned_blurting_resource_identity_v18" as const,
      resourceId: loadedRow.data.resourceId,
      userId: loadedRow.data.userId,
      routeIdentity: loadedRow.data.routeIdentity,
      resourceFingerprint: loadedRow.data.resourceFingerprint,
      resourceGeneratedAt: loadedRow.data.resourceGeneratedAt,
    },
  );
  return expected
    && sameCanonicalDigests(
      expected.serverPayload.canonicalDigests,
      canonicalDigests,
    )
    && loadedRow.data.resourceDigest
      === expected.serverPayload.canonicalDigests.resourceDigest
    && loadedRow.data.publicPayloadDigest
      === expected.serverPayload.canonicalDigests.publicPayloadDigest
    && canonicalJson(loadedRow.data.publicPayload)
      === canonicalJson(expected.publicPayload)
    ? expected.serverPayload
    : null;
}

export function readDisabledBlurtingRepositoryExecutionCapabilityV18(
  value: unknown,
) : DisabledBlurtingRepositoryExecutionCapabilityV18 | null {
  if (!hasRepositoryExecutionCapabilityRuntimeBrand(value)) return null;
  const parsed = DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(value);
  if (!parsed.success) return null;
  const authoritativeResource = readDisabledBlurtingPrivateResourceV18(
    value.resource,
    value.loadedResourceRow,
  );
  if (!authoritativeResource) return null;
  return parsed.success ? value : null;
}

export function toDisabledBlurtingPublicResourceTemplateV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingPublicResourceTemplateV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "recall",
  );
  if (!bound) return null;
  return deepFreeze(bound.loadedRow.publicPayload);
}

export function toDisabledBlurtingPublicBootstrapV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingPublicDeliveryV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "recall",
  );
  if (!bound) return null;
  const runtime = bound.resource.session.phaseEnvelopes[0].runtime;

  return readPublicStage(DisabledBlurtingPublicBootstrapV18Schema, {
    ...publicDeliveryEnvelope(bound.resource, bound.delivery),
    stage: "recall" as const,
    sourceClosedReminder: runtime.sourceClosedReminder,
    prompt: runtime.prompts[0]?.prompt,
  });
}

export function toDisabledBlurtingCompareDisclosureV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingPublicDeliveryV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "compare",
  );
  if (!bound) return null;
  const runtime = bound.resource.session.phaseEnvelopes[0].runtime;

  return readPublicStage(DisabledBlurtingCompareDisclosureV18Schema, {
    ...publicDeliveryEnvelope(bound.resource, bound.delivery),
    stage: "compare" as const,
    comparisonInstructions: runtime.comparisonInstructions,
    savedSourceAnswer: runtime.prompts[0]?.expectedAnswer,
    gapChecklist: runtime.gapChecklist,
  });
}

export function toDisabledBlurtingRepairDisclosureV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingPublicDeliveryV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "repair",
  );
  if (!bound) return null;
  const runtime = bound.resource.session.phaseEnvelopes[0].runtime;

  return readPublicStage(DisabledBlurtingRepairDisclosureV18Schema, {
    ...publicDeliveryEnvelope(bound.resource, bound.delivery),
    stage: "repair" as const,
    sourceClosedReminder: runtime.sourceClosedReminder,
    correctionInstruction: runtime.correctionInstruction,
  });
}

export function toDisabledBlurtingTransferDisclosureV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingPublicDeliveryV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "transfer",
  );
  if (!bound) return null;
  const runtime = bound.resource.session.phaseEnvelopes[0].runtime;

  return readPublicStage(DisabledBlurtingTransferDisclosureV18Schema, {
    ...publicDeliveryEnvelope(bound.resource, bound.delivery),
    stage: "transfer" as const,
    sourceClosedReminder: runtime.transferPrompt.sourceClosedReminder,
    prompt: runtime.transferPrompt.prompt,
    answerConstraints: {
      minCharacters: DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
      maxCharacters: DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
    },
  });
}

/**
 * The only complete-stage projector. It requires the full server-private
 * resource plus an exactly rebound, server-loaded evaluation receipt context;
 * bare results and public completion DTOs fail closed.
 */
export function toDisabledBlurtingCompleteDisclosureV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
  verifiedCompletionValue: unknown,
): DisabledBlurtingPublicDeliveryV18 | null {
  const bound = readBoundResourceDelivery(
    capabilityValue,
    "complete",
  );
  if (!bound) return null;
  const envelope = publicDeliveryEnvelope(bound.resource, bound.delivery);
  const verification = readDisabledBlurtingVerifiedCompletionContextV18(
    verifiedCompletionValue,
    {
      userId: bound.delivery.userId,
      identity: envelope.identity,
      resourceIdentity: {
        resourceId: bound.loadedRow.resourceId,
        resourceFingerprint: bound.loadedRow.resourceFingerprint,
        resourceGeneratedAt: bound.loadedRow.resourceGeneratedAt,
        resourceDigest: bound.loadedRow.resourceDigest,
      },
      orderedBindings: envelope.orderedTargets.map(({ targetId, evidenceId }) => ({
        targetId,
        evidenceId,
      })),
    },
  );
  if (!verification) return null;

  return readPublicStage(DisabledBlurtingCompleteDisclosureV18Schema, {
    ...envelope,
    stage: "complete" as const,
    orderedReferences: bound.resource.orderedEvaluationReferences.map((reference) => ({
      targetId: reference.targetId,
      evidenceId: reference.evidenceId,
      referenceAnswer: reference.referenceAnswer,
    })),
    completion: {
      evaluationReceiptHandle: verification.receipt.evaluationReceiptHandle,
      requestToken: verification.requestToken,
      evaluatorVersion: DISABLED_BLURTING_PUBLIC_EVALUATOR_VERSION,
      resolution: verification.resolution,
      orderedResults: verification.orderedResults.map((result) => ({ ...result })),
    },
  });
}

export function projectDisabledBlurtingPrivateResourceDiagnosticV18(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
): DisabledBlurtingSafeDiagnosticV18 | null {
  const bootstrap = toDisabledBlurtingPublicBootstrapV18(
    capabilityValue,
  );
  return bootstrap ? projectDisabledBlurtingSafeDiagnosticV18(bootstrap) : null;
}

function publicResourceEnvelope(
  resource: ParsedPrivateResourceCore,
  resourceIdentity: {
    resourceFingerprint: string;
    resourceGeneratedAt: string;
  },
) {
  const session = resource.session;
  return {
    schemaVersion: DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION,
    identity: {
      planId: session.routeIdentity.planId,
      sessionId: session.routeIdentity.sessionId,
      routeRevisionId: session.routeIdentity.routeRevisionId,
      resourceFingerprint: resourceIdentity.resourceFingerprint,
      resourceGeneratedAt: resourceIdentity.resourceGeneratedAt,
    },
    orderedTargets: resource.orderedPublicTargets.map((target) => ({
      targetId: target.targetId,
      evidenceId: target.evidenceId,
      displayLabel: target.displayLabel,
    })),
    phaseMetadata: session.phaseEnvelopes.map((phase) => ({
      phaseId: phase.phaseId,
      methodPhase: phase.methodPhase,
      activeMinutes: phase.activeMinutes,
      targetIds: [...phase.targetIds],
    })),
    gapCount: session.phaseEnvelopes[0].runtime.gapChecklist.length,
  };
}

function publicDeliveryEnvelope(
  resource: ParsedPrivateResource,
  delivery: ParsedDeliveryReceipt,
) {
  const envelope = publicResourceEnvelope(resource, delivery.resourceIdentity);
  return {
    ...envelope,
    boundaryStatus: DISABLED_BLURTING_PUBLIC_BOUNDARY,
    identity: {
      ...envelope.identity,
      deliveryHandle: delivery.deliveryHandle,
      runId: delivery.runId,
      activityIndex: delivery.activityIndex,
    },
  };
}

function readBoundResourceDelivery(
  capabilityValue: DisabledBlurtingRepositoryExecutionCapabilityV18,
  expectedDisclosureStage: ParsedDeliveryReceipt["disclosureStage"],
) {
  if (!hasRepositoryExecutionCapabilityRuntimeBrand(capabilityValue)) {
    return null;
  }
  const capability = DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
    capabilityValue,
  );
  if (!capability.success) return null;
  const delivery = capability.data.deliveryReceipt;
  const loadedRow = capability.data.loadedResourceRow;
  const authoritativeResource = readDisabledBlurtingPrivateResourceV18(
    capability.data.resource,
    loadedRow,
  );
  if (!authoritativeResource) return null;
  const resource = DisabledBlurtingPrivateResourceV18Schema.parse(
    authoritativeResource,
  );
  if (
    delivery.state === "revoked"
    || delivery.disclosureStage !== expectedDisclosureStage
    || loadedRow.state !== "ready"
    || loadedRow.resourceDigest !== resource.canonicalDigests.resourceDigest
    || loadedRow.publicPayloadDigest !== resource.canonicalDigests.publicPayloadDigest
  ) {
    return null;
  }
  return { resource, loadedRow, delivery } as const;
}

function hasRepositoryExecutionCapabilityRuntimeBrand(
  value: unknown,
): value is DisabledBlurtingRepositoryExecutionCapabilityV18 {
  return Boolean(
    value
    && typeof value === "object"
    && repositoryExecutionCapabilityRuntimeBrand in value
    && (value as Record<PropertyKey, unknown>)[
      repositoryExecutionCapabilityRuntimeBrand
    ] === true,
  );
}

function readPublicStage<T>(
  schema: z.ZodType<T>,
  value: unknown,
): DisabledBlurtingPublicDeliveryV18 | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  return deepFreeze(parsed.data) as DisabledBlurtingPublicDeliveryV18;
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

function requireExactFinalCheckEvidenceId(
  binding: { targetId: string; evidenceId: string },
  context: z.RefinementCtx,
) {
  if (binding.evidenceId !== blurtingFinalCheckEvidenceId(binding.targetId)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceId"],
      message: "A private Blurting binding requires its exact final-check evidence ID.",
    });
  }
}

function deliveryStageObservedAt(receipt: ParsedDeliveryReceipt) {
  return {
    recall: receipt.recallDisclosedAt,
    compare: receipt.compareDisclosedAt,
    repair: receipt.repairDisclosedAt,
    transfer: receipt.transferDisclosedAt,
    complete: receipt.completeDisclosedAt,
  }[receipt.disclosureStage];
}

function reportDisclosureStageIssues(
  receipt: {
    state: "active" | "completed" | "revoked";
    issuedAt: string;
    expiresAt: string;
    lastSeenAt: string;
    disclosureStage: typeof DISCLOSURE_STAGES[number];
    recallDisclosedAt: string;
    compareDisclosedAt: string | null;
    repairDisclosedAt: string | null;
    transferDisclosedAt: string | null;
    completeDisclosedAt: string | null;
    closedAt: string | null;
  },
  context: z.RefinementCtx,
) {
  const stageIndex = DISCLOSURE_STAGES.indexOf(receipt.disclosureStage);
  const timestamps = [
    receipt.recallDisclosedAt,
    receipt.compareDisclosedAt,
    receipt.repairDisclosedAt,
    receipt.transferDisclosedAt,
    receipt.completeDisclosedAt,
  ] as const;
  let previous = Date.parse(receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);

  timestamps.forEach((timestamp, index) => {
    const path = [`${DISCLOSURE_STAGES[index]}DisclosedAt`];
    if (index <= stageIndex && timestamp === null) {
      context.addIssue({
        code: "custom",
        path,
        message: "The delivery disclosure timestamp prefix must be complete.",
      });
      return;
    }
    if (index > stageIndex && timestamp !== null) {
      context.addIssue({
        code: "custom",
        path,
        message: "A later disclosure timestamp cannot precede stage authorization.",
      });
      return;
    }
    if (timestamp !== null) {
      const current = Date.parse(timestamp);
      if (current < previous || current >= expiresAt) {
        context.addIssue({
          code: "custom",
          path,
          message: "Disclosure timestamps must be monotonic inside the receipt lifetime.",
        });
      }
      previous = current;
    }
  });

  if (
    receipt.state !== "revoked"
    && (
      (receipt.disclosureStage === "complete" && receipt.state !== "completed")
      || (receipt.disclosureStage !== "complete" && receipt.state !== "active")
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Delivery state must match the exact authorized disclosure stage.",
    });
  }

  const currentDisclosedAt = timestamps[stageIndex];
  const lastSeenAt = Date.parse(receipt.lastSeenAt);
  if (
    currentDisclosedAt === null
    || lastSeenAt < Date.parse(currentDisclosedAt)
    || lastSeenAt >= expiresAt
  ) {
    context.addIssue({
      code: "custom",
      path: ["lastSeenAt"],
      message: "Last-seen time must follow the authorized stage inside the lifetime.",
    });
  }

  if (
    (receipt.state === "active" && receipt.closedAt !== null)
    || (
      receipt.state === "completed"
      && receipt.closedAt !== receipt.completeDisclosedAt
    )
    || (
      receipt.state === "revoked"
      && (
        receipt.closedAt === null
        || currentDisclosedAt === null
        || Date.parse(receipt.closedAt) < Date.parse(currentDisclosedAt)
        || Date.parse(receipt.closedAt) >= expiresAt
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["closedAt"],
      message: "Closed time must match the exact delivery terminal state.",
    });
  }
}

function reportSourceSnapshotIssues(
  snapshot: {
    requiredSourceIds: readonly string[];
    manifest: readonly { sourceId: string; chunkId: string }[];
  },
  context: z.RefinementCtx,
) {
  const required = new Set(snapshot.requiredSourceIds);
  if (required.size !== snapshot.requiredSourceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["requiredSourceIds"],
      message: "Required source IDs must be unique.",
    });
  }

  const manifestKeys = snapshot.manifest.map((entry) => (
    JSON.stringify([entry.sourceId, entry.chunkId])
  ));
  if (new Set(manifestKeys).size !== manifestKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "Source snapshot source/chunk pairs must be unique.",
    });
  }
  if (snapshot.manifest.some((entry) => !required.has(entry.sourceId))) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "A source snapshot cannot contain an unrequired source ID.",
    });
  }
  const represented = new Set(snapshot.manifest.map((entry) => entry.sourceId));
  if (snapshot.requiredSourceIds.some((sourceId) => !represented.has(sourceId))) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "Every required source ID must appear in the snapshot manifest.",
    });
  }
}

function sourceChunkDigest(canonicalText: string) {
  return digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.sourceChunk,
    canonicalText,
  );
}

function digestCanonicalJson(domain: string, value: unknown) {
  return createHash("sha256")
    .update(domain)
    .update(canonicalJson(value))
    .digest("hex");
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

function resourceRowMatchesCore(
  row: ParsedLoadedResourceRow | ParsedResourceSealIdentity,
  resource: ParsedPrivateResourceCore,
) {
  const route = resource.session.routeIdentity;
  return row.routeIdentity.planId === route.planId
    && row.routeIdentity.sessionId === route.sessionId
    && row.routeIdentity.routeRevisionId === route.routeRevisionId
    && row.resourceGeneratedAt === resource.session.generatedAt;
}

function sameRouteIdentity(
  left: z.infer<typeof DeliveryRouteIdentitySchema>,
  right: z.infer<typeof DeliveryRouteIdentitySchema>,
) {
  return left.planId === right.planId
    && left.sessionId === right.sessionId
    && left.routeRevisionId === right.routeRevisionId;
}

function sameCanonicalDigests(
  left: z.infer<typeof CanonicalDigestsSchema>,
  right: z.infer<typeof CanonicalDigestsSchema>,
) {
  return left.publicPayloadDigest === right.publicPayloadDigest
    && left.serverPayloadDigest === right.serverPayloadDigest
    && left.sourceSnapshotDigest === right.sourceSnapshotDigest
    && left.resourceDigest === right.resourceDigest;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
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

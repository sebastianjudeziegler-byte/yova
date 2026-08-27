import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS,
  BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS,
} from "@/components/broad-recall-runtime-controller";
import {
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
  DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
  DisabledBlurtingLoadedEvaluationReceiptRowV18Schema,
  DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema,
  DisabledBlurtingVerifiedCompletionContextV18Schema,
  createDisabledBlurtingVerifiedCompletionContextV18,
  readDisabledBlurtingVerifiedCompletionContextV18,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS,
  DisabledBlurtingDeliveryReceiptContextV18Schema,
  DisabledBlurtingPrivateResourceV18Schema,
  DisabledBlurtingRepositoryExecutionCapabilityV18Schema,
  createDisabledBlurtingCanonicalResourceV18,
  disabledBlurtingCanonicalJsonV18,
  projectDisabledBlurtingPrivateResourceDiagnosticV18,
  readDisabledBlurtingPrivateResourceV18,
  readDisabledBlurtingRepositoryExecutionCapabilityV18,
  toDisabledBlurtingCompareDisclosureV18,
  toDisabledBlurtingCompleteDisclosureV18,
  toDisabledBlurtingPublicBootstrapV18,
  toDisabledBlurtingPublicResourceTemplateV18,
  toDisabledBlurtingRepairDisclosureV18,
  toDisabledBlurtingTransferDisclosureV18,
} from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  DisabledBlurtingCanonicalUuidV18Schema,
  DisabledBlurtingCompareDisclosureV18Schema,
  DisabledBlurtingCompleteDisclosureV18Schema,
  DisabledBlurtingPublicBootstrapV18Schema,
  DisabledBlurtingPublicDeliveryV18Schema,
  DisabledBlurtingPublicResourceTemplateV18Schema,
  DisabledBlurtingRepairDisclosureV18Schema,
  DisabledBlurtingTransferDisclosureV18Schema,
  projectDisabledBlurtingSafeDiagnosticV18,
  readDisabledBlurtingEvaluatorTransportV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import {
  CachedGeneratedSessionSchema,
  CachedGeneratedSessionV15Schema,
  CachedGeneratedSessionV16Schema,
  CachedGeneratedSessionV17Schema,
} from "@/lib/session-generation/schema";
import {
  BLURTING_PHASE_IDS,
  blurtingFinalCheckEvidenceId,
} from "@/lib/study-route/method-recipe-contract";

const IDS = {
  user: "97000000-0000-4000-8000-000000000001",
  resource: "97000000-0000-4000-8000-000000000002",
  delivery: "97000000-0000-4000-8000-000000000003",
  run: "97000000-0000-4000-8000-000000000004",
  plan: "97000000-0000-4000-8000-000000000005",
  session: "97000000-0000-4000-8000-000000000006",
  route: "97000000-0000-4000-8000-000000000007",
  sourceSnapshot: "97000000-0000-4000-8000-000000000008",
  request: "97000000-0000-4000-8000-000000000009",
  evaluationReceipt: "97000000-0000-4000-8000-000000000010",
  firstTarget: "97000000-0000-4000-8000-000000000011",
  secondTarget: "97000000-0000-4000-8000-000000000012",
  thirdTarget: "97000000-0000-4000-8000-000000000013",
  other: "97000000-0000-4000-8000-000000000014",
} as const;

const GENERATED_AT = "2026-08-25T04:00:00.000Z";
const ISSUED_AT = "2026-08-25T04:05:00.000Z";
const OBSERVED_AT = "2026-08-25T04:06:00.000Z";
const EXPIRES_AT = "2026-09-02T04:05:00.000Z";
const UPPERCASE_UUID = "ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MAX_UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const SOURCE_TEXT = "Blurting \"A\"\nB";
const SOURCE_CHUNK_DIGEST =
  "86fd9b600999bd40b16fb5cdc84f34adcd344996a8ff5780369263273f6e8c2c";

const PRIVATE_SENTINELS = [
  "PRIVATE_MODEL_SENTINEL",
  "PRIVATE_CANONICAL_CONCEPT_ALPHA",
  "PRIVATE_COMPARE_CRITERION_ALPHA",
  "PRIVATE_TRANSFER_CRITERION_ALPHA",
  "PRIVATE_UNUSED_COMPOSITE_TRANSFER_ANSWER",
  "PRIVATE_SOURCE_LABEL_SENTINEL",
  SOURCE_TEXT,
] as const;

describe("disabled Blurting V18 public/private split", () => {
  it("rejects noncanonical, nil, and max UUIDs across public and private boundaries", () => {
    const built = buildFixture();
    const recall = required(bootstrap(built));

    for (const invalidUuid of [UPPERCASE_UUID, NIL_UUID, MAX_UUID]) {
      expect(DisabledBlurtingCanonicalUuidV18Schema.safeParse(invalidUuid).success)
        .toBe(false);
      expect(readDisabledBlurtingEvaluatorTransportV18({
        ...evaluatorTransport(recall.identity, "ok"),
        requestToken: invalidUuid,
      })).toBeNull();
      expect(createDisabledBlurtingCanonicalResourceV18(
        privateResourceCore(),
        { ...resourceSealIdentity(), resourceId: invalidUuid },
      )).toBeNull();

      const capability = executionCapability(built, "recall");
      (capability.deliveryReceipt as { deliveryHandle: string }).deliveryHandle =
        invalidUuid;
      expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
        capability,
      ).success).toBe(false);
    }
  });

  it("pins the SQL/TypeScript canonical JSON and source-chunk digest vectors", () => {
    expect(disabledBlurtingCanonicalJsonV18({
      z: 2,
      a: ["x", 1],
    })).toBe('{"a":["x",1],"z":2}');
    expect(sourceChunkDigest(SOURCE_TEXT)).toBe(SOURCE_CHUNK_DIGEST);
    expect(DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS).toEqual({
      publicPayload: "yova.blurting.public.v18|",
      serverPayload: "yova.blurting.server.v18|",
      sourceSnapshot: "yova.blurting.source_snapshot.v1|",
      sourceChunk: "yova.blurting.source_chunk.v1|",
      resource: "yova.blurting.resource.v18|",
      deliveryReceipt: "yova.blurting.delivery_receipt.v18|",
    });
  });

  it("builds separate canonical public/server payloads without mutating inputs", () => {
    const coreInput = privateResourceCore();
    const identityInput = resourceSealIdentity();
    const snapshot = structuredClone({ coreInput, identityInput });
    const first = required(createDisabledBlurtingCanonicalResourceV18(
      coreInput,
      identityInput,
    ));
    const second = required(createDisabledBlurtingCanonicalResourceV18(
      structuredClone(coreInput),
      structuredClone(identityInput),
    ));

    expect({ coreInput, identityInput }).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(Object.keys(first).sort()).toEqual(["publicPayload", "serverPayload"]);
    expect(first.publicPayload.boundaryStatus)
      .toBe("disabled_public_resource_template_only");
    expect(first.serverPayload.boundaryStatus)
      .toBe("disabled_server_private_resource_only");
    expect(Object.keys(first.serverPayload.canonicalDigests).sort()).toEqual([
      "publicPayloadDigest",
      "resourceDigest",
      "serverPayloadDigest",
      "sourceSnapshotDigest",
    ]);
    expectDeepFrozen(first);
  });

  it("recomputes public, server, snapshot, and resource digests before trust", () => {
    const built = buildFixture();
    const exact = readDisabledBlurtingPrivateResourceV18(
      built.pair.serverPayload,
      built.loadedRow,
    );
    expect(exact).toEqual(built.pair.serverPayload);
    expectDeepFrozen(exact);

    const changedPrivate = mutableClone(built.pair.serverPayload);
    changedPrivate.orderedPublicTargets[0]!.displayLabel = "Changed display label";
    expect(readDisabledBlurtingPrivateResourceV18(changedPrivate, built.loadedRow))
      .toBeNull();

    const changedStoredPublic = mutableClone(built.loadedRow);
    changedStoredPublic.publicPayload.orderedTargets[0]!.displayLabel =
      "Changed stored label";
    expect(readDisabledBlurtingPrivateResourceV18(
      built.pair.serverPayload,
      changedStoredPublic,
    )).toBeNull();

    const changedSnapshot = mutableClone(built.pair.serverPayload);
    const entry = changedSnapshot.sourceAuthority.sourceSnapshot.manifest[0]!;
    entry.canonicalText = "Changed canonical source text";
    entry.contentDigest = sourceChunkDigest(entry.canonicalText);
    expect(DisabledBlurtingPrivateResourceV18Schema.safeParse(changedSnapshot).success)
      .toBe(true);
    expect(readDisabledBlurtingPrivateResourceV18(changedSnapshot, built.loadedRow))
      .toBeNull();

    const changedDigest = mutableClone(built.pair.serverPayload);
    changedDigest.canonicalDigests.serverPayloadDigest = "f".repeat(64);
    expect(readDisabledBlurtingPrivateResourceV18(changedDigest, built.loadedRow))
      .toBeNull();

    const changedRowDigest = mutableClone(built.loadedRow);
    changedRowDigest.resourceDigest = "e".repeat(64);
    expect(readDisabledBlurtingPrivateResourceV18(
      built.pair.serverPayload,
      changedRowDigest,
    )).toBeNull();
  });

  it("keeps raw resource/delivery joins structurally checkable but non-authoritative", () => {
    const built = buildFixture();
    const rawCapability = executionCapability(built, "recall");

    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      rawCapability,
    ).success).toBe(true);
    expect(readDisabledBlurtingRepositoryExecutionCapabilityV18(rawCapability))
      .toBeNull();
    expect(toDisabledBlurtingPublicBootstrapV18(rawCapability as never)).toBeNull();

    const wrongRoute = executionCapability(built, "recall");
    (wrongRoute.routeAuthority as { committedRouteRevisionId: string })
      .committedRouteRevisionId = IDS.other;
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      wrongRoute,
    ).success).toBe(false);

    const backdated = executionCapability(built, "recall");
    backdated.observedAt = "2026-08-25T04:05:09.999Z";
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      backdated,
    ).success).toBe(false);

    const beforeCompare = executionCapability(built, "compare");
    beforeCompare.observedAt = "2026-08-25T04:05:19.999Z";
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      beforeCompare,
    ).success).toBe(false);

    const stale = executionCapability(built, "recall");
    stale.observedAt = EXPIRES_AT;
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(stale).success)
      .toBe(false);
  });

  it("projects an answer-free reusable template and run-bound bootstrap", () => {
    const built = buildFixture();
    const template = built.pair.publicPayload;
    const recall = required(bootstrap(built));
    expect(toDisabledBlurtingPublicResourceTemplateV18(
      executionCapability(built, "recall") as never,
    )).toBeNull();

    expect(DisabledBlurtingPublicResourceTemplateV18Schema.safeParse(template).success)
      .toBe(true);

    expect(Object.keys(template).sort()).toEqual([
      "boundaryStatus",
      "gapCount",
      "identity",
      "initialRecall",
      "orderedTargets",
      "phaseMetadata",
      "schemaVersion",
    ]);
    expect(Object.keys(template.identity).sort()).toEqual([
      "planId",
      "resourceFingerprint",
      "resourceGeneratedAt",
      "routeRevisionId",
      "sessionId",
    ]);
    expect("deliveryHandle" in template.identity).toBe(false);
    expect("runId" in template.identity).toBe(false);
    expect("activityIndex" in template.identity).toBe(false);

    expect(Object.keys(recall).sort()).toEqual(stageKeys(
      "prompt",
      "sourceClosedReminder",
    ));
    expect(Object.keys(recall.identity).sort()).toEqual([
      "activityIndex",
      "deliveryHandle",
      "planId",
      "resourceFingerprint",
      "resourceGeneratedAt",
      "routeRevisionId",
      "runId",
      "sessionId",
    ]);
    expect(recall.identity).toMatchObject({
      deliveryHandle: IDS.delivery,
      runId: IDS.run,
      activityIndex: 2,
    });
    expect(recall.orderedTargets).toEqual(publicTargets());
    expect(recall.phaseMetadata.every((phase) => (
      JSON.stringify(phase.targetIds) === JSON.stringify(targetIds())
    ))).toBe(true);
    expectDeepFrozen(template);

    const astralPrompt = "😀".repeat(320);
    const parsedAstralRecall = DisabledBlurtingPublicBootstrapV18Schema.safeParse({
      ...recall,
      prompt: astralPrompt,
    });
    expect(parsedAstralRecall.success).toBe(true);
    if (parsedAstralRecall.success) {
      expect(parsedAstralRecall.data.prompt).toBe(astralPrompt);
    }
    for (const invalidPrompt of [
      " padded prompt",
      "padded prompt ",
      "prompt\u0000value",
      "prompt\ud800value",
      "😀".repeat(321),
    ]) {
      expect(DisabledBlurtingPublicBootstrapV18Schema.safeParse({
        ...recall,
        prompt: invalidPrompt,
      }).success).toBe(false);
    }

    for (const secret of PRIVATE_SENTINELS) {
      expect(JSON.stringify(template)).not.toContain(secret);
      expect(JSON.stringify(recall)).not.toContain(secret);
    }
  });

  it("uses exact, physically separate disclosure shapes for every stage", () => {
    const built = buildFixture();
    const recall = required(bootstrap(built));
    const compare = publicStage(built, "compare");
    const repair = publicStage(built, "repair");
    const transfer = publicStage(built, "transfer");
    expect(toDisabledBlurtingCompareDisclosureV18(
      executionCapability(built, "compare") as never,
    )).toBeNull();
    expect(toDisabledBlurtingRepairDisclosureV18(
      executionCapability(built, "repair") as never,
    )).toBeNull();
    expect(toDisabledBlurtingTransferDisclosureV18(
      executionCapability(built, "transfer") as never,
    )).toBeNull();
    expect(toDisabledBlurtingCompleteDisclosureV18(
      executionCapability(built, "complete") as never,
      rawVerifiedCompletion(built, recall.identity),
    )).toBeNull();
    const complete = DisabledBlurtingCompleteDisclosureV18Schema.parse(
      publicCompleteShape(recall),
    );
    if (complete.stage !== "complete") throw new Error("Expected complete stage.");

    expect(Object.keys(compare).sort()).toEqual(stageKeys(
      "comparisonInstructions",
      "gapChecklist",
      "savedSourceAnswer",
    ));
    expect(Object.keys(repair).sort()).toEqual(stageKeys(
      "correctionInstruction",
      "sourceClosedReminder",
    ));
    expect(Object.keys(transfer).sort()).toEqual(stageKeys(
      "answerConstraints",
      "prompt",
      "sourceClosedReminder",
    ));
    expect(Object.keys(complete).sort()).toEqual(stageKeys(
      "completion",
      "orderedReferences",
    ));

    expect(JSON.stringify(recall)).not.toContain("COMPARE_REFERENCE_SENTINEL");
    expect(JSON.stringify(compare)).toContain("COMPARE_REFERENCE_SENTINEL");
    expect(JSON.stringify(repair)).not.toContain("COMPARE_REFERENCE_SENTINEL");
    expect(JSON.stringify(transfer))
      .not.toContain("PRIVATE_UNUSED_COMPOSITE_TRANSFER_ANSWER");
    expect(JSON.stringify(complete))
      .not.toContain("PRIVATE_UNUSED_COMPOSITE_TRANSFER_ANSWER");
    expect(complete.orderedReferences).toEqual(evaluationReferences());
    expect(complete.completion.orderedResults.map((result) => result.targetId))
      .toEqual(targetIds());

    for (const delivery of [recall, compare, repair, transfer]) {
      expect(delivery.orderedTargets.map((target) => target.targetId))
        .toEqual(targetIds());
      for (const secret of PRIVATE_SENTINELS) {
        expect(JSON.stringify(delivery)).not.toContain(secret);
      }
    }
    expect(complete.orderedTargets.map((target) => target.targetId))
      .toEqual(targetIds());
    for (const secret of PRIVATE_SENTINELS) {
      expect(JSON.stringify(complete)).not.toContain(secret);
    }

    expect(DisabledBlurtingPublicBootstrapV18Schema.safeParse({
      ...recall,
      savedSourceAnswer: "too early",
    }).success).toBe(false);
    expect(DisabledBlurtingCompareDisclosureV18Schema.safeParse({
      ...compare,
      correctionInstruction: "This later instruction must not be carried.",
    }).success).toBe(false);
    expect(DisabledBlurtingRepairDisclosureV18Schema.safeParse({
      ...repair,
      savedSourceAnswer: "source must be gone",
    }).success).toBe(false);
    expect(DisabledBlurtingTransferDisclosureV18Schema.safeParse({
      ...transfer,
      expectedAnswer: "not before evaluation",
    }).success).toBe(false);
    expect(DisabledBlurtingCompleteDisclosureV18Schema.safeParse({
      ...complete,
      comparisonCriterion: "private rubric",
    }).success).toBe(false);
  });

  it("keeps verified completion unreachable until a repository owns the brand", () => {
    const built = buildFixture();
    const identity = required(bootstrap(built)).identity;
    const verification = rawVerifiedCompletion(built, identity);
    const expectation = completionExpectation(built, identity);
    const rawJoin = completionJoin(built);

    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      rawJoin,
    ).success).toBe(true);
    expect(DisabledBlurtingVerifiedCompletionContextV18Schema.safeParse(
      verification,
    ).success).toBe(true);
    expect(createDisabledBlurtingVerifiedCompletionContextV18(
      rawJoin as never,
      expectation,
    )).toBeNull();
    expect(readDisabledBlurtingVerifiedCompletionContextV18(
      verification,
      expectation,
    )).toBeNull();

    expect(readDisabledBlurtingVerifiedCompletionContextV18(
      verification.orderedResults,
      expectation,
    )).toBeNull();
    expect(readDisabledBlurtingVerifiedCompletionContextV18({
      evaluatorVersion: verification.evaluatorVersion,
      requestToken: verification.requestToken,
      orderedResults: verification.orderedResults,
    }, expectation)).toBeNull();

    expect(createDisabledBlurtingVerifiedCompletionContextV18(
      evaluationReceiptRow() as never,
      expectation,
    )).toBeNull();
    expect(createDisabledBlurtingVerifiedCompletionContextV18(
      JSON.parse(JSON.stringify(rawJoin)) as never,
      expectation,
    )).toBeNull();

    expect(toDisabledBlurtingCompleteDisclosureV18(
      executionCapability(built, "complete") as never,
      verification.orderedResults,
    )).toBeNull();
    expect(toDisabledBlurtingCompleteDisclosureV18(
      executionCapability(built, "recall") as never,
      verification,
    )).toBeNull();

    const unavailableWithSecure = {
      ...verification,
      resolution: "evaluator_unavailable",
    };
    expect(DisabledBlurtingVerifiedCompletionContextV18Schema.safeParse(
      unavailableWithSecure,
    ).success).toBe(false);

    const wrongParentDigest = completionJoin(built);
    wrongParentDigest.deliveryReceipt.resourceIdentity.resourceDigest = "f".repeat(64);
    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      wrongParentDigest,
    ).success).toBe(false);

    const wrongDeliveryState = completionJoin(built);
    (wrongDeliveryState.deliveryReceipt as { state: string }).state = "active";
    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      wrongDeliveryState,
    ).success).toBe(false);

    const wrongResultTarget = completionJoin(built);
    wrongResultTarget.evaluationReceipt.resultVector[0] = {
      targetId: IDS.other,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.other),
      result: "secure",
    } as unknown as typeof wrongResultTarget.evaluationReceipt.resultVector[number];
    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      wrongResultTarget,
    ).success).toBe(false);

    const backdatedCompletion = completionJoin(built);
    backdatedCompletion.observedAt = "2026-08-25T04:05:49.999Z";
    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      backdatedCompletion,
    ).success).toBe(false);

    const expiredCompletion = completionJoin(built);
    expiredCompletion.observedAt = EXPIRES_AT;
    expect(DisabledBlurtingRepositoryLoadedCompletionJoinV18Schema.safeParse(
      expiredCompletion,
    ).success).toBe(false);

    const completionAtExpiry = completionJoin(built);
    completionAtExpiry.evaluationReceipt.completedAt =
      completionAtExpiry.evaluationReceipt.expiresAt;
    expect(DisabledBlurtingLoadedEvaluationReceiptRowV18Schema.safeParse(
      completionAtExpiry.evaluationReceipt,
    ).success).toBe(false);

    const uppercaseIdentity = evaluationReceiptRow();
    (uppercaseIdentity as { evaluationReceiptId: string }).evaluationReceiptId =
      UPPERCASE_UUID;
    expect(DisabledBlurtingLoadedEvaluationReceiptRowV18Schema.safeParse(
      uppercaseIdentity,
    ).success).toBe(false);

    const candidate = DisabledBlurtingCompleteDisclosureV18Schema.parse(
      publicCompleteShape(required(bootstrap(built))),
    );
    const reversedReferences = {
      ...candidate,
      orderedReferences: [...candidate.orderedReferences].reverse(),
    };
    expect(DisabledBlurtingCompleteDisclosureV18Schema.safeParse(
      reversedReferences,
    ).success).toBe(false);
  });

  it("defines a client-safe evaluator DTO with exact 2-3000 answer parity", () => {
    const built = buildFixture();
    const recall = required(bootstrap(built));
    const exact = evaluatorTransport(recall.identity, "ok");
    const parsed = readDisabledBlurtingEvaluatorTransportV18(exact);
    const astralAnswer = "😀".repeat(3_000);

    expect(DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS)
      .toBe(BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS);
    expect(DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS)
      .toBe(BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS);
    expect(readDisabledBlurtingEvaluatorTransportV18(
      evaluatorTransport(recall.identity, "x".repeat(3_000)),
    )).not.toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18(
      evaluatorTransport(recall.identity, "x"),
    )).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18(
      evaluatorTransport(recall.identity, "x".repeat(3_001)),
    )).toBeNull();
    const parsedAstral = readDisabledBlurtingEvaluatorTransportV18(
      evaluatorTransport(recall.identity, astralAnswer),
    );
    expect(parsedAstral?.learnerAnswer).toBe(astralAnswer);
    for (const invalidAnswer of [" ok", "ok ", "ok\u0000", "ok\ud800"]) {
      expect(readDisabledBlurtingEvaluatorTransportV18(
        evaluatorTransport(recall.identity, invalidAnswer),
      )).toBeNull();
    }
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...exact,
      signal: new AbortController().signal,
    })).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...exact,
      requestToken: UPPERCASE_UUID,
    })).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...exact,
      transferSuccessCriterion: "client rubric",
    })).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...exact,
      orderedBindings: exact.orderedBindings.map((binding, index) => (
        index === 0 ? { ...binding, concept: "client concept" } : binding
      )),
    })).toBeNull();
    expect(parsed?.orderedBindings.map((binding) => binding.targetId))
      .toEqual(targetIds());
    expect(JSON.stringify(parsed)).not.toContain("signal");
    expectDeepFrozen(parsed);
    expectDeepFrozen(parsedAstral);
  });

  it("projects content-free frozen diagnostics", () => {
    const built = buildFixture();
    expect(projectDisabledBlurtingPrivateResourceDiagnosticV18(
      executionCapability(built, "recall") as never,
    )).toBeNull();
    const diagnostic = projectDisabledBlurtingSafeDiagnosticV18(
      required(bootstrap(built)),
    );

    expect(diagnostic).toEqual({
      schemaVersion: 18,
      boundaryStatus: "disabled_safe_diagnostic_only",
      deliveryHandle: IDS.delivery,
      runId: IDS.run,
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
      activityIndex: 2,
      stage: "recall",
      targetCount: 3,
      gapCount: 3,
      phaseIds: [...BLURTING_PHASE_IDS],
    });
    for (const secret of PRIVATE_SENTINELS) {
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
    }
    expectDeepFrozen(diagnostic);
  });

  it("keeps V18 contracts out of legacy caches, generation, and the live renderer", () => {
    const built = buildFixture();
    const recall = required(bootstrap(built));

    expect(CachedGeneratedSessionV15Schema.safeParse(recall).success).toBe(false);
    expect(CachedGeneratedSessionV16Schema.safeParse(recall).success).toBe(false);
    expect(CachedGeneratedSessionV17Schema.safeParse(recall).success).toBe(false);
    expect(CachedGeneratedSessionSchema.safeParse(recall).success).toBe(false);
    expect(DisabledBlurtingPublicDeliveryV18Schema.safeParse(recall).success)
      .toBe(true);

    const publicSource = sourceFile(
      "src/lib/session-generation/disabled-blurting-public-delivery-v18.ts",
    );
    expect(publicSource).not.toContain("disabled-blurting-session-v18");
    expect(publicSource).not.toContain("@/lib/server/");
    expect(publicSource).not.toContain('import "server-only"');

    const legacySchema = sourceFile("src/lib/session-generation/schema.ts");
    const liveRenderer = sourceFile("src/components/yova-prototype.tsx");
    const generateRoute = sourceFile("src/app/api/sessions/generate/route.ts");
    for (const source of [legacySchema, liveRenderer, generateRoute]) {
      expect(source).not.toContain("disabled-blurting-public-delivery-v18");
      expect(source).not.toContain("disabled-blurting-private-resource-v18");
      expect(source).not.toContain("disabled-blurting-verified-completion-v18");
    }
    expect(generateRoute).toContain("blurting_runtime_unavailable");
    expect(legacySchema).toContain("CachedGeneratedSessionV15Schema");
    expect(legacySchema).toContain("CachedGeneratedSessionV16Schema");
    expect(legacySchema).toContain("CachedGeneratedSessionV17Schema");
  });

  it("rejects malformed snapshots, padded canonical text, and target-order drift", () => {
    const core = privateResourceCore();
    core.sourceAuthority.sourceSnapshot.manifest[0]!.canonicalText =
      ` ${SOURCE_TEXT}`;
    core.sourceAuthority.sourceSnapshot.manifest[0]!.contentDigest =
      sourceChunkDigest(` ${SOURCE_TEXT}`);
    expect(createDisabledBlurtingCanonicalResourceV18(
      core,
      resourceSealIdentity(),
    )).toBeNull();

    const astralSource = privateResourceCore();
    const exactAstralSource = "😀".repeat(7_000);
    astralSource.sourceAuthority.sourceSnapshot.manifest[0]!.canonicalText =
      exactAstralSource;
    astralSource.sourceAuthority.sourceSnapshot.manifest[0]!.contentDigest =
      sourceChunkDigest(exactAstralSource);
    const parsedAstralSource = createDisabledBlurtingCanonicalResourceV18(
      astralSource,
      resourceSealIdentity(),
    );
    expect(parsedAstralSource?.serverPayload.sourceAuthority.sourceSnapshot
      .manifest[0]?.canonicalText).toBe(exactAstralSource);

    for (const invalidSourceText of [
      `${SOURCE_TEXT}\u0000`,
      `${SOURCE_TEXT}\ud800`,
      "😀".repeat(7_001),
    ]) {
      const invalidSource = privateResourceCore();
      invalidSource.sourceAuthority.sourceSnapshot.manifest[0]!.canonicalText =
        invalidSourceText;
      invalidSource.sourceAuthority.sourceSnapshot.manifest[0]!.contentDigest =
        sourceChunkDigest(invalidSourceText);
      expect(createDisabledBlurtingCanonicalResourceV18(
        invalidSource,
        resourceSealIdentity(),
      )).toBeNull();
    }

    const paddedMetadata = privateResourceCore();
    paddedMetadata.sourceAuthority.sourceSnapshot.manifest[0]!.sourceLabel =
      " PRIVATE_SOURCE_LABEL_SENTINEL";
    expect(createDisabledBlurtingCanonicalResourceV18(
      paddedMetadata,
      resourceSealIdentity(),
    )).toBeNull();

    const unknownSource = privateResourceCore();
    unknownSource.sourceAuthority.sourceSnapshot.manifest[0]!.sourceId =
      "source:not-required";
    expect(createDisabledBlurtingCanonicalResourceV18(
      unknownSource,
      resourceSealIdentity(),
    )).toBeNull();

    const reversedLabels = privateResourceCore();
    reversedLabels.orderedPublicTargets.reverse();
    expect(createDisabledBlurtingCanonicalResourceV18(
      reversedLabels,
      resourceSealIdentity(),
    )).toBeNull();

    const duplicateChunk = privateResourceCore();
    duplicateChunk.sourceAuthority.sourceSnapshot.manifest.push(
      structuredClone(duplicateChunk.sourceAuthority.sourceSnapshot.manifest[0]!),
    );
    expect(createDisabledBlurtingCanonicalResourceV18(
      duplicateChunk,
      resourceSealIdentity(),
    )).toBeNull();

    expect(createDisabledBlurtingCanonicalResourceV18(
      privateResourceCore(),
      { ...resourceSealIdentity(), resourceId: UPPERCASE_UUID },
    )).toBeNull();
  });

  it("does not turn structurally valid raw execution JSON into a capability", () => {
    const built = buildFixture();
    const input = executionCapability(built, "recall");
    const snapshot = structuredClone(input);
    const capability = readDisabledBlurtingRepositoryExecutionCapabilityV18(input);

    expect(input).toEqual(snapshot);
    expect(capability).toBeNull();
  });

  it("requires the exact server-authorized disclosure stage and timestamp prefix", () => {
    const built = buildFixture();
    expect(toDisabledBlurtingCompareDisclosureV18(
      executionCapability(built, "recall") as never,
    )).toBeNull();
    expect(toDisabledBlurtingRepairDisclosureV18(
      executionCapability(built, "compare") as never,
    )).toBeNull();
    expect(toDisabledBlurtingTransferDisclosureV18(
      executionCapability(built, "repair") as never,
    )).toBeNull();
    expect(toDisabledBlurtingPublicBootstrapV18(
      executionCapability(built, "transfer") as never,
    )).toBeNull();

    const skippedPrefix = mutableClone(built.transferReceipt);
    skippedPrefix.repairDisclosedAt = null;
    expect(DisabledBlurtingDeliveryReceiptContextV18Schema.safeParse(
      skippedPrefix,
    ).success).toBe(false);

    const futureTimestamp = mutableClone(built.compareReceipt);
    futureTimestamp.compareDisclosedAt = EXPIRES_AT;
    expect(DisabledBlurtingDeliveryReceiptContextV18Schema.safeParse(
      futureTimestamp,
    ).success).toBe(false);

    const wrongState = mutableClone(built.completedReceipt);
    wrongState.state = "active";
    expect(DisabledBlurtingDeliveryReceiptContextV18Schema.safeParse(wrongState).success)
      .toBe(false);

    const offsetTimestamp = evaluationReceiptRow();
    offsetTimestamp.issuedAt = "2026-08-25T04:05:10.000+00:00";
    expect(DisabledBlurtingLoadedEvaluationReceiptRowV18Schema.safeParse(
      offsetTimestamp,
    ).success).toBe(false);

    const variablePrecision = evaluationReceiptRow();
    variablePrecision.completedAt = "2026-08-25T04:05:50Z";
    expect(DisabledBlurtingLoadedEvaluationReceiptRowV18Schema.safeParse(
      variablePrecision,
    ).success).toBe(false);
  });
});

function buildFixture() {
  const core = privateResourceCore();
  const sealIdentity = resourceSealIdentity();
  const pair = required(createDisabledBlurtingCanonicalResourceV18(
    core,
    sealIdentity,
  ));
  const loadedRow = {
    authority: "server_loaded_blurting_resource_row_v18" as const,
    resourceId: sealIdentity.resourceId,
    userId: sealIdentity.userId,
    routeIdentity: structuredClone(sealIdentity.routeIdentity),
    resourceFingerprint: sealIdentity.resourceFingerprint,
    resourceGeneratedAt: sealIdentity.resourceGeneratedAt,
    state: "ready" as const,
    publicPayloadDigest: pair.serverPayload.canonicalDigests.publicPayloadDigest,
    resourceDigest: pair.serverPayload.canonicalDigests.resourceDigest,
    publicPayload: structuredClone(pair.publicPayload),
  };
  return {
    core,
    sealIdentity,
    pair,
    loadedRow,
    activeReceipt: deliveryReceipt(pair, "recall"),
    compareReceipt: deliveryReceipt(pair, "compare"),
    repairReceipt: deliveryReceipt(pair, "repair"),
    transferReceipt: deliveryReceipt(pair, "transfer"),
    completedReceipt: deliveryReceipt(pair, "complete"),
  };
}

function privateResourceCore() {
  const targets = privateTargets();
  const ids = targetIds();
  const sourceSnapshot = {
    sourceSnapshotId: IDS.sourceSnapshot,
    sourceType: "user_materials" as const,
    requiredSourceIds: ["source:chapter-1"],
    manifest: [{
      sourceId: "source:chapter-1",
      sourceVersionId: "version:1",
      chunkId: "chunk:1",
      sourceLabel: "PRIVATE_SOURCE_LABEL_SENTINEL",
      locationLabel: "Section 1",
      contentDigest: SOURCE_CHUNK_DIGEST,
      canonicalText: SOURCE_TEXT,
    }],
  };
  return {
    serverContractVersion: "blurting_server_resource_v18" as const,
    boundaryStatus: "disabled_server_private_resource_only" as const,
    issuanceState: "disabled" as const,
    sourceAuthority: {
      version: "blurting_source_authority_v1" as const,
      state: "server_bound" as const,
      sourceSnapshotId: IDS.sourceSnapshot,
      sourceType: "user_materials" as const,
      requiredSourceIds: ["source:chapter-1"],
      sourceSnapshot,
    },
    orderedPublicTargets: publicTargets(),
    orderedEvaluationReferences: evaluationReferences(),
    session: {
      schemaVersion: 18 as const,
      boundaryStatus: "disabled_schema_only" as const,
      sourceReadiness: "pending_runtime_source_validation" as const,
      model: "PRIVATE_MODEL_SENTINEL",
      generatedAt: GENERATED_AT,
      routeIdentity: {
        lifecycleStatus: "committed" as const,
        planId: IDS.plan,
        sessionId: IDS.session,
        routeRevisionId: IDS.route,
      },
      deliveryIdentity: {
        learningMode: "study" as const,
        taskType: "conceptual_learning" as const,
        methodId: "retrieval_practice" as const,
        visibleMethodName: "Blurting" as const,
        visibleSupportingTechniqueId: "blurting_v1" as const,
        executionEnvironment: "inside_yova" as const,
      },
      orderedTargets: targets,
      phaseEnvelopes: [{
        phaseId: BLURTING_PHASE_IDS[0],
        methodPhase: "retrieve" as const,
        activeMinutes: 4,
        targetIds: ids,
        runtime: {
          kind: "retrieval_round" as const,
          format: "broad_recall_v1" as const,
          sourceClosedReminder:
            "Close the source before reconstructing everything you can remember.",
          prompts: [{
            prompt: "Reconstruct the visible mechanisms and their relationship from memory.",
            expectedAnswer: "COMPARE_REFERENCE_SENTINEL: the mechanisms form one causal chain.",
            hint: null,
          }],
          comparisonInstructions:
            "Only after the broad attempt, reopen the source and compare every visible gap.",
          gapChecklist: [
            "Visible gap for alpha",
            "Visible gap for beta",
            "Visible gap for gamma",
          ],
          correctionInstruction:
            "Close the source and repair only the relationships that were missing or inaccurate.",
          transferPrompt: {
            sourceClosedReminder:
              "Close the source again before answering the fresh transfer question.",
            prompt: "Predict what changes when the initiating condition is interrupted.",
            expectedAnswer: "PRIVATE_UNUSED_COMPOSITE_TRANSFER_ANSWER",
          },
          targetBindings: targets,
        },
      }, {
        phaseId: BLURTING_PHASE_IDS[1],
        methodPhase: "repair" as const,
        activeMinutes: 4,
        targetIds: ids,
      }, {
        phaseId: BLURTING_PHASE_IDS[2],
        methodPhase: "transfer" as const,
        activeMinutes: 4,
        targetIds: ids,
      }],
      completionContract: {
        kind: "target_bound_closed_source_transfer" as const,
        evaluatorVersion: "blurting_target_evaluator_v1" as const,
        resultOrder: "ordered_targets" as const,
        requiresIndependentAttempt: true as const,
        evaluatorUnavailableResult: "unverified" as const,
        targetBindings: targetBindings(),
      },
    },
  };
}

function privateTargets() {
  return [{
    targetId: IDS.firstTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
    concept: "PRIVATE_CANONICAL_CONCEPT_ALPHA",
    comparisonCriterion: "PRIVATE_COMPARE_CRITERION_ALPHA identifies the first mechanism.",
    transferSuccessCriterion: "PRIVATE_TRANSFER_CRITERION_ALPHA predicts the first effect.",
  }, {
    targetId: IDS.secondTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
    concept: "PRIVATE_CANONICAL_CONCEPT_BETA",
    comparisonCriterion: "PRIVATE_COMPARE_CRITERION_BETA identifies the second mechanism.",
    transferSuccessCriterion: "PRIVATE_TRANSFER_CRITERION_BETA predicts the second effect.",
  }, {
    targetId: IDS.thirdTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.thirdTarget),
    concept: "PRIVATE_CANONICAL_CONCEPT_GAMMA",
    comparisonCriterion: "PRIVATE_COMPARE_CRITERION_GAMMA identifies the third mechanism.",
    transferSuccessCriterion: "PRIVATE_TRANSFER_CRITERION_GAMMA predicts the third effect.",
  }];
}

function publicTargets() {
  return [{
    targetId: IDS.firstTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
    displayLabel: "Visible target alpha",
  }, {
    targetId: IDS.secondTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
    displayLabel: "Visible target beta",
  }, {
    targetId: IDS.thirdTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.thirdTarget),
    displayLabel: "Visible target gamma",
  }];
}

function evaluationReferences() {
  return targetBindings().map((binding, index) => ({
    ...binding,
    referenceAnswer: `POSTCHECK_REFERENCE_${index + 1}: target-specific answer.`,
  }));
}

function targetIds() {
  return [IDS.firstTarget, IDS.secondTarget, IDS.thirdTarget];
}

function targetBindings() {
  return targetIds().map((targetId) => ({
    targetId,
    evidenceId: blurtingFinalCheckEvidenceId(targetId),
  }));
}

function resourceSealIdentity() {
  return {
    authority: "server_owned_blurting_resource_identity_v18" as const,
    resourceId: IDS.resource,
    userId: IDS.user,
    routeIdentity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
    },
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: GENERATED_AT,
  };
}

function deliveryReceipt(
  pair: NonNullable<ReturnType<typeof createDisabledBlurtingCanonicalResourceV18>>,
  disclosureStage: "recall" | "compare" | "repair" | "transfer" | "complete",
) {
  const stageIndex = ["recall", "compare", "repair", "transfer", "complete"]
    .indexOf(disclosureStage);
  const disclosedAt = [
    "2026-08-25T04:05:10.000Z",
    "2026-08-25T04:05:20.000Z",
    "2026-08-25T04:05:30.000Z",
    "2026-08-25T04:05:40.000Z",
    "2026-08-25T04:05:50.000Z",
  ].map((timestamp, index) => index <= stageIndex ? timestamp : null);
  const resourceIdentity = {
    resourceId: IDS.resource,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: GENERATED_AT,
    publicPayloadDigest: pair.serverPayload.canonicalDigests.publicPayloadDigest,
    resourceDigest: pair.serverPayload.canonicalDigests.resourceDigest,
  };
  const receiptDigest = canonicalDigest(
    "yova.blurting.delivery_receipt.v18|",
    {
      receiptId: IDS.delivery,
      resourceId: IDS.resource,
      userId: IDS.user,
      planId: IDS.plan,
      planSessionId: IDS.session,
      routeRevisionId: IDS.route,
      runId: IDS.run,
      activityIndex: 2,
      publicPayloadDigest: resourceIdentity.publicPayloadDigest,
      resourceDigest: resourceIdentity.resourceDigest,
    },
  );
  return {
    authority: "blurting_delivery_receipt_v18" as const,
    state: disclosureStage === "complete" ? "completed" as const : "active" as const,
    deliveryHandle: IDS.delivery,
    userId: IDS.user,
    runId: IDS.run,
    activityIndex: 2,
    routeIdentity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
    },
    resourceIdentity,
    receiptDigest,
    issuedAt: ISSUED_AT,
    lastSeenAt: disclosedAt[stageIndex]!,
    expiresAt: EXPIRES_AT,
    disclosureStage,
    recallDisclosedAt: disclosedAt[0]!,
    compareDisclosedAt: disclosedAt[1],
    repairDisclosedAt: disclosedAt[2],
    transferDisclosedAt: disclosedAt[3],
    completeDisclosedAt: disclosedAt[4],
    closedAt: disclosureStage === "complete" ? disclosedAt[4] : null,
  };
}

function bootstrap(built: ReturnType<typeof buildFixture>) {
  return publicStage(built, "recall");
}

function publicStage(
  built: ReturnType<typeof buildFixture>,
  stage: "recall",
): ReturnType<typeof DisabledBlurtingPublicBootstrapV18Schema.parse>;
function publicStage(
  built: ReturnType<typeof buildFixture>,
  stage: "compare",
): ReturnType<typeof DisabledBlurtingCompareDisclosureV18Schema.parse>;
function publicStage(
  built: ReturnType<typeof buildFixture>,
  stage: "repair",
): ReturnType<typeof DisabledBlurtingRepairDisclosureV18Schema.parse>;
function publicStage(
  built: ReturnType<typeof buildFixture>,
  stage: "transfer",
): ReturnType<typeof DisabledBlurtingTransferDisclosureV18Schema.parse>;
function publicStage(
  built: ReturnType<typeof buildFixture>,
  stage: "recall" | "compare" | "repair" | "transfer",
) {
  const template = built.pair.publicPayload;
  const receipt = {
    recall: built.activeReceipt,
    compare: built.compareReceipt,
    repair: built.repairReceipt,
    transfer: built.transferReceipt,
  }[stage];
  const base = {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_public_contract_only" as const,
    identity: {
      ...structuredClone(template.identity),
      deliveryHandle: receipt.deliveryHandle,
      runId: receipt.runId,
      activityIndex: receipt.activityIndex,
    },
    orderedTargets: structuredClone(template.orderedTargets),
    phaseMetadata: structuredClone(template.phaseMetadata),
    gapCount: template.gapCount,
  };
  const retrievePhase = built.pair.serverPayload.session.phaseEnvelopes[0];
  if (retrievePhase.methodPhase !== "retrieve") {
    throw new Error("Expected a retrieval phase fixture.");
  }
  const runtime = retrievePhase.runtime;
  switch (stage) {
    case "recall":
      return DisabledBlurtingPublicBootstrapV18Schema.parse({
        ...base,
        stage,
        sourceClosedReminder: runtime.sourceClosedReminder,
        prompt: runtime.prompts[0]?.prompt,
      });
    case "compare":
      return DisabledBlurtingCompareDisclosureV18Schema.parse({
        ...base,
        stage,
        comparisonInstructions: runtime.comparisonInstructions,
        savedSourceAnswer: runtime.prompts[0]?.expectedAnswer,
        gapChecklist: runtime.gapChecklist,
      });
    case "repair":
      return DisabledBlurtingRepairDisclosureV18Schema.parse({
        ...base,
        stage,
        sourceClosedReminder: runtime.sourceClosedReminder,
        correctionInstruction: runtime.correctionInstruction,
      });
    case "transfer":
      return DisabledBlurtingTransferDisclosureV18Schema.parse({
        ...base,
        stage,
        sourceClosedReminder: runtime.transferPrompt.sourceClosedReminder,
        prompt: runtime.transferPrompt.prompt,
        answerConstraints: { minCharacters: 2, maxCharacters: 3_000 },
      });
  }
}

function executionCapability(
  built: ReturnType<typeof buildFixture>,
  stage: "recall" | "compare" | "repair" | "transfer" | "complete",
) {
  const receipt = {
    recall: built.activeReceipt,
    compare: built.compareReceipt,
    repair: built.repairReceipt,
    transfer: built.transferReceipt,
    complete: built.completedReceipt,
  }[stage];
  return {
    authority: "server_loaded_blurting_execution_capability_v18" as const,
    observedAt: OBSERVED_AT,
    routeAuthority: currentRouteAuthority(),
    resource: structuredClone(built.pair.serverPayload),
    loadedResourceRow: structuredClone(built.loadedRow),
    deliveryReceipt: structuredClone(receipt),
  };
}

function currentRouteAuthority() {
  return {
    authority: "server_loaded_current_blurting_route_v18" as const,
    userId: IDS.user,
    planId: IDS.plan,
    sessionId: IDS.session,
    committedRouteRevisionId: IDS.route,
    routeRevisionId: IDS.route,
    routeLifecycle: "committed" as const,
    routeFingerprint: `sr1:${"a".repeat(64)}`,
    methodId: "retrieval_practice" as const,
    supportingTechniqueId: "blurting_v1" as const,
    executionEnvironment: "inside_yova" as const,
  };
}

function rawVerifiedCompletion(
  built: ReturnType<typeof buildFixture>,
  identity: NonNullable<ReturnType<typeof bootstrap>>["identity"],
) {
  const evaluation = evaluationReceiptRow();
  return {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_server_loaded_completion_only" as const,
    receipt: {
      authority: "verified_loaded_evaluation_row" as const,
      evaluationReceiptHandle: evaluation.evaluationReceiptId,
      deliveryReceiptHandle: evaluation.deliveryReceiptId,
      resourceId: evaluation.resourceId,
      resourceDigest: built.pair.serverPayload.canonicalDigests.resourceDigest,
      userId: evaluation.userId,
      requestDigest: evaluation.requestDigest,
      resultDigest: evaluation.resultDigest,
    },
    identity: structuredClone(identity),
    requestToken: evaluation.requestToken,
    evaluatorVersion: evaluation.evaluatorVersion,
    resolution: "evaluated" as const,
    orderedResults: structuredClone(evaluation.resultVector),
  };
}

function publicCompleteShape(
  recall: NonNullable<ReturnType<typeof bootstrap>>,
) {
  return {
    schemaVersion: recall.schemaVersion,
    boundaryStatus: recall.boundaryStatus,
    identity: structuredClone(recall.identity),
    orderedTargets: structuredClone(recall.orderedTargets),
    phaseMetadata: structuredClone(recall.phaseMetadata),
    gapCount: recall.gapCount,
    stage: "complete" as const,
    orderedReferences: evaluationReferences(),
    completion: {
      evaluationReceiptHandle: IDS.evaluationReceipt,
      requestToken: IDS.request,
      evaluatorVersion: "blurting_target_evaluator_v1" as const,
      resolution: "evaluated" as const,
      orderedResults: targetBindings().map((binding, index) => ({
        ...binding,
        result: (["secure", "needs_review", "unverified"] as const)[index]!,
      })),
    },
  };
}

function completionJoin(built: ReturnType<typeof buildFixture>) {
  return {
    authority: "server_loaded_blurting_completion_join_v18" as const,
    observedAt: OBSERVED_AT,
    routeAuthority: currentRouteAuthority(),
    resourceRow: structuredClone(built.loadedRow),
    deliveryReceipt: structuredClone(built.completedReceipt),
    evaluationReceipt: evaluationReceiptRow(),
  };
}

function completionExpectation(
  built: ReturnType<typeof buildFixture>,
  identity: NonNullable<ReturnType<typeof bootstrap>>["identity"],
) {
  return {
    userId: IDS.user,
    identity: structuredClone(identity),
    resourceIdentity: {
      resourceId: IDS.resource,
      resourceFingerprint: identity.resourceFingerprint,
      resourceGeneratedAt: identity.resourceGeneratedAt,
      resourceDigest: built.pair.serverPayload.canonicalDigests.resourceDigest,
    },
    orderedBindings: targetBindings(),
  };
}

function evaluationReceiptRow() {
  const resultVector = targetBindings().map((binding, index) => ({
    ...binding,
    result: (["secure", "needs_review", "unverified"] as const)[index]!,
  }));
  const requestClaim = {
    evaluationReceiptId: IDS.evaluationReceipt,
    deliveryReceiptId: IDS.delivery,
    resourceId: IDS.resource,
    userId: IDS.user,
    routeIdentity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
    },
    runId: IDS.run,
    activityIndex: 2,
    requestToken: IDS.request,
    answerHmac: "a".repeat(64),
    evaluatorVersion: "blurting_target_evaluator_v1" as const,
  };
  const requestDigest = canonicalDigest(
    DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
    requestClaim,
  );
  const resultDigest = canonicalDigest(
    DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
    {
      evaluationReceiptId: IDS.evaluationReceipt,
      requestDigest,
      resolution: "evaluated",
      orderedResults: resultVector,
    },
  );
  return {
    authority: "server_loaded_blurting_evaluation_receipt_v18" as const,
    ...requestClaim,
    state: "succeeded" as const,
    resultVector,
    requestDigest,
    resultDigest,
    issuedAt: "2026-08-25T04:05:10.000Z",
    leasedUntil: null,
    completedAt: "2026-08-25T04:05:50.000Z",
    expiresAt: "2026-09-24T04:05:10.000Z",
  };
}

function evaluatorTransport(
  identity: NonNullable<ReturnType<typeof bootstrap>>["identity"],
  learnerAnswer: string,
) {
  return {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_evaluator_transport_only" as const,
    requestToken: IDS.request,
    identity: structuredClone(identity),
    orderedBindings: targetBindings(),
    learnerAnswer,
  };
}

function stageKeys(...stageSpecific: string[]) {
  return [
    "boundaryStatus",
    "gapCount",
    "identity",
    "orderedTargets",
    "phaseMetadata",
    "schemaVersion",
    "stage",
    ...stageSpecific,
  ].sort();
}

function sourceChunkDigest(value: string) {
  return createHash("sha256")
    .update("yova.blurting.source_chunk.v1|")
    .update(JSON.stringify(value))
    .digest("hex");
}

function canonicalDigest(domain: string, value: unknown) {
  return createHash("sha256")
    .update(domain)
    .update(disabledBlurtingCanonicalJsonV18(value))
    .digest("hex");
}

function sourceFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected fixture value.");
  return value;
}

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function expectDeepFrozen(value: unknown) {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISABLED_BLURTING_ANSWER_HMAC_DOMAIN,
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
  DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
  DisabledBlurtingEvaluationOutcomeV18Schema,
  DisabledBlurtingEvaluationRequestDigestClaimV18Schema,
  DisabledBlurtingEvaluationResultDigestClaimV18Schema,
  bindDisabledBlurtingEvaluationServerInputV18,
  createDisabledBlurtingEvaluationOutcomeV18,
  createDisabledBlurtingEvaluationRequestDigestClaimV18,
  createDisabledBlurtingEvaluationResultDigestClaimV18,
  unavailableDisabledBlurtingEvaluationOutcomeV18,
} from "@/lib/server/disabled-blurting-evaluator-contract";
import {
  DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS,
  DisabledBlurtingRepositoryExecutionCapabilityV18Schema,
  createDisabledBlurtingCanonicalResourceV18,
  disabledBlurtingCanonicalJsonV18,
  readDisabledBlurtingRepositoryExecutionCapabilityV18,
} from "@/lib/server/disabled-blurting-private-resource-v18";
import {
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  readDisabledBlurtingEvaluatorTransportV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import {
  BLURTING_PHASE_IDS,
  blurtingFinalCheckEvidenceId,
} from "@/lib/study-route/method-recipe-contract";

const IDS = {
  user: "98000000-0000-4000-8000-000000000001",
  resource: "98000000-0000-4000-8000-000000000002",
  delivery: "98000000-0000-4000-8000-000000000003",
  run: "98000000-0000-4000-8000-000000000004",
  plan: "98000000-0000-4000-8000-000000000005",
  session: "98000000-0000-4000-8000-000000000006",
  route: "98000000-0000-4000-8000-000000000007",
  sourceSnapshot: "98000000-0000-4000-8000-000000000008",
  request: "98000000-0000-4000-8000-000000000009",
  evaluationReceipt: "98000000-0000-4000-8000-000000000011",
  firstTarget: "98000000-0000-4000-8000-000000000012",
  secondTarget: "98000000-0000-4000-8000-000000000013",
  other: "98000000-0000-4000-8000-000000000014",
} as const;

const GENERATED_AT = "2026-08-25T05:00:00.000Z";
const ISSUED_AT = "2026-08-25T05:05:00.000Z";
const OBSERVED_AT = "2026-08-25T05:06:00.000Z";
const EXPIRES_AT = "2026-09-02T05:05:00.000Z";
const PRIVATE_ANSWER =
  "PRIVATE LEARNER TRANSFER ANSWER: the downstream condition is no longer available.";
const SOURCE_TEXT = "Canonical source text for the two linked mechanisms.";
const UPPERCASE_UUID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

describe("disabled Blurting V18 evaluator boundary", () => {
  it("accepts only the canonical public transport while keeping private semantics off it", () => {
    const fixture = buildFixture();
    const transportSnapshot = structuredClone(fixture.transport);
    const resourceSnapshot = structuredClone(fixture.pair.serverPayload);
    const privateTargets = fixture.pair.serverPayload.session.orderedTargets.map(
      (target, index) => ({
        targetId: target.targetId,
        evidenceId: target.evidenceId,
        concept: target.concept,
        transferSuccessCriterion: target.transferSuccessCriterion,
        referenceAnswer:
          fixture.pair.serverPayload.orderedEvaluationReferences[index]?.referenceAnswer,
      }),
    );

    const parsedTransport = readDisabledBlurtingEvaluatorTransportV18(
      fixture.transport,
    );
    expect(parsedTransport).toEqual(fixture.transport);
    expectDeepFrozen(parsedTransport);
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      rawCapability(fixture),
    ).success).toBe(true);
    expect(readDisabledBlurtingRepositoryExecutionCapabilityV18(
      rawCapability(fixture),
    )).toBeNull();
    expect(bindFixture(fixture)).toBeNull();
    expect(privateTargets).toEqual([{
      targetId: IDS.firstTarget,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
      concept: "PRIVATE_CONCEPT_ALPHA",
      transferSuccessCriterion:
        "PRIVATE_TRANSFER_CRITERION_ALPHA predicts the first downstream change.",
      referenceAnswer: "PRIVATE_REFERENCE_ALPHA explains the first target.",
    }, {
      targetId: IDS.secondTarget,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
      concept: "PRIVATE_CONCEPT_BETA",
      transferSuccessCriterion:
        "PRIVATE_TRANSFER_CRITERION_BETA predicts the second downstream change.",
      referenceAnswer: "PRIVATE_REFERENCE_BETA explains the second target.",
    }]);
    expect(collectKeys(fixture.transport)).not.toEqual(expect.arrayContaining([
      "concept",
      "transferSuccessCriterion",
      "referenceAnswer",
      "expectedAnswer",
      "answerHmac",
    ]));
    expect(fixture.transport).toEqual(transportSnapshot);
    expect(fixture.pair.serverPayload).toEqual(resourceSnapshot);
  });

  it("rejects stale request shapes and client-supplied semantic or HMAC fields", () => {
    const fixture = buildFixture();
    const stale = {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
      resourceFingerprint: "sr1:0123456789abcdef",
      generatedAt: GENERATED_AT,
      activityIndex: 2,
      requestToken: IDS.request,
      targetBindings: targetBindings(),
      learnerAnswer: PRIVATE_ANSWER,
    };
    expect(readDisabledBlurtingEvaluatorTransportV18(stale)).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...fixture.transport,
      learnerAnswer: "x".repeat(
        DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS + 1,
      ),
    })).toBeNull();
    expect(readDisabledBlurtingEvaluatorTransportV18({
      ...fixture.transport,
      requestToken: UPPERCASE_UUID,
    })).toBeNull();

    for (const [field, value] of [
      ["concept", "CLIENT CONCEPT"],
      ["transferSuccessCriterion", "CLIENT CRITERION"],
      ["referenceAnswer", "CLIENT REFERENCE"],
      ["expectedAnswer", "CLIENT ANSWER KEY"],
      ["answerHmac", "a".repeat(64)],
    ] as const) {
      expect(readDisabledBlurtingEvaluatorTransportV18({
        ...fixture.transport,
        [field]: value,
      })).toBeNull();
      expect(readDisabledBlurtingEvaluatorTransportV18({
          ...fixture.transport,
          orderedBindings: fixture.transport.orderedBindings.map((binding, index) => (
            index === 0 ? { ...binding, [field]: value } : binding
          )),
      })).toBeNull();
    }
  });

  it("keeps owner, readiness, liveness, transfer stage, and run checks behind the opaque capability", () => {
    const fixture = buildFixture();
    const raw = rawCapability(fixture);
    const wrongOwner = mutableClone(raw);
    (wrongOwner.routeAuthority as { userId: string }).userId = IDS.other;
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      wrongOwner,
    ).success).toBe(false);

    const wrongRunTransport = mutableClone(fixture.transport);
    (wrongRunTransport.identity as { runId: string }).runId = IDS.other;
    expect(readDisabledBlurtingEvaluatorTransportV18(wrongRunTransport))
      .not.toBeNull();
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      wrongRunTransport,
      raw as never,
    )).toBeNull();

    const repairCapability = rawCapability(fixture, {
      deliveryReceipt: deliveryReceipt(fixture.pair, "repair"),
    });
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      repairCapability,
    ).success).toBe(true);
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      fixture.transport,
      repairCapability as never,
    )).toBeNull();

    const completedCapability = rawCapability(fixture, {
      deliveryReceipt: deliveryReceipt(fixture.pair, "complete"),
    });
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      fixture.transport,
      completedCapability as never,
    )).toBeNull();

    const retired = mutableClone(raw);
    (retired.loadedResourceRow as { state: string }).state = "retired";
    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse(
      retired,
    ).success).toBe(false);

    expect(DisabledBlurtingRepositoryExecutionCapabilityV18Schema.safeParse({
      ...raw,
      observedAt: EXPIRES_AT,
    }).success).toBe(false);

    const source = evaluatorSource();
    expect(source).toContain("transferDisclosure.stage !== \"transfer\"");
    expect(source).toContain("left.runId === right.runId");
  });

  it("rejects missing, reversed, or changed ordered bindings", () => {
    const fixture = buildFixture();
    const reversed = mutableClone(fixture.transport);
    reversed.orderedBindings.reverse();
    expect(readDisabledBlurtingEvaluatorTransportV18(reversed)).not.toBeNull();
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      reversed,
      rawCapability(fixture) as never,
    )).toBeNull();

    const missing = mutableClone(fixture.transport);
    missing.orderedBindings.pop();
    expect(readDisabledBlurtingEvaluatorTransportV18(missing)).not.toBeNull();
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      missing,
      rawCapability(fixture) as never,
    )).toBeNull();

    const changed = mutableClone(fixture.transport);
    changed.orderedBindings[0] = {
      targetId: IDS.other,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.other),
    } as unknown as typeof changed.orderedBindings[number];
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      changed,
      rawCapability(fixture) as never,
    )).toBeNull();
    expect(evaluatorSource()).toContain(
      "loadedResourceRow.data.publicPayload.orderedTargets",
    );
  });

  it("keeps the server-HMAC and repository capabilities opaque and unmintable from JSON", () => {
    const fixture = buildFixture();
    const rawJoin = rawCapability(fixture);

    expect(bindDisabledBlurtingEvaluationServerInputV18(
      fixture.transport,
      rawJoin as never,
    )).toBeNull();
    expect(bindDisabledBlurtingEvaluationServerInputV18(
      fixture.transport,
      JSON.parse(JSON.stringify(rawJoin)) as never,
    )).toBeNull();
    expect(createDisabledBlurtingEvaluationRequestDigestClaimV18(
      fixture.transport as never,
      requestClaim() as never,
    )).toBeNull();
  });

  it("defines the exact migration-006 request claim without learner or source text", () => {
    const claim = requestClaim();
    const snapshot = structuredClone(claim);

    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse(claim).success)
      .toBe(true);
    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse({
      ...claim,
      learnerAnswer: PRIVATE_ANSWER,
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse({
      ...claim,
      answerHmac: "ab".repeat(31),
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationRequestDigestClaimV18Schema.safeParse({
      ...claim,
      evaluationReceiptId: UPPERCASE_UUID,
    }).success).toBe(false);
    const serialized = JSON.stringify(claim);
    expect(serialized).not.toContain(PRIVATE_ANSWER);
    expect(serialized).not.toContain(SOURCE_TEXT);
    expect(serialized).not.toContain("PRIVATE_CONCEPT");
    expect(serialized).not.toContain("PRIVATE_TRANSFER_CRITERION");
    expect(serialized).not.toContain("PRIVATE_REFERENCE");
    expect(claim).toEqual(snapshot);
  });

  it("keeps result order and makes evaluator unavailability fail closed", () => {
    const evaluated = {
      evaluatorVersion: "blurting_target_evaluator_v1" as const,
      requestToken: IDS.request,
      resolution: "evaluated" as const,
      orderedResults: orderedResults(["secure", "needs_review"]),
    };
    const parsed = DisabledBlurtingEvaluationOutcomeV18Schema.safeParse(evaluated);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.orderedResults.map((result) => result.result))
      .toEqual([
      "secure",
      "needs_review",
    ]);

    expect(DisabledBlurtingEvaluationOutcomeV18Schema.safeParse({
      ...evaluated,
      resolution: "evaluator_unavailable",
      orderedResults: orderedResults(["secure", "unverified"]),
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationOutcomeV18Schema.safeParse({
      ...evaluated,
      resolution: "evaluator_unavailable",
      orderedResults: orderedResults(["unverified", "unverified"]),
    }).success).toBe(true);
    expect(DisabledBlurtingEvaluationOutcomeV18Schema.safeParse({
      ...evaluated,
      requestToken: UPPERCASE_UUID,
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationOutcomeV18Schema.safeParse({
      ...evaluated,
      orderedResults: [...orderedResults(["secure", "needs_review"]), {
        targetId: IDS.other,
        evidenceId: blurtingFinalCheckEvidenceId(IDS.other),
        result: "unverified",
      }, {
        targetId: IDS.request,
        evidenceId: blurtingFinalCheckEvidenceId(IDS.request),
        result: "unverified",
      }],
    }).success).toBe(false);
    expect(createDisabledBlurtingEvaluationOutcomeV18(
      buildFixture().transport as never,
      "evaluated",
      evaluated.orderedResults,
    )).toBeNull();
    expect(unavailableDisabledBlurtingEvaluationOutcomeV18(
      buildFixture().transport as never,
    )).toBeNull();
  });

  it("defines the exact migration-006 result claim and rejects insecure unavailable output", () => {
    const requestDigest = "cd".repeat(32);
    const resultClaim = resultClaimFixture();

    expect(resultClaim).toEqual({
      evaluationReceiptId: IDS.evaluationReceipt,
      requestDigest,
      resolution: "evaluated",
      orderedResults: orderedResults(["secure", "needs_review"]),
    });
    expect(DisabledBlurtingEvaluationResultDigestClaimV18Schema.safeParse(resultClaim).success)
      .toBe(true);

    expect(DisabledBlurtingEvaluationResultDigestClaimV18Schema.safeParse({
      ...resultClaim,
      resolution: "evaluator_unavailable",
      orderedResults: orderedResults(["secure", "unverified"]),
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationResultDigestClaimV18Schema.safeParse({
      ...resultClaim,
      targetResults: resultClaim.orderedResults,
    }).success).toBe(false);
    expect(DisabledBlurtingEvaluationResultDigestClaimV18Schema.safeParse({
      ...resultClaim,
      orderedResults: [{
        targetId: UPPERCASE_UUID,
        evidenceId: blurtingFinalCheckEvidenceId(UPPERCASE_UUID),
        result: "secure",
      }],
    }).success).toBe(false);
    expect(createDisabledBlurtingEvaluationResultDigestClaimV18(
      buildFixture().transport as never,
      requestClaim() as never,
      requestDigest as never,
      resultClaim as never,
    )).toBeNull();
  });

  it("does not let bare transport or JSON-wrapped branded inputs mint claims", () => {
    const fixture = buildFixture();
    const bareRoundTrip = JSON.parse(JSON.stringify(fixture.transport));

    expect(createDisabledBlurtingEvaluationOutcomeV18(
      fixture.transport as never,
      "evaluated",
      orderedResults(["secure", "needs_review"]),
    )).toBeNull();
    expect(createDisabledBlurtingEvaluationOutcomeV18(
      bareRoundTrip,
      "evaluated",
      orderedResults(["secure", "needs_review"]),
    )).toBeNull();
  });

  it("pins TypeScript claim keys and domains to migration 006", () => {
    const exactRequestClaim = requestClaim();
    const resultClaim = resultClaimFixture();
    const migration = sourceFile(
      "supabase/migrations/202608240006_blurting_resource_store_v18.sql",
    );
    const evaluatorSource = sourceFile(
      "src/lib/server/disabled-blurting-evaluator-contract.ts",
    );

    expect(DISABLED_BLURTING_ANSWER_HMAC_DOMAIN)
      .toBe("yova.blurting.answer_hmac.v18|");
    expect(DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN)
      .toBe("yova.blurting.evaluation_request.v18|");
    expect(DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN)
      .toBe("yova.blurting.evaluation_result.v18|");
    for (const domain of [
      DISABLED_BLURTING_ANSWER_HMAC_DOMAIN,
      DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
      DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
    ]) {
      expect(migration).toContain(domain);
    }

    expect(Object.keys(exactRequestClaim).sort()).toEqual([
      "activityIndex",
      "answerHmac",
      "deliveryReceiptId",
      "evaluationReceiptId",
      "evaluatorVersion",
      "requestToken",
      "resourceId",
      "routeIdentity",
      "runId",
      "userId",
    ]);
    expect(Object.keys(resultClaim).sort()).toEqual([
      "evaluationReceiptId",
      "orderedResults",
      "requestDigest",
      "resolution",
    ]);
    for (const sqlKey of [
      "evaluationReceiptId",
      "deliveryReceiptId",
      "resourceId",
      "userId",
      "routeIdentity",
      "planId",
      "sessionId",
      "routeRevisionId",
      "runId",
      "activityIndex",
      "requestToken",
      "answerHmac",
      "evaluatorVersion",
      "requestDigest",
      "resolution",
      "orderedResults",
    ]) {
      expect(migration).toContain(`'${sqlKey}'`);
    }
    expect(evaluatorSource).not.toContain("targetResults");
    expect(evaluatorSource).not.toContain("targetBindings");
    expect(evaluatorSource).not.toContain("createHmac");
    expect(evaluatorSource).not.toContain("process.env");
    expect(evaluatorSource).not.toContain("supabase");
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
  const transferReceipt = deliveryReceipt(pair, "transfer");
  const transport = {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_evaluator_transport_only" as const,
    requestToken: IDS.request,
    identity: {
      ...structuredClone(pair.publicPayload.identity),
      deliveryHandle: transferReceipt.deliveryHandle,
      runId: transferReceipt.runId,
      activityIndex: transferReceipt.activityIndex,
    },
    orderedBindings: targetBindings(),
    learnerAnswer: PRIVATE_ANSWER,
  };
  return { pair, loadedRow, transferReceipt, transport };
}

function bindFixture(
  fixture: ReturnType<typeof buildFixture>,
) {
  return bindDisabledBlurtingEvaluationServerInputV18(
    fixture.transport,
    rawCapability(fixture) as never,
  );
}

function rawCapability(
  fixture: ReturnType<typeof buildFixture>,
  overrides: Partial<{
    observedAt: string;
    deliveryReceipt: ReturnType<typeof deliveryReceipt>;
  }> = {},
) {
  return {
    authority: "server_loaded_blurting_execution_capability_v18" as const,
    observedAt: OBSERVED_AT,
    routeAuthority: {
      authority: "server_loaded_current_blurting_route_v18" as const,
      userId: IDS.user,
      planId: IDS.plan,
      sessionId: IDS.session,
      committedRouteRevisionId: IDS.route,
      routeRevisionId: IDS.route,
      routeLifecycle: "committed" as const,
      routeFingerprint: `sr1:${"d".repeat(64)}`,
      methodId: "retrieval_practice" as const,
      supportingTechniqueId: "blurting_v1" as const,
      executionEnvironment: "inside_yova" as const,
    },
    resource: fixture.pair.serverPayload,
    loadedResourceRow: fixture.loadedRow,
    deliveryReceipt: fixture.transferReceipt,
    ...overrides,
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
      sourceLabel: "Private source",
      locationLabel: "Section 1",
      contentDigest: sourceChunkDigest(SOURCE_TEXT),
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
      model: "PRIVATE_MODEL",
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
            prompt: "Reconstruct the two visible mechanisms and their relationship from memory.",
            expectedAnswer: "The mechanisms form one linked causal sequence.",
            hint: null,
          }],
          comparisonInstructions:
            "Only after the broad attempt, reopen the source and compare every configured gap.",
          gapChecklist: ["Visible gap for alpha", "Visible gap for beta"],
          correctionInstruction:
            "Close the source and repair only the relationships that were missing or inaccurate.",
          transferPrompt: {
            sourceClosedReminder:
              "Close the source again before answering the fresh transfer question.",
            prompt: "Predict the downstream change when the first mechanism is interrupted.",
            expectedAnswer: "The downstream mechanism loses its required condition.",
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
    concept: "PRIVATE_CONCEPT_ALPHA",
    comparisonCriterion:
      "PRIVATE_COMPARE_CRITERION_ALPHA identifies the first mechanism.",
    transferSuccessCriterion:
      "PRIVATE_TRANSFER_CRITERION_ALPHA predicts the first downstream change.",
  }, {
    targetId: IDS.secondTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
    concept: "PRIVATE_CONCEPT_BETA",
    comparisonCriterion:
      "PRIVATE_COMPARE_CRITERION_BETA identifies the second mechanism.",
    transferSuccessCriterion:
      "PRIVATE_TRANSFER_CRITERION_BETA predicts the second downstream change.",
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
  }];
}

function evaluationReferences() {
  return [{
    ...targetBindings()[0]!,
    referenceAnswer: "PRIVATE_REFERENCE_ALPHA explains the first target.",
  }, {
    ...targetBindings()[1]!,
    referenceAnswer: "PRIVATE_REFERENCE_BETA explains the second target.",
  }];
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
  const stages = ["recall", "compare", "repair", "transfer", "complete"];
  const stageIndex = stages.indexOf(disclosureStage);
  const disclosedAt = [
    "2026-08-25T05:05:10.000Z",
    "2026-08-25T05:05:20.000Z",
    "2026-08-25T05:05:30.000Z",
    "2026-08-25T05:05:40.000Z",
    "2026-08-25T05:05:50.000Z",
  ].map((timestamp, index) => index <= stageIndex ? timestamp : null);
  const resourceIdentity = {
    resourceId: IDS.resource,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: GENERATED_AT,
    publicPayloadDigest: pair.serverPayload.canonicalDigests.publicPayloadDigest,
    resourceDigest: pair.serverPayload.canonicalDigests.resourceDigest,
  };
  const receiptDigest = digestCanonicalJson(
    DISABLED_BLURTING_RESOURCE_DIGEST_DOMAINS.deliveryReceipt,
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

function targetIds() {
  return [IDS.firstTarget, IDS.secondTarget];
}

function targetBindings() {
  return targetIds().map((targetId) => ({
    targetId,
    evidenceId: blurtingFinalCheckEvidenceId(targetId),
  }));
}

function orderedResults(
  results: readonly ("secure" | "needs_review" | "unverified")[],
) {
  return targetBindings().slice(0, results.length).map((binding, index) => ({
    ...binding,
    result: results[index]!,
  }));
}

function requestClaim() {
  return {
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
    answerHmac: "ab".repeat(32),
    evaluatorVersion: "blurting_target_evaluator_v1" as const,
  };
}

function resultClaimFixture() {
  return {
    evaluationReceiptId: IDS.evaluationReceipt,
    requestDigest: "cd".repeat(32),
    resolution: "evaluated" as const,
    orderedResults: orderedResults(["secure", "needs_review"]),
  };
}

function sourceChunkDigest(value: string) {
  return createHash("sha256")
    .update("yova.blurting.source_chunk.v1|")
    .update(JSON.stringify(value))
    .digest("hex");
}

function digestCanonicalJson(domain: string, value: unknown) {
  return createHash("sha256")
    .update(domain)
    .update(disabledBlurtingCanonicalJsonV18(value))
    .digest("hex");
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, child]) => {
    keys.push(key);
    collectKeys(child, keys);
  });
  return keys;
}

function sourceFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function evaluatorSource() {
  return sourceFile("src/lib/server/disabled-blurting-evaluator-contract.ts");
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected fixture value.");
  return value;
}

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

type Mutable<T> = T extends object
  ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

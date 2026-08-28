import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  recordBroadRecallTransferEvaluation,
  startBroadRecallProgress,
} from "@/lib/learning/broad-recall-progress";
import {
  deriveDisabledBlurtingVerifiedTransferEvidenceV18,
} from "@/lib/server/disabled-blurting-verified-evidence-v18";
import {
  DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
  DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
  createDisabledBlurtingVerifiedCompletionContextV18,
} from "@/lib/server/disabled-blurting-verified-completion-v18";
import {
  BLURTING_PHASE_IDS,
  blurtingFinalCheckEvidenceId,
} from "@/lib/study-route/method-recipe-contract";

const IDS = {
  user: "97000000-0000-4000-8000-000000000001",
  receipt: "97000000-0000-4000-8000-000000000002",
  resource: "97000000-0000-4000-8000-000000000012",
  plan: "97000000-0000-4000-8000-000000000003",
  session: "97000000-0000-4000-8000-000000000004",
  route: "97000000-0000-4000-8000-000000000005",
  delivery: "97000000-0000-4000-8000-000000000006",
  run: "97000000-0000-4000-8000-000000000007",
  request: "97000000-0000-4000-8000-000000000008",
  firstTarget: "97000000-0000-4000-8000-000000000009",
  secondTarget: "97000000-0000-4000-8000-000000000010",
  other: "97000000-0000-4000-8000-000000000011",
} as const;

describe("disabled Blurting verified evidence V18", () => {
  it("cannot mint completion or evidence from raw authority-shaped JSON", () => {
    const rawJoin = repositoryCompletionJoin(["secure", "needs_review"]);
    const rawCapability = {
      authority: "server_loaded_blurting_execution_capability_v18",
      orderedTargets: [{
        ...targetBindings()[0],
        concept: "CLIENT CONTROLLED CONCEPT",
      }],
    };
    const snapshot = structuredClone({ rawJoin, rawCapability });

    const completion = createDisabledBlurtingVerifiedCompletionContextV18(
      rawJoin as never,
      {
        userId: IDS.user,
        identity: identity(),
        resourceIdentity: resourceIdentity(),
        orderedBindings: targetBindings(),
      },
    );
    expect(completion).toBeNull();
    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      rawCompletionShape(["secure", "needs_review"]) as never,
      rawCapability as never,
    )).toBeNull();
    expect({ rawJoin, rawCapability }).toEqual(snapshot);
  });

  it("has no caller-authored concept/order expectation input", () => {
    const clientExpectation = {
      userId: IDS.user,
      orderedTargets: targetBindings().map((target, index) => ({
        ...target,
        concept: index === 0 ? "CLIENT CONCEPT" : "OTHER CLIENT CONCEPT",
      })),
      learnerAnswer: "PRIVATE LEARNER ANSWER",
    };
    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      rawCompletionShape(["secure", "needs_review"]) as never,
      clientExpectation as never,
    )).toBeNull();

    const source = readFileSync(join(
      process.cwd(),
      "src/lib/server/disabled-blurting-verified-evidence-v18.ts",
    ), "utf8");
    expect(source).toContain(
      "const publicTargets = row.publicPayload.orderedTargets;",
    );
    expect(source).toContain(
      "const targets = capability.resource.session.orderedTargets;",
    );
    expect(source).not.toContain("EvidenceExpectation");
    expect(source).not.toContain("expectationValue");
  });

  it("cannot derive evidence from browser progress, results, or public DTOs", () => {
    const progress = completedBrowserProgress();
    const resultVector = rawResults(["secure", "needs_review"]);
    const publicProjection = {
      evaluationReceiptHandle: IDS.receipt,
      requestToken: IDS.request,
      evaluatorVersion: "blurting_target_evaluator_v1",
      resolution: "evaluated",
      orderedResults: resultVector,
    };

    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      progress as never,
      {} as never,
    )).toBeNull();
    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      resultVector as never,
      {} as never,
    )).toBeNull();
    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      publicProjection as never,
      {} as never,
    )).toBeNull();
    expect(deriveDisabledBlurtingVerifiedTransferEvidenceV18(
      rawCompletionShape(["secure", "needs_review"]) as never,
      {} as never,
    )).toBeNull();
  });
});

function repositoryCompletionJoin(
  results: readonly ("secure" | "needs_review" | "unverified")[],
  resolution: "evaluated" | "evaluator_unavailable" = "evaluated",
) {
  return {
    authority: "server_loaded_blurting_completion_join_v18" as const,
    resourceRow: {
      authority: "server_loaded_blurting_resource_row_v18" as const,
      resourceId: IDS.resource,
      userId: IDS.user,
      routeIdentity: {
        planId: IDS.plan,
        sessionId: IDS.session,
        routeRevisionId: IDS.route,
      },
      resourceFingerprint: resourceIdentity().resourceFingerprint,
      resourceGeneratedAt: resourceIdentity().resourceGeneratedAt,
      state: "ready" as const,
      resourceDigest: resourceIdentity().resourceDigest,
      publicPayload: publicResourceTemplate(),
    },
    deliveryReceipt: {
      authority: "blurting_delivery_receipt_v18" as const,
      state: "completed" as const,
      deliveryHandle: IDS.delivery,
      userId: IDS.user,
      runId: IDS.run,
      activityIndex: 2,
      routeIdentity: {
        planId: IDS.plan,
        sessionId: IDS.session,
        routeRevisionId: IDS.route,
      },
      resourceIdentity: resourceIdentity(),
      issuedAt: "2026-08-25T08:00:00.000Z",
      expiresAt: "2026-09-02T08:00:00.000Z",
      disclosureStage: "complete" as const,
      recallDisclosedAt: "2026-08-25T08:00:10.000Z",
      compareDisclosedAt: "2026-08-25T08:00:20.000Z",
      repairDisclosedAt: "2026-08-25T08:00:30.000Z",
      transferDisclosedAt: "2026-08-25T08:00:40.000Z",
      completeDisclosedAt: "2026-08-25T08:00:50.000Z",
    },
    evaluationReceipt: evaluationReceiptRow(results, resolution),
  };
}

function rawCompletionShape(
  results: readonly ("secure" | "needs_review" | "unverified")[],
) {
  const evaluation = evaluationReceiptRow(results);
  return {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_server_loaded_completion_only" as const,
    receipt: {
      authority: "verified_loaded_evaluation_row" as const,
      evaluationReceiptHandle: IDS.receipt,
      deliveryReceiptHandle: IDS.delivery,
      resourceId: IDS.resource,
      resourceDigest: resourceIdentity().resourceDigest,
      userId: IDS.user,
      requestDigest: evaluation.requestDigest,
      resultDigest: evaluation.resultDigest,
    },
    identity: identity(),
    requestToken: IDS.request,
    evaluatorVersion: "blurting_target_evaluator_v1" as const,
    resolution: "evaluated" as const,
    orderedResults: rawResults(results),
  };
}

function publicResourceTemplate() {
  const targets = targetBindings();
  return {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_public_resource_template_only" as const,
    identity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.route,
      resourceFingerprint: resourceIdentity().resourceFingerprint,
      resourceGeneratedAt: resourceIdentity().resourceGeneratedAt,
    },
    orderedTargets: targets.map((target, index) => ({
      ...target,
      displayLabel: index === 0 ? "First mechanism" : "Second mechanism",
    })),
    phaseMetadata: [{
      phaseId: BLURTING_PHASE_IDS[0],
      methodPhase: "retrieve" as const,
      activeMinutes: 4,
      targetIds: targets.map((target) => target.targetId),
    }, {
      phaseId: BLURTING_PHASE_IDS[1],
      methodPhase: "repair" as const,
      activeMinutes: 4,
      targetIds: targets.map((target) => target.targetId),
    }, {
      phaseId: BLURTING_PHASE_IDS[2],
      methodPhase: "transfer" as const,
      activeMinutes: 4,
      targetIds: targets.map((target) => target.targetId),
    }] as const,
    gapCount: 2,
    initialRecall: {
      sourceClosedReminder: "Close the source before recalling the mechanisms.",
      prompt: "Reconstruct both mechanisms from memory.",
    },
  };
}

function evaluationReceiptRow(
  results: readonly ("secure" | "needs_review" | "unverified")[],
  resolution: "evaluated" | "evaluator_unavailable" = "evaluated",
) {
  const resultVector = rawResults(results);
  const requestClaim = {
    evaluationReceiptId: IDS.receipt,
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
  const requestDigest = digestCanonicalJson(
    DISABLED_BLURTING_EVALUATION_REQUEST_DIGEST_DOMAIN,
    requestClaim,
  );
  const resultDigest = digestCanonicalJson(
    DISABLED_BLURTING_EVALUATION_RESULT_DIGEST_DOMAIN,
    {
      evaluationReceiptId: IDS.receipt,
      requestDigest,
      resolution,
      orderedResults: resultVector,
    },
  );
  return {
    authority: "server_loaded_blurting_evaluation_receipt_v18" as const,
    ...requestClaim,
    state: resolution === "evaluated" ? "succeeded" as const : "unavailable" as const,
    resultVector,
    requestDigest,
    resultDigest,
    issuedAt: "2026-08-25T08:00:10.000Z",
    leasedUntil: null,
    completedAt: "2026-08-25T08:00:50.000Z",
    expiresAt: "2026-09-24T08:00:10.000Z",
  };
}

function resourceIdentity() {
  return {
    resourceId: IDS.resource,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: "2026-08-25T08:00:00.000Z",
    resourceDigest: "c".repeat(64),
  };
}

function identity() {
  return {
    planId: IDS.plan,
    sessionId: IDS.session,
    routeRevisionId: IDS.route,
    resourceFingerprint: "sr1:0123456789abcdef",
    resourceGeneratedAt: "2026-08-25T08:00:00.000Z",
    deliveryHandle: IDS.delivery,
    runId: IDS.run,
    activityIndex: 2,
  };
}

function targetBindings() {
  return [{
    targetId: IDS.firstTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.firstTarget),
  }, {
    targetId: IDS.secondTarget,
    evidenceId: blurtingFinalCheckEvidenceId(IDS.secondTarget),
  }];
}

function rawResults(
  results: readonly ("secure" | "needs_review" | "unverified")[],
) {
  return targetBindings().map((binding, index) => ({
    ...binding,
    result: results[index],
  }));
}

function completedBrowserProgress() {
  const started = startBroadRecallProgress({
    activityIndex: 2,
    gapCount: 1,
    bindings: targetBindings(),
  });
  if (!started) throw new Error("Expected browser progress fixture.");
  const compared = completeBroadRecallComparison(started, ["partial"]);
  if (!compared) throw new Error("Expected comparison fixture.");
  const corrected = completeBroadRecallCorrection(compared);
  if (!corrected) throw new Error("Expected correction fixture.");
  const complete = recordBroadRecallTransferEvaluation(corrected, [
    "secure",
    "needs_review",
  ]);
  if (!complete) throw new Error("Expected completion fixture.");
  return complete;
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
  return `{${Object.keys(objectValue).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`
  )).join(",")}}`;
}

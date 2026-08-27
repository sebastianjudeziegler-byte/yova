import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BroadRecallRuntime } from "@/components/broad-recall-runtime";
import {
  BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS,
  BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS,
  broadRecallRuntimeInstanceKey,
  completeBroadRecallTransferEvaluation,
  createBroadRecallRuntimeController,
  createBroadRecallTransferEvaluationTransport,
  currentBroadRecallRuntimeDelivery,
  isBroadRecallRuntimeInteractive,
  isSubmittableBroadRecallTransferAnswer,
  nextBroadRecallRuntimeRequestedStage,
  transitionBroadRecallRuntime,
  type BroadRecallRuntimeAction,
  type BroadRecallRuntimeControllerState,
  type BroadRecallRuntimeReadyState,
  type BroadRecallRuntimeRequestedStage,
} from "@/components/broad-recall-runtime-controller";
import {
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  recordBroadRecallTransferEvaluation,
  startBroadRecallProgress,
  type BroadRecallProgress,
  type BroadRecallTransferResult,
} from "@/lib/learning/broad-recall-progress";
import { broadRecallSupportPolicyAfterReload } from "@/lib/learning/broad-recall-support-policy";
import {
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

const IDS = {
  plan: "71000000-0000-4000-8000-000000000001",
  session: "71000000-0000-4000-8000-000000000002",
  revision: "71000000-0000-4000-8000-000000000003",
  targetA: "71000000-0000-4000-8000-000000000004",
  targetB: "71000000-0000-4000-8000-000000000005",
  delivery: "71000000-0000-4000-8000-000000000006",
  run: "71000000-0000-4000-8000-000000000007",
  evaluation: "71000000-0000-4000-8000-000000000008",
  request: "71000000-0000-4000-8000-000000000009",
  other: "71000000-0000-4000-8000-000000000010",
};

const PRIVATE_RECALL = "PRIVATE RECALL: use the product rule on both factors.";
const PRIVATE_CORRECTION = "PRIVATE CORRECTION: the second product term was missing.";
const PRIVATE_TRANSFER = "PRIVATE TRANSFER: differentiate each factor in turn.";
const GAP_STATUSES = ["covered", "missing"] as const;
const COMPLETE_RESULTS = ["unverified", "secure"] as const;
const STAGES = ["recall", "compare", "repair", "transfer", "complete"] as const;

function publicDelivery(
  stage: typeof STAGES[number],
  requestToken = IDS.request,
) {
  const targetIds = [IDS.targetA, IDS.targetB];
  const common = {
    schemaVersion: 18 as const,
    boundaryStatus: "disabled_public_contract_only" as const,
    identity: {
      planId: IDS.plan,
      sessionId: IDS.session,
      routeRevisionId: IDS.revision,
      resourceFingerprint: "sr1:0123456789abcdef",
      resourceGeneratedAt: "2026-08-25T08:00:00.000Z",
      deliveryHandle: IDS.delivery,
      runId: IDS.run,
      activityIndex: 4,
    },
    orderedTargets: [{
      targetId: IDS.targetA,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.targetA),
      displayLabel: "Product-rule structure",
    }, {
      targetId: IDS.targetB,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.targetB),
      displayLabel: "Derivative explanation",
    }],
    phaseMetadata: [{
      phaseId: "method-1-retrieve" as const,
      methodPhase: "retrieve" as const,
      activeMinutes: 4,
      targetIds,
    }, {
      phaseId: "method-2-repair" as const,
      methodPhase: "repair" as const,
      activeMinutes: 4,
      targetIds,
    }, {
      phaseId: "method-3-transfer" as const,
      methodPhase: "transfer" as const,
      activeMinutes: 4,
      targetIds,
    }],
    gapCount: 2,
  };

  if (stage === "recall") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Close the exact saved source before recalling.",
      prompt: "RECALL PROMPT: reconstruct the derivative product rule.",
    };
  }
  if (stage === "compare") {
    return {
      ...common,
      stage,
      comparisonInstructions: "COMPARE INSTRUCTION: compare only after recalling.",
      savedSourceAnswer: "SAVED SOURCE: the derivative of fg is f'g + fg'.",
      gapChecklist: [
        "Both product terms are present.",
        "Each differentiated factor is identified.",
      ],
    };
  }
  if (stage === "repair") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Close the exact saved source before repairing.",
      correctionInstruction: "REPAIR INSTRUCTION: correct the missing relationship.",
    };
  }
  if (stage === "transfer") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Keep the exact saved source closed for transfer.",
      prompt: "TRANSFER PROMPT: differentiate x squared times sine x.",
      answerConstraints: {
        minCharacters: DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
        maxCharacters: DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
      },
    };
  }
  return {
    ...common,
    stage,
    orderedReferences: [{
      targetId: IDS.targetA,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.targetA),
      referenceAnswer: "REFERENCE A: differentiate the first factor.",
    }, {
      targetId: IDS.targetB,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.targetB),
      referenceAnswer: "REFERENCE B: differentiate the second factor.",
    }],
    completion: {
      evaluationReceiptHandle: IDS.evaluation,
      requestToken,
      evaluatorVersion: "blurting_target_evaluator_v1" as const,
      resolution: "evaluated" as const,
      orderedResults: [{
        targetId: IDS.targetA,
        evidenceId: blurtingFinalCheckEvidenceId(IDS.targetA),
        result: COMPLETE_RESULTS[0],
      }, {
        targetId: IDS.targetB,
        evidenceId: blurtingFinalCheckEvidenceId(IDS.targetB),
        result: COMPLETE_RESULTS[1],
      }],
    },
  };
}

function progressAtRank(
  rank: 0 | 1 | 2 | 3,
  results: readonly BroadRecallTransferResult[] = COMPLETE_RESULTS,
): BroadRecallProgress {
  const recall = publicDelivery("recall");
  const started = startBroadRecallProgress({
    activityIndex: recall.identity.activityIndex,
    gapCount: recall.gapCount,
    bindings: recall.orderedTargets.map(({ targetId, evidenceId }) => ({
      targetId,
      evidenceId,
    })),
  });
  if (!started) throw new Error("Expected valid progress fixture.");
  if (rank === 0) return started;

  const compared = completeBroadRecallComparison(started, GAP_STATUSES);
  if (!compared) throw new Error("Expected comparison progress fixture.");
  if (rank === 1) return compared;

  const repaired = completeBroadRecallCorrection(compared);
  if (!repaired) throw new Error("Expected repair progress fixture.");
  if (rank === 2) return repaired;

  const completed = recordBroadRecallTransferEvaluation(repaired, results);
  if (!completed) throw new Error("Expected completion progress fixture.");
  return completed;
}

function ready(
  stage: typeof STAGES[number],
  rank: 0 | 1 | 2 | 3,
): BroadRecallRuntimeReadyState {
  const state = createBroadRecallRuntimeController({
    initialDelivery: publicDelivery(stage),
    initialProgress: progressAtRank(rank),
  });
  if (!isBroadRecallRuntimeInteractive(state)) {
    throw new Error(`Expected ready state, received ${state.kind}.`);
  }
  return state;
}

function apply(
  state: BroadRecallRuntimeControllerState,
  action: BroadRecallRuntimeAction,
) {
  return transitionBroadRecallRuntime(state, action);
}

function stateAfter(
  state: BroadRecallRuntimeControllerState,
  action: BroadRecallRuntimeAction,
) {
  const next = apply(state, action).state;
  if (!isBroadRecallRuntimeInteractive(next)) {
    throw new Error(`Expected interactive state, received ${next.kind}.`);
  }
  return next;
}

function receive(
  state: BroadRecallRuntimeControllerState,
  next: unknown,
  requestedStage: BroadRecallRuntimeRequestedStage,
  completionRequestToken?: string,
) {
  return apply(state, {
    type: "server_delivery_received",
    delivery: next,
    requestedStage,
    completionRequestToken,
  });
}

describe("staged broad-recall runtime controller", () => {
  it("accepts only the exact five-stage by four-rank recovery matrix", () => {
    const expectedRank = {
      recall: 0,
      compare: 0,
      repair: 1,
      transfer: 2,
      complete: 3,
    } as const;

    for (const stage of STAGES) {
      for (const rank of [0, 1, 2, 3] as const) {
        const state = createBroadRecallRuntimeController({
          initialDelivery: publicDelivery(stage),
          initialProgress: progressAtRank(rank),
        });
        expect(state.kind, `${stage} with rank ${rank}`).toBe(
          rank === expectedRank[stage] ? "ready" : "conflict",
        );
      }
    }
  });

  it("requires complete recovery results to exactly match the delivered order", () => {
    const mismatched = createBroadRecallRuntimeController({
      initialDelivery: publicDelivery("complete"),
      initialProgress: progressAtRank(3, ["secure", "unverified"]),
    });
    const malformed = createBroadRecallRuntimeController({
      initialDelivery: publicDelivery("recall"),
      initialProgress: { kind: "broad_recall" },
    });

    expect(mismatched.kind).toBe("conflict");
    expect(malformed.kind).toBe("invalid");
  });

  it("derives exact progress identity from the public envelope", () => {
    const base = progressAtRank(0);
    const differentActivity = { ...base, activityIndex: 5 };
    const reversedBindings = {
      ...base,
      bindings: [...base.bindings].reverse(),
    };
    const differentGapCount = { ...base, gapCount: 1 };

    for (const initialProgress of [
      differentActivity,
      reversedBindings,
      differentGapCount,
    ]) {
      expect(createBroadRecallRuntimeController({
        initialDelivery: publicDelivery("recall"),
        initialProgress,
      }).kind).toBe("conflict");
    }
  });

  it("advances only on accepted adjacent server deliveries and appends events atomically", () => {
    let state = ready("recall", 0);
    state = stateAfter(state, { type: "recall_changed", value: PRIVATE_RECALL });

    const compared = receive(state, publicDelivery("compare"), "compare");
    expect(compared.deliveryOutcome).toEqual({
      kind: "accepted",
      mode: "advanced_one_stage",
    });
    expect(compared.progressToPersist).toBeNull();
    state = compared.state as BroadRecallRuntimeReadyState;
    expect(currentBroadRecallRuntimeDelivery(state).stage).toBe("compare");
    expect(state.recallDraft).toBe(PRIVATE_RECALL);
    expect(JSON.stringify(state)).not.toContain("RECALL PROMPT");

    state = stateAfter(state, {
      type: "gap_classified",
      index: 0,
      status: GAP_STATUSES[0],
    });
    state = stateAfter(state, {
      type: "gap_classified",
      index: 1,
      status: GAP_STATUSES[1],
    });
    const repaired = receive(state, publicDelivery("repair"), "repair");
    expect(repaired.progressToPersist?.events).toEqual([{
      type: "comparison_completed",
      gapStatuses: GAP_STATUSES,
    }]);
    expect(JSON.stringify(repaired.progressToPersist)).not.toContain(PRIVATE_RECALL);
    state = repaired.state as BroadRecallRuntimeReadyState;
    expect(state.recallDraft).toBe("");
    expect(JSON.stringify(state)).not.toContain("SAVED SOURCE");

    state = stateAfter(state, {
      type: "correction_changed",
      value: PRIVATE_CORRECTION,
    });
    const transferred = receive(state, publicDelivery("transfer"), "transfer");
    expect(transferred.progressToPersist?.events).toHaveLength(2);
    expect(JSON.stringify(transferred.progressToPersist)).not.toContain(
      PRIVATE_CORRECTION,
    );
    state = transferred.state as BroadRecallRuntimeReadyState;
    expect(state.correctionDraft).toBe("");
    expect(JSON.stringify(state)).not.toContain("REPAIR INSTRUCTION");

    state = stateAfter(state, {
      type: "transfer_changed",
      value: PRIVATE_TRANSFER,
    });
    const completed = receive(
      state,
      publicDelivery("complete"),
      "complete",
      IDS.request,
    );
    expect(completed.progressToPersist?.events[2]).toEqual({
      type: "transfer_evaluated",
      results: COMPLETE_RESULTS,
    });
    expect(JSON.stringify(completed.progressToPersist)).not.toContain(
      PRIVATE_TRANSFER,
    );
    state = completed.state as BroadRecallRuntimeReadyState;
    expect(state.transferDraft).toBe("");
    expect(currentBroadRecallRuntimeDelivery(state).stage).toBe("complete");
    expect(JSON.stringify(state)).not.toContain("TRANSFER PROMPT");
  });

  it("does not append a milestone on a local action before its server stage", () => {
    let recall = ready("recall", 0);
    const changedRecall = apply(recall, {
      type: "recall_changed",
      value: PRIVATE_RECALL,
    });
    expect(changedRecall.progressToPersist).toBeNull();
    recall = changedRecall.state as BroadRecallRuntimeReadyState;
    expect(nextBroadRecallRuntimeRequestedStage(recall)).toBe("compare");

    let compare = ready("compare", 0);
    compare = stateAfter(compare, {
      type: "gap_classified",
      index: 0,
      status: "covered",
    });
    const classified = apply(compare, {
      type: "gap_classified",
      index: 1,
      status: "missing",
    });
    expect(classified.progressToPersist).toBeNull();
    expect(nextBroadRecallRuntimeRequestedStage(classified.state)).toBe("repair");
  });

  it("preserves the exact state and progress on replay, skip, backtrack, or mismatch", () => {
    const withDraft = stateAfter(ready("recall", 0), {
      type: "recall_changed",
      value: PRIVATE_RECALL,
    });
    const replay = receive(withDraft, structuredClone(publicDelivery("recall")), "compare");
    expect(replay.deliveryOutcome).toEqual({
      kind: "accepted",
      mode: "idempotent_replay",
    });
    expect(replay.state).toBe(withDraft);
    expect(replay.progressToPersist).toBeNull();

    const skipped = receive(withDraft, publicDelivery("repair"), "repair");
    expect(skipped.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "stage_skip",
    });
    expect(skipped.state).toBe(withDraft);

    const wrongRequest = receive(withDraft, publicDelivery("compare"), "repair");
    expect(wrongRequest.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "stage_not_requested",
    });
    expect(wrongRequest.state).toBe(withDraft);

    const transfer = ready("transfer", 2);
    const backtrack = receive(transfer, publicDelivery("repair"), "complete");
    expect(backtrack.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "stage_backtrack",
    });
    expect(backtrack.state).toBe(transfer);

    const changedIdentity = structuredClone(publicDelivery("compare"));
    changedIdentity.identity.runId = IDS.other;
    const mismatch = receive(withDraft, changedIdentity, "compare");
    expect(mismatch.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "identity_mismatch",
    });
    expect(mismatch.state).toBe(withDraft);
  });

  it("refuses an adjacent stage when the required local attempt is absent", () => {
    const recall = ready("recall", 0);
    const compare = ready("compare", 0);
    const repair = ready("repair", 1);

    expect(receive(recall, publicDelivery("compare"), "compare"))
      .toMatchObject({
        state: recall,
        progressToPersist: null,
        deliveryOutcome: { kind: "rejected", reason: "stage_progress_mismatch" },
      });
    expect(receive(compare, publicDelivery("repair"), "repair"))
      .toMatchObject({
        state: compare,
        progressToPersist: null,
        deliveryOutcome: { kind: "rejected", reason: "stage_progress_mismatch" },
      });
    expect(receive(repair, publicDelivery("transfer"), "transfer"))
      .toMatchObject({
        state: repair,
        progressToPersist: null,
        deliveryOutcome: { kind: "rejected", reason: "stage_progress_mismatch" },
      });
  });

  it("clears every ephemeral value on exact recovery, including explicit compare recovery", () => {
    for (const [stage, rank] of [
      ["recall", 0],
      ["compare", 0],
      ["repair", 1],
      ["transfer", 2],
      ["complete", 3],
    ] as const) {
      const state = ready(stage, rank);
      expect(state.recallDraft).toBe("");
      expect(state.correctionDraft).toBe("");
      expect(state.transferDraft).toBe("");
      expect(state.gapStatuses.every((status) => status === null)).toBe(true);
      expect(state.view).toBe(({
        recall: "recall_closed",
        compare: "compare_open",
        repair: "repair_open",
        transfer: "transfer_closed",
        complete: "complete",
      } as const)[stage]);
    }
  });

  it("does not let rank-zero progress alone select comparison disclosure", () => {
    const progress = progressAtRank(0);
    const progressOnlyPolicy = broadRecallSupportPolicyAfterReload(progress);
    const recall = createBroadRecallRuntimeController({
      initialDelivery: publicDelivery("recall"),
      initialProgress: progress,
    });
    const explicitCompare = createBroadRecallRuntimeController({
      initialDelivery: publicDelivery("compare"),
      initialProgress: progress,
    });

    expect(progressOnlyPolicy.sourceComparison).toBe("denied");
    expect(recall).toMatchObject({ kind: "ready", view: "recall_closed" });
    expect(explicitCompare).toMatchObject({ kind: "ready", view: "compare_open" });
  });

  it("keeps exactly one public stage and no private runtime authority in state", () => {
    const forbiddenKeys = [
      "expected" + "Answer",
      "comparison" + "Criterion",
      "transfer" + "SuccessCriterion",
      "semantic" + "Criteria",
      "source" + "Anchor",
    ];
    const stageOnlyFields = {
      recall: ["prompt", "sourceClosedReminder"],
      compare: ["comparisonInstructions", "savedSourceAnswer", "gapChecklist"],
      repair: ["sourceClosedReminder", "correctionInstruction"],
      transfer: ["sourceClosedReminder", "prompt", "answerConstraints"],
      complete: ["orderedReferences", "completion"],
    } as const;

    for (const [stage, rank] of [
      ["recall", 0],
      ["compare", 0],
      ["repair", 1],
      ["transfer", 2],
      ["complete", 3],
    ] as const) {
      const serialized = JSON.stringify(ready(stage, rank));
      for (const key of forbiddenKeys) expect(serialized).not.toContain(key);
      for (const otherStage of STAGES) {
        if (otherStage === stage) continue;
        for (const field of stageOnlyFields[otherStage]) {
          if (!stageOnlyFields[stage].includes(field as never)) {
            expect(serialized).not.toContain(`\"${field}\"`);
          }
        }
      }
    }
  });

  it("uses the exact V18 canonical Unicode transfer-answer domain", () => {
    expect(BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS).toBe(
      DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
    );
    expect(BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS).toBe(
      DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
    );
    for (const invalid of [
      "x",
      " xx",
      "xx ",
      "\u00a0xx",
      "xx\u00a0",
      "x\0x",
      "x\ud800x",
    ]) {
      expect(isSubmittableBroadRecallTransferAnswer(invalid), invalid).toBe(false);
    }
    expect(isSubmittableBroadRecallTransferAnswer("😀".repeat(3_000))).toBe(true);
    expect(isSubmittableBroadRecallTransferAnswer("😀".repeat(3_001))).toBe(false);

    const astralState = stateAfter(ready("transfer", 2), {
      type: "transfer_changed",
      value: "😀".repeat(3_000),
    });
    expect(nextBroadRecallRuntimeRequestedStage(astralState)).toBe("complete");
  });

  it("constructs the strict transport and sends the learner answer nowhere else", () => {
    const state = stateAfter(ready("transfer", 2), {
      type: "transfer_changed",
      value: PRIVATE_TRANSFER,
    });
    const transport = createBroadRecallTransferEvaluationTransport(
      state,
      IDS.request,
    );

    expect(transport).toEqual({
      schemaVersion: 18,
      boundaryStatus: "disabled_evaluator_transport_only",
      requestToken: IDS.request,
      identity: publicDelivery("transfer").identity,
      orderedBindings: publicDelivery("transfer").orderedTargets.map(
        ({ targetId, evidenceId }) => ({ targetId, evidenceId }),
      ),
      learnerAnswer: PRIVATE_TRANSFER,
    });
    expect(JSON.stringify(state.progress)).not.toContain(PRIVATE_TRANSFER);
  });

  it("requires a token-matched complete delivery before recording evaluator results", async () => {
    const state = stateAfter(ready("transfer", 2), {
      type: "transfer_changed",
      value: PRIVATE_TRANSFER,
    });
    const evaluator = vi.fn(async ({ transport }: {
      transport: NonNullable<ReturnType<
        typeof createBroadRecallTransferEvaluationTransport
      >>;
    }) => publicDelivery("complete", transport.requestToken));

    const result = await completeBroadRecallTransferEvaluation(state, {
      evaluator,
      requestToken: IDS.request,
      signal: new AbortController().signal,
    });

    expect(evaluator).toHaveBeenCalledOnce();
    expect(evaluator.mock.calls[0]?.[0].transport.learnerAnswer).toBe(
      PRIVATE_TRANSFER,
    );
    expect(result.deliveryOutcome).toEqual({
      kind: "accepted",
      mode: "advanced_one_stage",
    });
    expect(result.progressToPersist?.events[2]).toEqual({
      type: "transfer_evaluated",
      results: COMPLETE_RESULTS,
    });
    const completed = result.state as BroadRecallRuntimeReadyState;
    expect(currentBroadRecallRuntimeDelivery(completed).stage).toBe("complete");
    expect(JSON.stringify(currentBroadRecallRuntimeDelivery(completed))).toContain(
      "REFERENCE A",
    );
  });

  it("rejects bare rows, foreign completion tokens, and cancelled evaluation", async () => {
    const state = stateAfter(ready("transfer", 2), {
      type: "transfer_changed",
      value: PRIVATE_TRANSFER,
    });

    const bareRows = await completeBroadRecallTransferEvaluation(state, {
      evaluator: async () => [{ result: "secure" }],
      requestToken: IDS.request,
      signal: new AbortController().signal,
    });
    expect(bareRows.state).toBe(state);
    expect(bareRows.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "invalid_delivery",
    });
    expect(bareRows.progressToPersist).toBeNull();

    const foreign = await completeBroadRecallTransferEvaluation(state, {
      evaluator: async () => publicDelivery("complete", IDS.other),
      requestToken: IDS.request,
      signal: new AbortController().signal,
    });
    expect(foreign.state).toBe(state);
    expect(foreign.deliveryOutcome).toEqual({
      kind: "rejected",
      reason: "completion_request_mismatch",
    });
    expect(foreign.progressToPersist).toBeNull();

    const cancelledEvaluator = vi.fn(async () => publicDelivery("complete"));
    const cancelled = new AbortController();
    cancelled.abort();
    const aborted = await completeBroadRecallTransferEvaluation(state, {
      evaluator: cancelledEvaluator,
      requestToken: IDS.request,
      signal: cancelled.signal,
    });
    expect(cancelledEvaluator).not.toHaveBeenCalled();
    expect(aborted.state).toBe(state);
    expect(aborted.operationFailure).toBe("evaluator_unavailable");
    expect(aborted.progressToPersist).toBeNull();
  });

  it("drops a response cancelled while the evaluator is in flight", async () => {
    const state = stateAfter(ready("transfer", 2), {
      type: "transfer_changed",
      value: PRIVATE_TRANSFER,
    });
    let resolveEvaluation: (value: unknown) => void = () => {
      throw new Error("Evaluator fixture did not start.");
    };
    const evaluator = vi.fn(() => new Promise<unknown>((resolvePromise) => {
      resolveEvaluation = resolvePromise;
    }));
    const abortController = new AbortController();
    const pending = completeBroadRecallTransferEvaluation(state, {
      evaluator,
      requestToken: IDS.request,
      signal: abortController.signal,
    });

    abortController.abort();
    resolveEvaluation(publicDelivery("complete"));
    const result = await pending;

    expect(evaluator).toHaveBeenCalledOnce();
    expect(result.state).toBe(state);
    expect(result.operationFailure).toBe("evaluator_unavailable");
    expect(result.progressToPersist).toBeNull();
  });

  it("keys the instance by every identity field but not by stage", () => {
    const exact = broadRecallRuntimeInstanceKey(publicDelivery("recall"));
    expect(exact).toBe(broadRecallRuntimeInstanceKey(publicDelivery("compare")));

    for (const [key, value] of [
      ["planId", IDS.other],
      ["sessionId", IDS.other],
      ["routeRevisionId", IDS.other],
      ["resourceFingerprint", "sr1:fedcba9876543210"],
      ["resourceGeneratedAt", "2026-08-25T08:01:00.000Z"],
      ["deliveryHandle", IDS.other],
      ["runId", IDS.other],
      ["activityIndex", 5],
    ] as const) {
      const changed = structuredClone(publicDelivery("recall"));
      Object.assign(changed.identity, { [key]: value });
      expect(broadRecallRuntimeInstanceKey(changed), key).not.toBe(exact);
    }

    const invalid = structuredClone(publicDelivery("recall"));
    invalid.identity.runId = "not-a-uuid";
    expect(broadRecallRuntimeInstanceKey(invalid)).toBeNull();
  });
});

describe("BroadRecallRuntime staged presentation boundary", () => {
  function render(
    stage: typeof STAGES[number],
    rank: 0 | 1 | 2 | 3,
  ) {
    return renderToStaticMarkup(createElement(BroadRecallRuntime, {
      initialDelivery: publicDelivery(stage),
      initialProgress: progressAtRank(rank),
    }));
  }

  it("renders only the current recall disclosure", () => {
    const html = render("recall", 0);

    expect(html).toContain('aria-label="Blurting broad recall"');
    expect(html).toContain('data-delivery-stage="recall"');
    expect(html).toContain("RECALL PROMPT");
    expect(html).not.toContain("SAVED SOURCE");
    expect(html).not.toContain("REPAIR INSTRUCTION");
    expect(html).not.toContain("TRANSFER PROMPT");
    expect(html).not.toContain("REFERENCE A");
  });

  it("allows explicit compare recovery while keeping cleared recall text explicit", () => {
    const html = render("compare", 0);

    expect(html).toContain('data-delivery-stage="compare"');
    expect(html).toContain("SAVED SOURCE");
    expect(html).toContain("Your recall text was cleared during recovery");
    expect(html).not.toContain("RECALL PROMPT");
    expect(html).not.toContain("REPAIR INSTRUCTION");
  });

  it("renders repair and transfer solely from their matching deliveries", () => {
    const repair = render("repair", 1);
    const transfer = render("transfer", 2);

    expect(repair).toContain("REPAIR INSTRUCTION");
    expect(repair).toContain('aria-label="Gap classification summary"');
    expect(repair).not.toContain("SAVED SOURCE");
    expect(repair).not.toContain("TRANSFER PROMPT");

    expect(transfer).toContain("TRANSFER PROMPT");
    expect(transfer).toContain("Unicode characters");
    expect(transfer).not.toContain("SAVED SOURCE");
    expect(transfer).not.toContain("REFERENCE A");
    expect(transfer).not.toMatch(/<textarea[^>]*maxLength=/);
  });

  it("renders results and references only from a valid complete delivery", () => {
    const html = render("complete", 3);

    expect(html).toContain('data-delivery-stage="complete"');
    expect(html).toContain("Transfer results by saved target");
    expect(html).toContain("Not verified — treat as needs review");
    expect(html).toContain("REFERENCE A");
    expect(html).toContain("REFERENCE B");
    expect(html).not.toContain("TRANSFER PROMPT");
    expect(html).toContain('aria-live="polite"');
  });

  it("fails closed on a delivery/progress contradiction", () => {
    const html = render("repair", 0);

    expect(html).toContain('role="alert"');
    expect(html).toContain("conflicts with the delivered stage");
    expect(html).not.toContain("REPAIR INSTRUCTION");
  });

  it("has no private/runtime imports and remains absent from every live path", () => {
    for (const relativePath of [
      "src/components/broad-recall-runtime-controller.ts",
      "src/components/broad-recall-runtime.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      for (const forbidden of [
        "method-runtime",
        "RetrievalRoundRuntimeSchema",
        "expected" + "Answer",
        "comparison" + "Criterion",
        "transfer" + "SuccessCriterion",
        "@/lib/server/",
        "disabled-blurting-session-v18",
        "private-resource",
        "verified-completion",
      ]) {
        expect(source, `${relativePath}: ${forbidden}`).not.toContain(forbidden);
      }
    }

    for (const relativePath of [
      "src/lib/session-generation/schema.ts",
      "src/lib/session-generation/resource.ts",
      "src/components/yova-prototype.tsx",
      "src/app/api/sessions/generate/route.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).not.toContain("@/components/broad-recall-runtime");
      expect(source).not.toContain("disabled-blurting-public-delivery-v18");
      expect(source).not.toContain("disabled-blurting-public-delivery-state-v18");
    }

    const generationRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/sessions/generate/route.ts"),
      "utf8",
    );
    expect(generationRoute).toContain("blurting_runtime_unavailable");
  });
});

import { describe, expect, it } from "vitest";
import {
  broadRecallSupportPolicy,
  broadRecallSupportPolicyAfterReload,
  type BroadRecallSupportPolicy,
  type BroadRecallSupportView,
} from "@/lib/learning/broad-recall-support-policy";
import {
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  recordBroadRecallTransferEvaluation,
  startBroadRecallProgress,
  type BroadRecallProgress,
} from "@/lib/learning/broad-recall-progress";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

const EXPECTED_POLICY_KEYS = [
  "kind",
  "sourceComparison",
  "previousLesson",
  "modelAnswer",
  "sessionGuide",
  "tutor",
  "notesAndHelp",
  "transferReference",
  "exitBehavior",
] as const;

const SURFACE_KEYS = [
  "sourceComparison",
  "previousLesson",
  "modelAnswer",
  "sessionGuide",
  "tutor",
  "notesAndHelp",
  "transferReference",
] as const satisfies readonly (keyof BroadRecallSupportPolicy)[];

const READY_CONTEXTS = [
  { durableStage: "broad_attempt", view: "recall_closed" },
  { durableStage: "broad_attempt", view: "compare_open" },
  { durableStage: "gap_repair", view: "repair_open" },
  { durableStage: "closed_source_transfer", view: "transfer_closed" },
  { durableStage: "closed_source_transfer", view: "evaluating" },
  { durableStage: "complete", view: "complete" },
] as const;

function ready(
  durableStage: typeof READY_CONTEXTS[number]["durableStage"],
  view: BroadRecallSupportView,
) {
  return { kind: "ready", durableStage, view } as const;
}

function startedProgress() {
  const progress = startBroadRecallProgress({
    activityIndex: 0,
    gapCount: 1,
    bindings: [{
      targetId: TARGET_ID,
      evidenceId: blurtingFinalCheckEvidenceId(TARGET_ID),
    }],
  });
  expect(progress).not.toBeNull();
  return progress!;
}

function completedComparison(progress = startedProgress()) {
  const next = completeBroadRecallComparison(progress, ["covered"]);
  expect(next).not.toBeNull();
  return next!;
}

function completedCorrection(progress = completedComparison()) {
  const next = completeBroadRecallCorrection(progress);
  expect(next).not.toBeNull();
  return next!;
}

function completedTransfer(progress = completedCorrection()) {
  const next = recordBroadRecallTransferEvaluation(progress, ["secure"]);
  expect(next).not.toBeNull();
  return next!;
}

function expectEverySurfaceDenied(policy: BroadRecallSupportPolicy) {
  for (const key of SURFACE_KEYS) expect(policy[key]).toBe("denied");
}

describe("broad-recall support-surface policy", () => {
  it("enumerates every valid ready view without unlocking an unrelated surface", () => {
    const policies = READY_CONTEXTS.map(({ durableStage, view }) => ({
      view,
      policy: broadRecallSupportPolicy(ready(durableStage, view)),
    }));

    for (const { view, policy } of policies) {
      expect(Object.keys(policy)).toEqual(EXPECTED_POLICY_KEYS);

      if (view === "compare_open") {
        expect(policy.sourceComparison).toBe("exact_saved_source_only");
        for (const key of SURFACE_KEYS.filter((key) => key !== "sourceComparison")) {
          expect(policy[key]).toBe("denied");
        }
        continue;
      }

      if (view === "complete") {
        expectEverySurfaceDenied(policy);
        expect(policy.exitBehavior).toBe("safe_exit_discard_ephemeral");
        continue;
      }

      expectEverySurfaceDenied(policy);
      expect(policy.exitBehavior).toBe(
        "confirm_preserve_durable_discard_ephemeral",
      );
    }
  });

  it("permits comparison only for the exact saved source", () => {
    const policy = broadRecallSupportPolicy(
      ready("broad_attempt", "compare_open"),
    );

    expect(policy.sourceComparison).toBe("exact_saved_source_only");
    expect(policy.previousLesson).toBe("denied");
    expect(policy.modelAnswer).toBe("denied");
    expect(policy.sessionGuide).toBe("denied");
    expect(policy.tutor).toBe("denied");
    expect(policy.notesAndHelp).toBe("denied");
    expect(policy.transferReference).toBe("denied");
  });

  it("default-denies invalid, conflicted, and evaluator-unavailable states", () => {
    const failClosedStates = [
      { kind: "invalid" },
      { kind: "conflict" },
      {
        kind: "evaluator_unavailable",
        durableStage: "closed_source_transfer",
        view: "transfer_closed",
      },
      {
        kind: "evaluator_unavailable",
        durableStage: "closed_source_transfer",
        view: "evaluating",
      },
    ];

    for (const state of failClosedStates) {
      const policy = broadRecallSupportPolicy(state);
      expectEverySurfaceDenied(policy);
      expect(policy.exitBehavior).toBe("safe_exit_discard_ephemeral");
    }
  });

  it("rejects every contradictory durable-stage and ephemeral-view pair", () => {
    const validPairs = new Set(
      READY_CONTEXTS.map(({ durableStage, view }) => `${durableStage}:${view}`),
    );
    const stages = [
      "broad_attempt",
      "gap_repair",
      "closed_source_transfer",
      "complete",
    ] as const;
    const views = READY_CONTEXTS.map(({ view }) => view);

    for (const durableStage of stages) {
      for (const view of views) {
        if (validPairs.has(`${durableStage}:${view}`)) continue;
        const policy = broadRecallSupportPolicy(ready(durableStage, view));
        expectEverySurfaceDenied(policy);
        expect(policy.exitBehavior).toBe("safe_exit_discard_ephemeral");
      }
    }
  });

  it("rejects malformed or over-posted projections without partial access", () => {
    const malformed = [
      null,
      {},
      { kind: "ready", durableStage: "broad_attempt" },
      { kind: "ready", durableStage: "unknown", view: "compare_open" },
      { kind: "ready", durableStage: "broad_attempt", view: "unknown" },
      {
        kind: "ready",
        durableStage: "broad_attempt",
        view: "compare_open",
        recallDraft: "private learner text",
      },
      {
        kind: "evaluator_unavailable",
        durableStage: "complete",
        view: "complete",
      },
    ];

    for (const value of malformed) {
      const policy = broadRecallSupportPolicy(value);
      expectEverySurfaceDenied(policy);
      expect(policy.exitBehavior).toBe("safe_exit_discard_ephemeral");
    }
  });

  it("restores each durable event prefix to a safely closed view", () => {
    const progressByPrefix: readonly BroadRecallProgress[] = [
      startedProgress(),
      completedComparison(),
      completedCorrection(),
      completedTransfer(),
    ];
    const policies = progressByPrefix.map(broadRecallSupportPolicyAfterReload);

    expectEverySurfaceDenied(policies[0]!);
    expectEverySurfaceDenied(policies[1]!);
    expectEverySurfaceDenied(policies[2]!);
    expect(policies[0]?.exitBehavior).toBe(
      "confirm_preserve_durable_discard_ephemeral",
    );
    expect(policies[1]?.exitBehavior).toBe(
      "confirm_preserve_durable_discard_ephemeral",
    );
    expect(policies[2]?.exitBehavior).toBe(
      "confirm_preserve_durable_discard_ephemeral",
    );
    expectEverySurfaceDenied(policies[3]!);
    expect(policies[3]?.exitBehavior).toBe("safe_exit_discard_ephemeral");
  });

  it("never restores compare_open or evaluating from a durable prefix", () => {
    const emptyPrefixPolicy = broadRecallSupportPolicyAfterReload(startedProgress());
    const repairedPrefixPolicy = broadRecallSupportPolicyAfterReload(
      completedCorrection(),
    );

    expect(emptyPrefixPolicy.sourceComparison).toBe("denied");
    expect(repairedPrefixPolicy.sourceComparison).toBe("denied");
    expect(repairedPrefixPolicy.transferReference).toBe("denied");
  });

  it("default-denies a malformed durable prefix", () => {
    const policy = broadRecallSupportPolicyAfterReload({
      ...startedProgress(),
      events: [{ type: "correction_completed" }],
    });

    expectEverySurfaceDenied(policy);
    expect(policy.exitBehavior).toBe("safe_exit_discard_ephemeral");
  });

  it("returns immutable policies for allowed and denied states", () => {
    const policies = [
      broadRecallSupportPolicy(ready("broad_attempt", "recall_closed")),
      broadRecallSupportPolicy(ready("broad_attempt", "compare_open")),
      broadRecallSupportPolicy(ready("complete", "complete")),
      broadRecallSupportPolicy({ kind: "invalid" }),
    ];

    for (const policy of policies) expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policies[1] as { tutor: string }).tutor = "normal_post_check";
    }).toThrow(TypeError);
  });
});

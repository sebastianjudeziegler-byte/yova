import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18,
  createDisabledBlurtingDeliveryControllerV18,
  transitionDisabledBlurtingDeliveryControllerV18,
  type DisabledBlurtingDeliveryControllerReadyV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-state-v18";
import { blurtingFinalCheckEvidenceId } from "@/lib/study-route/method-recipe-contract";

const IDS = {
  plan: "71000000-0000-4000-8000-000000000001",
  session: "71000000-0000-4000-8000-000000000002",
  revision: "71000000-0000-4000-8000-000000000003",
  target: "71000000-0000-4000-8000-000000000004",
  delivery: "71000000-0000-4000-8000-000000000005",
  run: "71000000-0000-4000-8000-000000000006",
  evaluation: "71000000-0000-4000-8000-000000000007",
  request: "71000000-0000-4000-8000-000000000008",
  other: "71000000-0000-4000-8000-000000000009",
};

describe("disabled Blurting public delivery controller V18", () => {
  it("parses any exact stage without claiming repository provenance", () => {
    for (const stage of DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18) {
      expect(createDisabledBlurtingDeliveryControllerV18(delivery(stage)))
        .toMatchObject({ kind: "ready", delivery: { stage } });
    }
  });

  it("rejects malformed, over-posted, and non-delivery initial values", () => {
    const malformed = [
      null,
      {},
      { ...delivery("recall"), expectedAnswer: "private answer" },
      { ...delivery("recall"), boundaryStatus: "disabled_public_resource_template_only" },
      {
        schemaVersion: 18,
        boundaryStatus: "disabled_evaluator_transport_only",
        requestToken: IDS.request,
      },
    ];
    for (const value of malformed) {
      expect(createDisabledBlurtingDeliveryControllerV18(value)).toEqual({
        kind: "invalid_initial_delivery",
        reason: "invalid_delivery",
      });
    }
  });

  it("accepts an exact semantic replay and retains the identical state object", () => {
    const state = ready(delivery("compare"));
    const reorderedClone = reorderRootKeys(clone(state.delivery));
    const transition = receive(state, reorderedClone);

    expect(transition).toMatchObject({
      kind: "accepted",
      mode: "idempotent_replay",
    });
    expect(transition.state).toBe(state);
  });

  it("advances the full chain one server stage at a time and drops prior content", () => {
    let state = ready(delivery("recall"));
    for (const stage of DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18.slice(1)) {
      const prior = state;
      const transition = receive(state, delivery(stage));
      expect(transition).toMatchObject({
        kind: "accepted",
        mode: "advanced_one_stage",
        state: { delivery: { stage } },
      });
      state = transition.state;
      expect(state).not.toBe(prior);
      const droppedField = prior.delivery.stage === "complete"
        ? null
        : ({
            recall: "prompt",
            compare: "savedSourceAnswer",
            repair: "correctionInstruction",
            transfer: "answerConstraints",
          } as const)[prior.delivery.stage];
      if (droppedField) expect(state.delivery).not.toHaveProperty(droppedField);
    }
    expect(Object.keys(state.delivery)).not.toContain("transferDraft");
  });

  it("rejects every skip and backtrack, including complete-to-recall", () => {
    expect(receive(ready(delivery("recall")), delivery("repair")))
      .toMatchObject({ kind: "rejected", reason: "stage_skip" });
    expect(receive(ready(delivery("compare")), delivery("complete")))
      .toMatchObject({ kind: "rejected", reason: "stage_skip" });
    expect(receive(ready(delivery("transfer")), delivery("repair")))
      .toMatchObject({ kind: "rejected", reason: "stage_backtrack" });
    expect(receive(ready(delivery("complete")), delivery("recall")))
      .toMatchObject({ kind: "rejected", reason: "stage_backtrack" });
  });

  it("rejects same-stage content changes for every disclosure shape", () => {
    const mutations = [
      mutate(delivery("recall"), (value) => {
        if (value.stage !== "recall") throw new Error("fixture mismatch");
        value.prompt = "A changed recall prompt.";
      }),
      mutate(delivery("compare"), (value) => {
        if (value.stage !== "compare") throw new Error("fixture mismatch");
        value.savedSourceAnswer = "A changed saved source answer.";
      }),
      mutate(delivery("repair"), (value) => {
        if (value.stage !== "repair") throw new Error("fixture mismatch");
        value.correctionInstruction = "A changed correction instruction.";
      }),
      mutate(delivery("transfer"), (value) => {
        if (value.stage !== "transfer") throw new Error("fixture mismatch");
        value.prompt = "A changed transfer prompt.";
      }),
      mutate(delivery("complete"), (value) => {
        if (value.stage !== "complete") throw new Error("fixture mismatch");
        Object.assign(value.completion.orderedResults[0]!, {
          result: "needs_review" as const,
        });
      }),
    ];

    for (const changed of mutations) {
      const state = ready(delivery(changed.stage));
      const transition = receive(state, changed);
      expect(transition).toMatchObject({
        kind: "rejected",
        reason: "same_stage_content_mismatch",
      });
      expect(transition.state).toBe(state);
    }
  });

  it("rejects every identity-field change on an adjacent delivery", () => {
    const identityMutations = [
      ["planId", IDS.other],
      ["sessionId", IDS.other],
      ["routeRevisionId", IDS.other],
      ["resourceFingerprint", "sr1:fedcba9876543210"],
      ["resourceGeneratedAt", "2026-08-25T08:01:00.000Z"],
      ["deliveryHandle", IDS.other],
      ["runId", IDS.other],
      ["activityIndex", 1],
    ] as const;

    for (const [key, value] of identityMutations) {
      const changed = clone(delivery("compare"));
      Object.assign(changed.identity, { [key]: value });
      expect(receive(ready(delivery("recall")), changed)).toMatchObject({
        kind: "rejected",
        reason: "identity_mismatch",
      });
    }
  });

  it("rejects immutable target, phase, and gap-contract mutations", () => {
    const mutations = [{
      changed: mutate(delivery("compare"), (value) => {
        value.orderedTargets[0]!.displayLabel = "A changed target label";
      }),
      reason: "envelope_mismatch",
    }, {
      changed: mutate(delivery("compare"), (value) => {
        value.orderedTargets[0]!.evidenceId = `blurting-final-check:${IDS.other}`;
      }),
      reason: "invalid_delivery",
    }, {
      changed: mutate(delivery("compare"), (value) => {
        value.phaseMetadata[0].activeMinutes = 5;
      }),
      reason: "envelope_mismatch",
    }, {
      changed: mutate(delivery("compare"), (value) => {
        value.phaseMetadata[0].targetIds = [IDS.other];
      }),
      reason: "invalid_delivery",
    }, {
      changed: mutate(delivery("compare"), (value) => {
        if (value.stage !== "compare") throw new Error("fixture mismatch");
        value.gapCount = 2;
        value.gapChecklist.push("The factors remain in the original order.");
      }),
      reason: "envelope_mismatch",
    }] as const;

    for (const { changed, reason } of mutations) {
      const transition = receive(ready(delivery("recall")), changed);
      expect(transition).toMatchObject({
        kind: "rejected",
        reason,
      });
    }
  });

  it("preserves the exact prior state for invalid and conflicting responses", () => {
    const state = ready(delivery("repair"));
    const candidates = [
      { ...delivery("transfer"), privateCriterion: "do not accept" },
      delivery("recall"),
      mutate(delivery("transfer"), (value) => { value.gapCount = 2; }),
    ];

    for (const candidate of candidates) {
      const transition = receive(state, candidate);
      expect(transition.kind).toBe("rejected");
      expect(transition.state).toBe(state);
    }
  });

  it("rejects an unrecognized runtime command even if its delivery is valid", () => {
    const state = ready(delivery("recall"));
    const transition = transitionDisabledBlurtingDeliveryControllerV18(
      state,
      {
        type: "local_stage_advance",
        delivery: delivery("compare"),
      } as unknown as Parameters<
        typeof transitionDisabledBlurtingDeliveryControllerV18
      >[1],
    );

    expect(transition).toMatchObject({
      kind: "rejected",
      reason: "invalid_delivery",
    });
    expect(transition.state).toBe(state);
  });

  it("returns frozen states and recursively frozen parsed disclosures", () => {
    const created = createDisabledBlurtingDeliveryControllerV18(delivery("recall"));
    expect(created.kind).toBe("ready");
    if (created.kind !== "ready") throw new Error("expected ready fixture");
    const advanced = receive(created, delivery("compare"));

    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.delivery)).toBe(true);
    expect(Object.isFrozen(created.delivery.identity)).toBe(true);
    expect(Object.isFrozen(advanced)).toBe(true);
    expect(Object.isFrozen(advanced.state)).toBe(true);
    expect(Object.isFrozen(advanced.state.delivery.orderedTargets)).toBe(true);
  });

  it("remains absent from live unions, hydration, rendering, and generation", () => {
    for (const relativePath of [
      "src/lib/session-generation/schema.ts",
      "src/lib/session-generation/resource.ts",
      "src/components/yova-prototype.tsx",
      "src/app/api/sessions/generate/route.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).not.toContain(
        "disabled-blurting-public-delivery-state-v18",
      );
    }

    const generationRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/sessions/generate/route.ts"),
      "utf8",
    );
    expect(generationRoute).toContain("blurting_runtime_unavailable");
  });
});

function receive(
  state: DisabledBlurtingDeliveryControllerReadyV18,
  next: unknown,
) {
  return transitionDisabledBlurtingDeliveryControllerV18(state, {
    type: "server_delivery_received",
    delivery: next,
  });
}

function ready(value: unknown): DisabledBlurtingDeliveryControllerReadyV18 {
  const state = createDisabledBlurtingDeliveryControllerV18(value);
  if (state.kind !== "ready") throw new Error("expected ready fixture");
  return state;
}

function delivery(
  stage: typeof DISABLED_BLURTING_PUBLIC_DELIVERY_STAGES_V18[number],
) {
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
      activityIndex: 0,
    },
    orderedTargets: [{
      targetId: IDS.target,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.target),
      displayLabel: "Derivative product rule",
    }],
    phaseMetadata: [{
      phaseId: "method-1-retrieve" as const,
      methodPhase: "retrieve" as const,
      activeMinutes: 4,
      targetIds: [IDS.target],
    }, {
      phaseId: "method-2-repair" as const,
      methodPhase: "repair" as const,
      activeMinutes: 4,
      targetIds: [IDS.target],
    }, {
      phaseId: "method-3-transfer" as const,
      methodPhase: "transfer" as const,
      activeMinutes: 4,
      targetIds: [IDS.target],
    }],
    gapCount: 1,
  };

  if (stage === "recall") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Close the exact saved source before recalling.",
      prompt: "Write everything you remember about the product rule.",
    };
  }
  if (stage === "compare") {
    return {
      ...common,
      stage,
      comparisonInstructions: "Compare only after finishing the closed-source recall.",
      savedSourceAnswer: "The derivative of fg is f'g + fg'.",
      gapChecklist: ["Both product terms are present."],
    };
  }
  if (stage === "repair") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Close the exact saved source before repairing.",
      correctionInstruction: "Correct the missing relationship from memory.",
    };
  }
  if (stage === "transfer") {
    return {
      ...common,
      stage,
      sourceClosedReminder: "Keep the exact saved source closed for transfer.",
      prompt: "Differentiate x squared times sine x and explain both terms.",
      answerConstraints: { minCharacters: 2 as const, maxCharacters: 3_000 as const },
    };
  }
  return {
    ...common,
    stage,
    orderedReferences: [{
      targetId: IDS.target,
      evidenceId: blurtingFinalCheckEvidenceId(IDS.target),
      referenceAnswer: "Use the product rule once, differentiating each factor in turn.",
    }],
    completion: {
      evaluationReceiptHandle: IDS.evaluation,
      requestToken: IDS.request,
      evaluatorVersion: "blurting_target_evaluator_v1" as const,
      resolution: "evaluated" as const,
      orderedResults: [{
        targetId: IDS.target,
        evidenceId: blurtingFinalCheckEvidenceId(IDS.target),
        result: "secure" as const,
      }],
    },
  };
}

function mutate<Stage extends ReturnType<typeof delivery>>(
  value: Stage,
  apply: (draft: Stage) => void,
): Stage {
  const draft = clone(value);
  apply(draft);
  return draft;
}

function reorderRootKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

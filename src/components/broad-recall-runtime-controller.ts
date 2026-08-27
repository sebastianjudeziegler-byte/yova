import {
  BROAD_RECALL_GAP_STATUSES,
  completeBroadRecallComparison,
  completeBroadRecallCorrection,
  mergeBroadRecallProgress,
  readBroadRecallProgress,
  recordBroadRecallTransferEvaluation,
  startBroadRecallProgress,
  type BroadRecallGapStatus,
  type BroadRecallProgress,
} from "@/lib/learning/broad-recall-progress";
import {
  disabledBlurtingCanonicalTextV18Schema,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";
import {
  DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION,
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS,
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS,
  readDisabledBlurtingEvaluatorTransportV18,
  type DisabledBlurtingEvaluatorTransportV18,
  type DisabledBlurtingPublicDeliveryV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-v18";
import {
  createDisabledBlurtingDeliveryControllerV18,
  transitionDisabledBlurtingDeliveryControllerV18,
  type DisabledBlurtingDeliveryControllerReadyV18,
  type DisabledBlurtingDeliveryRejectionV18,
} from "@/lib/session-generation/disabled-blurting-public-delivery-state-v18";

export const BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS =
  DISABLED_BLURTING_TRANSFER_ANSWER_MIN_CHARACTERS;
export const BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS =
  DISABLED_BLURTING_TRANSFER_ANSWER_MAX_CHARACTERS;

export const BROAD_RECALL_RUNTIME_PHASES = [
  "retrieve",
  "repair",
  "transfer",
] as const;

export type BroadRecallRuntimeMethodPhase =
  typeof BROAD_RECALL_RUNTIME_PHASES[number];

export const BROAD_RECALL_RUNTIME_VIEWS = [
  "recall_closed",
  "compare_open",
  "repair_open",
  "transfer_closed",
  "complete",
] as const;

export type BroadRecallRuntimeView = typeof BROAD_RECALL_RUNTIME_VIEWS[number];
export type BroadRecallRuntimeDeliveryIdentity =
  DisabledBlurtingPublicDeliveryV18["identity"];
export type BroadRecallRuntimeDeliveryStage =
  DisabledBlurtingPublicDeliveryV18["stage"];
export type BroadRecallRuntimeRequestedStage = Exclude<
  BroadRecallRuntimeDeliveryStage,
  "recall"
>;

type BroadRecallInteractiveStateBase = Readonly<{
  /** Contains exactly one parsed public disclosure stage at a time. */
  deliveryController: DisabledBlurtingDeliveryControllerReadyV18;
  progress: BroadRecallProgress;
  methodPhase: BroadRecallRuntimeMethodPhase;
  view: BroadRecallRuntimeView;
  /** Ephemeral learner text. These values must never enter durable progress. */
  recallDraft: string;
  correctionDraft: string;
  transferDraft: string;
  gapStatuses: readonly (BroadRecallGapStatus | null)[];
}>;

export type BroadRecallRuntimeReadyState = BroadRecallInteractiveStateBase &
  Readonly<{ kind: "ready" }>;

export type BroadRecallRuntimeInvalidState = Readonly<{
  kind: "invalid";
  issue: string;
}>;

export type BroadRecallRuntimeConflictState = Readonly<{
  kind: "conflict";
  issue: string;
}>;

export type BroadRecallRuntimeControllerState =
  | BroadRecallRuntimeReadyState
  | BroadRecallRuntimeInvalidState
  | BroadRecallRuntimeConflictState;

export type BroadRecallRuntimeAction =
  | Readonly<{ type: "recall_changed"; value: string }>
  | Readonly<{
      type: "gap_classified";
      index: number;
      status: BroadRecallGapStatus;
    }>
  | Readonly<{ type: "correction_changed"; value: string }>
  | Readonly<{ type: "transfer_changed"; value: string }>
  | Readonly<{
      type: "server_delivery_received";
      delivery: unknown;
      requestedStage: BroadRecallRuntimeRequestedStage;
      /** Required only for a transfer-to-complete evaluator response. */
      completionRequestToken?: string;
    }>;

export type BroadRecallRuntimeDeliveryRejection =
  | DisabledBlurtingDeliveryRejectionV18
  | "stage_not_requested"
  | "stage_progress_mismatch"
  | "completion_request_mismatch";

export type BroadRecallRuntimeDeliveryOutcome =
  | Readonly<{
      kind: "accepted";
      mode: "idempotent_replay" | "advanced_one_stage";
    }>
  | Readonly<{
      kind: "rejected";
      reason: BroadRecallRuntimeDeliveryRejection;
    }>;

export type BroadRecallRuntimeTransition = Readonly<{
  state: BroadRecallRuntimeControllerState;
  /** The only value a component may send to its durable progress callback. */
  progressToPersist: BroadRecallProgress | null;
  deliveryOutcome: BroadRecallRuntimeDeliveryOutcome | null;
  operationFailure: "evaluator_unavailable" | null;
}>;

export type BroadRecallStageRequest = Readonly<{
  identity: BroadRecallRuntimeDeliveryIdentity;
  currentStage: "recall" | "compare" | "repair";
  requestedStage: "compare" | "repair" | "transfer";
  signal: AbortSignal;
}>;

export type BroadRecallStageRequester = (
  request: BroadRecallStageRequest,
) => Promise<unknown>;

export type BroadRecallTransferEvaluationRequest = Readonly<{
  transport: DisabledBlurtingEvaluatorTransportV18;
  signal: AbortSignal;
}>;

/** The evaluator must return an unknown server delivery, never bare results. */
export type BroadRecallTransferEvaluator = (
  request: BroadRecallTransferEvaluationRequest,
) => Promise<unknown>;

export type BroadRecallTransferEvaluationOptions = Readonly<{
  evaluator?: BroadRecallTransferEvaluator;
  requestToken: string;
  signal: AbortSignal;
}>;

const INVALID_DELIVERY_ISSUE =
  "This is not an exact staged Blurting public delivery and cannot be opened safely.";
const INVALID_PROGRESS_ISSUE =
  "The saved broad-recall progress is malformed and cannot be resumed safely.";
const PROGRESS_CONFLICT_ISSUE =
  "The saved progress conflicts with this delivery stage or its ordered activity identity.";
const MAX_EPHEMERAL_DRAFT_CODE_UNITS = 12_000;
const TRANSFER_ANSWER_SCHEMA = disabledBlurtingCanonicalTextV18Schema({
  minCodePoints: BROAD_RECALL_TRANSFER_ANSWER_MIN_CHARACTERS,
  maxCodePoints: BROAD_RECALL_TRANSFER_ANSWER_MAX_CHARACTERS,
});

/**
 * Creates a dormant browser projector from one public stage. Parsing is not
 * repository provenance and grants no disclosure, evaluation, or completion
 * authority. A future caller must authenticate the delivery before invoking
 * this boundary.
 *
 * Recovery is exact: recall/compare require rank 0, repair rank 1, transfer
 * rank 2, and complete rank 3. Ephemeral drafts are always recreated empty.
 */
export function createBroadRecallRuntimeController({
  initialDelivery,
  initialProgress = null,
}: {
  initialDelivery: unknown;
  initialProgress?: unknown;
}): BroadRecallRuntimeControllerState {
  const deliveryController = createDisabledBlurtingDeliveryControllerV18(
    initialDelivery,
  );
  if (deliveryController.kind !== "ready") {
    return invalidState(INVALID_DELIVERY_ISSUE);
  }

  const expectedProgress = progressForDelivery(deliveryController.delivery);
  if (!expectedProgress) return invalidState(INVALID_DELIVERY_ISSUE);

  let progress = expectedProgress;
  if (initialProgress !== null && initialProgress !== undefined) {
    const restored = readBroadRecallProgress(initialProgress);
    if (!restored) return invalidState(INVALID_PROGRESS_ISSUE);

    const reconciliation = mergeBroadRecallProgress(expectedProgress, restored);
    if (reconciliation.kind === "conflict") {
      return reconciliation.reason === "invalid_progress"
        ? invalidState(INVALID_PROGRESS_ISSUE)
        : conflictState(PROGRESS_CONFLICT_ISSUE);
    }
    progress = reconciliation.progress;
  }

  if (!deliveryMatchesProgress(deliveryController.delivery, progress)) {
    return conflictState(PROGRESS_CONFLICT_ISSUE);
  }

  return readyState(deliveryController, progress);
}

/**
 * React instance identity for one exact execution. The stage is deliberately
 * omitted so adjacent disclosures can replace each other in the same instance.
 */
export function broadRecallRuntimeInstanceKey(
  initialDelivery: unknown,
): string | null {
  const parsed = createDisabledBlurtingDeliveryControllerV18(initialDelivery);
  if (parsed.kind !== "ready") return null;
  const identity = parsed.delivery.identity;
  return JSON.stringify([
    identity.planId,
    identity.sessionId,
    identity.routeRevisionId,
    identity.resourceFingerprint,
    identity.resourceGeneratedAt,
    identity.deliveryHandle,
    identity.runId,
    identity.activityIndex,
  ]);
}

export function transitionBroadRecallRuntime(
  state: BroadRecallRuntimeControllerState,
  action: BroadRecallRuntimeAction,
): BroadRecallRuntimeTransition {
  if (!isBroadRecallRuntimeInteractive(state)) return transition(state);

  if (action.type === "recall_changed") {
    if (
      currentDelivery(state).stage !== "recall"
      || action.value.length > MAX_EPHEMERAL_DRAFT_CODE_UNITS
    ) {
      return invalidTransition();
    }
    return transition(freezeReady({ ...state, recallDraft: action.value }));
  }

  if (action.type === "gap_classified") {
    if (
      currentDelivery(state).stage !== "compare"
      || !Number.isInteger(action.index)
      || action.index < 0
      || action.index >= state.gapStatuses.length
      || !BROAD_RECALL_GAP_STATUSES.includes(action.status)
    ) {
      return invalidTransition();
    }
    const gapStatuses = [...state.gapStatuses];
    gapStatuses[action.index] = action.status;
    return transition(freezeReady({
      ...state,
      gapStatuses: Object.freeze(gapStatuses),
    }));
  }

  if (action.type === "correction_changed") {
    if (
      currentDelivery(state).stage !== "repair"
      || action.value.length > MAX_EPHEMERAL_DRAFT_CODE_UNITS
    ) {
      return invalidTransition();
    }
    return transition(freezeReady({ ...state, correctionDraft: action.value }));
  }

  if (action.type === "transfer_changed") {
    if (
      currentDelivery(state).stage !== "transfer"
      || action.value.length > MAX_EPHEMERAL_DRAFT_CODE_UNITS
    ) {
      return invalidTransition();
    }
    return transition(freezeReady({ ...state, transferDraft: action.value }));
  }

  if (action.type === "server_delivery_received") {
    return receiveServerDelivery(state, action);
  }

  return invalidTransition();
}

/**
 * Runs the transfer callback with the strict public transport. Callback success
 * alone has no effect: only a token-matched adjacent complete delivery can add
 * the terminal event or expose references in this local projector. This does
 * not provide the future repository's atomic stage-and-progress persistence.
 */
export async function completeBroadRecallTransferEvaluation(
  state: BroadRecallRuntimeControllerState,
  options: BroadRecallTransferEvaluationOptions,
): Promise<BroadRecallRuntimeTransition> {
  if (
    !isBroadRecallRuntimeInteractive(state)
    || currentDelivery(state).stage !== "transfer"
    || !options.evaluator
    || options.signal.aborted
  ) {
    return evaluatorFailure(state);
  }

  const transport = createBroadRecallTransferEvaluationTransport(
    state,
    options.requestToken,
  );
  if (!transport) return evaluatorFailure(state);

  try {
    const candidate = await options.evaluator(Object.freeze({
      transport,
      signal: options.signal,
    }));
    if (options.signal.aborted) return evaluatorFailure(state);
    return transitionBroadRecallRuntime(state, {
      type: "server_delivery_received",
      delivery: candidate,
      requestedStage: "complete",
      completionRequestToken: transport.requestToken,
    });
  } catch {
    return evaluatorFailure(state);
  }
}

export function createBroadRecallTransferEvaluationTransport(
  state: BroadRecallRuntimeControllerState,
  requestToken: string,
): DisabledBlurtingEvaluatorTransportV18 | null {
  if (!isBroadRecallRuntimeInteractive(state)) return null;
  const delivery = currentDelivery(state);
  if (delivery.stage !== "transfer") return null;

  return readDisabledBlurtingEvaluatorTransportV18({
    schemaVersion: DISABLED_BLURTING_PUBLIC_SCHEMA_VERSION,
    boundaryStatus: "disabled_evaluator_transport_only",
    requestToken,
    identity: delivery.identity,
    orderedBindings: delivery.orderedTargets.map(({ targetId, evidenceId }) => ({
      targetId,
      evidenceId,
    })),
    learnerAnswer: state.transferDraft,
  });
}

export function nextBroadRecallRuntimeRequestedStage(
  state: BroadRecallRuntimeControllerState,
): BroadRecallRuntimeRequestedStage | null {
  if (!isBroadRecallRuntimeInteractive(state)) return null;
  const stage = currentDelivery(state).stage;
  if (stage === "recall") return hasText(state.recallDraft) ? "compare" : null;
  if (stage === "compare") {
    return state.gapStatuses.every((status) => status !== null) ? "repair" : null;
  }
  if (stage === "repair") {
    return hasText(state.correctionDraft) ? "transfer" : null;
  }
  if (stage === "transfer") {
    return isSubmittableBroadRecallTransferAnswer(state.transferDraft)
      ? "complete"
      : null;
  }
  return null;
}

export function isSubmittableBroadRecallTransferAnswer(value: string) {
  return TRANSFER_ANSWER_SCHEMA.safeParse(value).success;
}

export function isBroadRecallRuntimeInteractive(
  state: BroadRecallRuntimeControllerState,
): state is BroadRecallRuntimeReadyState {
  return state.kind === "ready";
}

export function currentBroadRecallRuntimeDelivery(
  state: BroadRecallRuntimeReadyState,
): DisabledBlurtingPublicDeliveryV18 {
  return currentDelivery(state);
}

function receiveServerDelivery(
  state: BroadRecallRuntimeReadyState,
  action: Extract<BroadRecallRuntimeAction, { type: "server_delivery_received" }>,
): BroadRecallRuntimeTransition {
  const deliveryTransition = transitionDisabledBlurtingDeliveryControllerV18(
    state.deliveryController,
    { type: "server_delivery_received", delivery: action.delivery },
  );

  if (deliveryTransition.kind === "rejected") {
    return rejectedDelivery(state, deliveryTransition.reason);
  }
  if (deliveryTransition.mode === "idempotent_replay") {
    return transition(
      state,
      null,
      Object.freeze({ kind: "accepted", mode: "idempotent_replay" }),
    );
  }

  const current = currentDelivery(state);
  const next = deliveryTransition.state.delivery;
  if (next.stage !== action.requestedStage) {
    return rejectedDelivery(state, "stage_not_requested");
  }

  let progress = state.progress;
  if (current.stage === "recall" && next.stage === "compare") {
    if (!hasText(state.recallDraft) || state.progress.events.length !== 0) {
      return rejectedDelivery(state, "stage_progress_mismatch");
    }
  } else if (current.stage === "compare" && next.stage === "repair") {
    if (state.gapStatuses.some((status) => status === null)) {
      return rejectedDelivery(state, "stage_progress_mismatch");
    }
    const completed = completeBroadRecallComparison(
      state.progress,
      state.gapStatuses as readonly BroadRecallGapStatus[],
    );
    if (!completed) return rejectedDelivery(state, "stage_progress_mismatch");
    progress = completed;
  } else if (current.stage === "repair" && next.stage === "transfer") {
    if (!hasText(state.correctionDraft)) {
      return rejectedDelivery(state, "stage_progress_mismatch");
    }
    const completed = completeBroadRecallCorrection(state.progress);
    if (!completed) return rejectedDelivery(state, "stage_progress_mismatch");
    progress = completed;
  } else if (current.stage === "transfer" && next.stage === "complete") {
    if (
      !action.completionRequestToken
      || next.completion.requestToken !== action.completionRequestToken
      || !createBroadRecallTransferEvaluationTransport(
        state,
        action.completionRequestToken,
      )
    ) {
      return rejectedDelivery(state, "completion_request_mismatch");
    }
    const completed = recordBroadRecallTransferEvaluation(
      state.progress,
      next.completion.orderedResults.map(({ result }) => result),
    );
    if (!completed) return rejectedDelivery(state, "stage_progress_mismatch");
    progress = completed;
  } else {
    return rejectedDelivery(state, "stage_progress_mismatch");
  }

  if (!deliveryMatchesProgress(next, progress)) {
    return rejectedDelivery(state, "stage_progress_mismatch");
  }

  const advanced = readyState(
    deliveryTransition.state,
    progress,
    next.stage === "compare" ? state.recallDraft : "",
  );
  const persisted = progress === state.progress ? null : progress;
  return transition(
    advanced,
    persisted,
    Object.freeze({ kind: "accepted", mode: "advanced_one_stage" }),
  );
}

function progressForDelivery(
  delivery: DisabledBlurtingPublicDeliveryV18,
): BroadRecallProgress | null {
  return startBroadRecallProgress({
    activityIndex: delivery.identity.activityIndex,
    gapCount: delivery.gapCount,
    bindings: delivery.orderedTargets.map(({ targetId, evidenceId }) => ({
      targetId,
      evidenceId,
    })),
  });
}

function deliveryMatchesProgress(
  delivery: DisabledBlurtingPublicDeliveryV18,
  progress: BroadRecallProgress,
) {
  const expectedRank = ({
    recall: 0,
    compare: 0,
    repair: 1,
    transfer: 2,
    complete: 3,
  } as const)[delivery.stage];
  if (progress.events.length !== expectedRank) return false;

  if (delivery.stage !== "complete") return true;
  const event = progress.events[2];
  if (event?.type !== "transfer_evaluated") return false;
  const deliveredResults = delivery.completion.orderedResults;
  return event.results.length === deliveredResults.length
    && event.results.every((result, index) => (
      result === deliveredResults[index]?.result
    ));
}

function readyState(
  deliveryController: DisabledBlurtingDeliveryControllerReadyV18,
  progress: BroadRecallProgress,
  recallDraft = "",
): BroadRecallRuntimeReadyState {
  const delivery = deliveryController.delivery;
  return freezeReady({
    kind: "ready",
    deliveryController,
    progress,
    methodPhase: methodPhaseForStage(delivery.stage),
    view: viewForStage(delivery.stage),
    recallDraft,
    correctionDraft: "",
    transferDraft: "",
    gapStatuses: Object.freeze(
      Array.from({ length: delivery.gapCount }, () => null),
    ),
  });
}

function methodPhaseForStage(
  stage: BroadRecallRuntimeDeliveryStage,
): BroadRecallRuntimeMethodPhase {
  if (stage === "recall" || stage === "compare") return "retrieve";
  if (stage === "repair") return "repair";
  return "transfer";
}

function viewForStage(stage: BroadRecallRuntimeDeliveryStage): BroadRecallRuntimeView {
  if (stage === "recall") return "recall_closed";
  if (stage === "compare") return "compare_open";
  if (stage === "repair") return "repair_open";
  if (stage === "transfer") return "transfer_closed";
  return "complete";
}

function currentDelivery(
  state: BroadRecallRuntimeReadyState,
): DisabledBlurtingPublicDeliveryV18 {
  return state.deliveryController.delivery;
}

function rejectedDelivery(
  state: BroadRecallRuntimeReadyState,
  reason: BroadRecallRuntimeDeliveryRejection,
): BroadRecallRuntimeTransition {
  return transition(
    state,
    null,
    Object.freeze({ kind: "rejected", reason }),
  );
}

function evaluatorFailure(
  state: BroadRecallRuntimeControllerState,
): BroadRecallRuntimeTransition {
  return Object.freeze({
    state,
    progressToPersist: null,
    deliveryOutcome: null,
    operationFailure: "evaluator_unavailable" as const,
  });
}

function invalidTransition(): BroadRecallRuntimeTransition {
  return transition(invalidState(
    "The staged broad-recall interaction left its canonical order and was stopped safely.",
  ));
}

function invalidState(issue: string): BroadRecallRuntimeInvalidState {
  return Object.freeze({ kind: "invalid", issue });
}

function conflictState(issue: string): BroadRecallRuntimeConflictState {
  return Object.freeze({ kind: "conflict", issue });
}

function freezeReady(
  state: BroadRecallRuntimeReadyState,
): BroadRecallRuntimeReadyState {
  return Object.freeze(state);
}

function transition(
  state: BroadRecallRuntimeControllerState,
  progressToPersist: BroadRecallProgress | null = null,
  deliveryOutcome: BroadRecallRuntimeDeliveryOutcome | null = null,
): BroadRecallRuntimeTransition {
  return Object.freeze({
    state,
    progressToPersist,
    deliveryOutcome,
    operationFailure: null,
  });
}

function hasText(value: string) {
  return value.trim().length > 0;
}

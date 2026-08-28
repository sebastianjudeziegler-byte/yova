"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  BroadRecallGapStatus,
  BroadRecallProgress,
  BroadRecallTransferResult,
} from "@/lib/learning/broad-recall-progress";
import {
  BROAD_RECALL_RUNTIME_PHASES,
  broadRecallRuntimeInstanceKey,
  completeBroadRecallTransferEvaluation,
  createBroadRecallRuntimeController,
  currentBroadRecallRuntimeDelivery,
  isBroadRecallRuntimeInteractive,
  nextBroadRecallRuntimeRequestedStage,
  transitionBroadRecallRuntime,
  type BroadRecallRuntimeAction,
  type BroadRecallRuntimeMethodPhase,
  type BroadRecallRuntimeReadyState,
  type BroadRecallRuntimeRequestedStage,
  type BroadRecallRuntimeTransition,
  type BroadRecallRuntimeView,
  type BroadRecallStageRequester,
  type BroadRecallTransferEvaluator,
} from "@/components/broad-recall-runtime-controller";

import styles from "./broad-recall-runtime.module.css";

export type BroadRecallRuntimeProps = Readonly<{
  initialDelivery: unknown;
  initialProgress?: unknown;
  onProgressChange?: (progress: BroadRecallProgress) => void;
  onRequestStage?: BroadRecallStageRequester;
  onEvaluateTransfer?: BroadRecallTransferEvaluator;
}>;

const GAP_CHOICES: readonly Readonly<{
  value: BroadRecallGapStatus;
  label: string;
}>[] = [
  { value: "covered", label: "Covered accurately" },
  { value: "partial", label: "Partly covered" },
  { value: "missing", label: "Missing or inaccurate" },
];

const PHASE_LABELS: Readonly<Record<BroadRecallRuntimeMethodPhase, string>> = {
  retrieve: "Retrieve",
  repair: "Repair",
  transfer: "Transfer",
};

const RESULT_LABELS: Readonly<Record<BroadRecallTransferResult, string>> = {
  secure: "Secure on this check",
  needs_review: "Needs review",
  unverified: "Not verified — treat as needs review",
};

const STAGE_UNAVAILABLE_COPY =
  "The matching next stage is unavailable. Your in-memory work remains here so you can retry.";
const EVALUATOR_UNAVAILABLE_COPY =
  "Verification is unavailable. Your answer remains only on this screen so you can retry.";
const DELIVERY_REJECTED_COPY =
  "The returned stage did not match this exact attempt. Nothing new was revealed or saved.";
const REPLAY_COPY =
  "The server retained this stage. Your in-memory work remains here so you can retry.";

type ActiveOperation = Readonly<{
  token: string;
  startStage: BroadRecallRuntimeReadyState["deliveryController"]["delivery"]["stage"];
  requestedStage: BroadRecallRuntimeRequestedStage;
  abortController: AbortController;
  startState: BroadRecallRuntimeReadyState;
}>;

/**
 * Dormant staged Blurting interaction. It remains intentionally absent from
 * the live session renderer while route issuance and the atomic repository
 * stage/progress writer are unavailable.
 */
export function BroadRecallRuntime({
  initialDelivery,
  initialProgress = null,
  onProgressChange,
  onRequestStage,
  onEvaluateTransfer,
}: BroadRecallRuntimeProps) {
  const instanceKey = broadRecallRuntimeInstanceKey(initialDelivery);
  return (
    <BroadRecallRuntimeInstance
      key={instanceKey ?? "invalid-staged-broad-recall-delivery"}
      initialDelivery={initialDelivery}
      initialProgress={initialProgress}
      onProgressChange={onProgressChange}
      onRequestStage={onRequestStage}
      onEvaluateTransfer={onEvaluateTransfer}
    />
  );
}

/**
 * The key contains the full public execution identity, including delivery and
 * run handles. Identity replacement unmounts this instance, erases drafts, and
 * aborts any request without setting state during cleanup.
 */
function BroadRecallRuntimeInstance({
  initialDelivery,
  initialProgress,
  onProgressChange,
  onRequestStage,
  onEvaluateTransfer,
}: BroadRecallRuntimeProps) {
  const gapGroupId = useId();
  const [controller, setController] = useState(() => (
    createBroadRecallRuntimeController({ initialDelivery, initialProgress })
  ));
  const controllerRef = useRef(controller);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const [requestingStage, setRequestingStage] = useState<
    BroadRecallRuntimeRequestedStage | null
  >(null);
  const [requestIssue, setRequestIssue] = useState<string | null>(null);

  useEffect(() => () => {
    activeOperationRef.current?.abortController.abort();
    activeOperationRef.current = null;
  }, []);

  const commit = (result: BroadRecallRuntimeTransition) => {
    controllerRef.current = result.state;
    setController(result.state);
    if (result.progressToPersist) {
      onProgressChange?.(result.progressToPersist);
    }
  };

  const apply = (action: BroadRecallRuntimeAction) => {
    const result = transitionBroadRecallRuntime(controllerRef.current, action);
    if (isBroadRecallRuntimeInteractive(result.state)) setRequestIssue(null);
    commit(result);
  };

  const operationIsCurrent = (operation: ActiveOperation) => (
    !operation.abortController.signal.aborted
    && activeOperationRef.current?.token === operation.token
    && controllerRef.current === operation.startState
    && currentBroadRecallRuntimeDelivery(operation.startState).stage
      === operation.startStage
  );

  const finishOperation = (
    operation: ActiveOperation,
    result: BroadRecallRuntimeTransition,
  ) => {
    if (!operationIsCurrent(operation)) return;
    operation.abortController.abort();
    activeOperationRef.current = null;
    setRequestingStage(null);

    if (result.operationFailure) {
      setRequestIssue(EVALUATOR_UNAVAILABLE_COPY);
      return;
    }
    if (result.deliveryOutcome?.kind === "rejected") {
      setRequestIssue(DELIVERY_REJECTED_COPY);
      return;
    }
    if (result.deliveryOutcome?.mode === "idempotent_replay") {
      setRequestIssue(REPLAY_COPY);
      return;
    }

    setRequestIssue(null);
    commit(result);
  };

  const startOperation = (
    state: BroadRecallRuntimeReadyState,
    requestedStage: BroadRecallRuntimeRequestedStage,
  ) => {
    const operation = Object.freeze({
      token: globalThis.crypto.randomUUID(),
      startStage: currentBroadRecallRuntimeDelivery(state).stage,
      requestedStage,
      abortController: new AbortController(),
      startState: state,
    });
    activeOperationRef.current = operation;
    setRequestingStage(requestedStage);
    setRequestIssue(null);
    return operation;
  };

  const requestNextStage = async () => {
    if (
      activeOperationRef.current
      || !isBroadRecallRuntimeInteractive(controllerRef.current)
    ) return;

    const state = controllerRef.current;
    const current = currentBroadRecallRuntimeDelivery(state);
    const requestedStage = nextBroadRecallRuntimeRequestedStage(state);
    if (!requestedStage) return;

    if (current.stage === "transfer") {
      if (!onEvaluateTransfer) {
        setRequestIssue(EVALUATOR_UNAVAILABLE_COPY);
        return;
      }
      const operation = startOperation(state, "complete");
      const result = await completeBroadRecallTransferEvaluation(state, {
        evaluator: onEvaluateTransfer,
        requestToken: operation.token,
        signal: operation.abortController.signal,
      });
      finishOperation(operation, result);
      return;
    }

    if (current.stage === "complete") return;
    if (requestedStage === "complete") return;
    if (!onRequestStage) {
      setRequestIssue(STAGE_UNAVAILABLE_COPY);
      return;
    }

    const operation = startOperation(state, requestedStage);
    try {
      const candidate = await onRequestStage(Object.freeze({
        identity: current.identity,
        currentStage: current.stage,
        requestedStage,
        signal: operation.abortController.signal,
      }));
      if (!operationIsCurrent(operation)) return;
      finishOperation(operation, transitionBroadRecallRuntime(state, {
        type: "server_delivery_received",
        delivery: candidate,
        requestedStage,
      }));
    } catch {
      if (!operationIsCurrent(operation)) return;
      operation.abortController.abort();
      activeOperationRef.current = null;
      setRequestingStage(null);
      setRequestIssue(STAGE_UNAVAILABLE_COPY);
    }
  };

  if (!isBroadRecallRuntimeInteractive(controller)) {
    return (
      <section className={styles.runtime} aria-label="Blurting broad recall">
        <div className={styles.blocked} role="alert">
          <p className={styles.eyebrow}>BLURTING STOPPED</p>
          <h3>{controller.kind === "conflict"
            ? "This saved attempt conflicts with the delivered stage"
            : "This activity cannot be opened safely"}</h3>
          <p>{controller.issue}</p>
        </div>
      </section>
    );
  }

  const state = controller;
  const delivery = currentBroadRecallRuntimeDelivery(state);
  const comparison = state.progress.events[0]?.type === "comparison_completed"
    ? state.progress.events[0]
    : null;
  const busy = requestingStage !== null;

  return (
    <section
      className={styles.runtime}
      aria-label="Blurting broad recall"
      data-method-phase={state.methodPhase}
      data-delivery-stage={delivery.stage}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BLURTING</p>
          <h3>Recall broadly, repair precisely, then check transfer.</h3>
        </div>
        <ol className={styles.phases} aria-label="Blurting phases">
          {BROAD_RECALL_RUNTIME_PHASES.map((phase, index) => {
            const status = phaseStatus(state.methodPhase, state.view, index);
            return (
              <li
                key={phase}
                className={status === "current"
                  ? styles.phaseCurrent
                  : status === "complete"
                    ? styles.phaseComplete
                    : styles.phasePending}
                aria-current={status === "current" ? "step" : undefined}
              >
                <span>{index + 1}</span>
                {PHASE_LABELS[phase]}
              </li>
            );
          })}
        </ol>
      </header>

      {delivery.stage === "recall" && (
        <section className={styles.stage} aria-labelledby={`${gapGroupId}-retrieve`}>
          <div className={styles.closedSource}>
            <strong>Source closed</strong>
            <span>{delivery.sourceClosedReminder}</span>
          </div>
          <h4 id={`${gapGroupId}-retrieve`}>{delivery.prompt}</h4>
          <label className={styles.textareaLabel}>
            <span>Your closed-source broad recall</span>
            <textarea
              rows={9}
              maxLength={8_000}
              value={state.recallDraft}
              disabled={busy}
              placeholder="Write everything you can reconstruct from memory. Do not reopen the source yet."
              onChange={(event) => apply({
                type: "recall_changed",
                value: event.target.value,
              })}
            />
          </label>
          <div className={styles.actions}>
            <button
              className="button primary"
              type="button"
              disabled={busy || nextBroadRecallRuntimeRequestedStage(state) !== "compare"}
              onClick={() => void requestNextStage()}
            >
              {requestingStage === "compare" ? "Opening comparison…" : "Open source and compare"}
            </button>
            <small>Comparison material is absent until the matching next delivery arrives.</small>
          </div>
        </section>
      )}

      {delivery.stage === "compare" && (
        <section className={styles.stage} aria-labelledby={`${gapGroupId}-compare`}>
          <div className={styles.sourceOpen} role="status">
            <strong>Source open for comparison</strong>
            <span>{delivery.comparisonInstructions}</span>
          </div>
          <h4 id={`${gapGroupId}-compare`}>Compare what came back with the saved source</h4>
          <div className={styles.comparison} aria-label="Source comparison">
            <div>
              <span>Your recall</span>
              <p>{state.recallDraft || "Your recall text was cleared during recovery."}</p>
            </div>
            <div>
              <span>Saved source answer</span>
              <p>{delivery.savedSourceAnswer}</p>
            </div>
          </div>
          <fieldset className={styles.gaps} disabled={busy}>
            <legend>Classify every comparison gap</legend>
            {delivery.gapChecklist.map((gap, gapIndex) => (
              <fieldset key={`${gapIndex}:${gap}`} className={styles.gapItem}>
                <legend>{gapIndex + 1}. {gap}</legend>
                <div>
                  {GAP_CHOICES.map((choice) => (
                    <label key={choice.value}>
                      <input
                        type="radio"
                        name={`${gapGroupId}-gap-${gapIndex}`}
                        value={choice.value}
                        checked={state.gapStatuses[gapIndex] === choice.value}
                        onChange={() => apply({
                          type: "gap_classified",
                          index: gapIndex,
                          status: choice.value,
                        })}
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </fieldset>
          <div className={styles.actions}>
            <button
              className="button primary"
              type="button"
              disabled={busy || nextBroadRecallRuntimeRequestedStage(state) !== "repair"}
              onClick={() => void requestNextStage()}
            >
              {requestingStage === "repair" ? "Closing source…" : "Close source and repair gaps"}
            </button>
            <small>Progress advances only after the matching repair delivery arrives.</small>
          </div>
        </section>
      )}

      {delivery.stage === "repair" && (
        <section className={styles.stage} aria-labelledby={`${gapGroupId}-repair`}>
          <div className={styles.closedSource}>
            <strong>Source closed again</strong>
            <span>{delivery.sourceClosedReminder}</span>
          </div>
          <h4 id={`${gapGroupId}-repair`}>Write the correction, not another copy</h4>
          <p className={styles.instruction}>{delivery.correctionInstruction}</p>
          {comparison && (
            <dl className={styles.gapSummary} aria-label="Gap classification summary">
              {GAP_CHOICES.map((choice) => (
                <div key={choice.value}>
                  <dt>{choice.label}</dt>
                  <dd>{comparison.gapStatuses.filter((status) => (
                    status === choice.value
                  )).length}</dd>
                </div>
              ))}
            </dl>
          )}
          <label className={styles.textareaLabel}>
            <span>Your memory-only correction</span>
            <textarea
              rows={7}
              maxLength={6_000}
              value={state.correctionDraft}
              disabled={busy}
              placeholder="Correct the missing or inaccurate relationships in your own words."
              onChange={(event) => apply({
                type: "correction_changed",
                value: event.target.value,
              })}
            />
          </label>
          <div className={styles.actions}>
            <button
              className="button primary"
              type="button"
              disabled={busy || nextBroadRecallRuntimeRequestedStage(state) !== "transfer"}
              onClick={() => void requestNextStage()}
            >
              {requestingStage === "transfer" ? "Loading fresh check…" : "Continue to the fresh check"}
            </button>
            <small>The correction stays in memory and is never written to durable progress.</small>
          </div>
        </section>
      )}

      {delivery.stage === "transfer" && (
        <section className={styles.stage} aria-labelledby={`${gapGroupId}-transfer`}>
          <div className={styles.closedSource}>
            <strong>Source closed for transfer</strong>
            <span>{delivery.sourceClosedReminder}</span>
          </div>
          <h4 id={`${gapGroupId}-transfer`}>{delivery.prompt}</h4>
          <label className={styles.textareaLabel}>
            <span>Your fresh closed-source transfer answer</span>
            <textarea
              rows={7}
              value={state.transferDraft}
              disabled={busy}
              aria-describedby={`${gapGroupId}-transfer-constraints`}
              placeholder="Answer the new question without reopening the source."
              onChange={(event) => apply({
                type: "transfer_changed",
                value: event.target.value,
              })}
            />
          </label>
          <p id={`${gapGroupId}-transfer-constraints`} className={styles.instruction}>
            Use {delivery.answerConstraints.minCharacters}–{delivery.answerConstraints.maxCharacters}
            {" "}Unicode characters with no leading or trailing whitespace.
          </p>
          <div className={styles.actions}>
            <button
              className="button primary"
              type="button"
              disabled={busy || nextBroadRecallRuntimeRequestedStage(state) !== "complete"}
              onClick={() => void requestNextStage()}
            >
              {requestingStage === "complete" ? "Checking transfer…" : "Check transfer"}
            </button>
            <small>Only the evaluator transport receives this answer; progress stores results only after an accepted completion delivery.</small>
          </div>
        </section>
      )}

      {delivery.stage === "complete" && (
        <section
          className={styles.stage}
          aria-labelledby={`${gapGroupId}-complete`}
          aria-live="polite"
        >
          <p className={styles.eyebrow}>BLURTING COMPLETE</p>
          <h4 id={`${gapGroupId}-complete`}>Transfer results by saved target</h4>
          <ul className={styles.results}>
            {delivery.completion.orderedResults.map((binding, index) => (
              <li key={binding.targetId} data-result={binding.result}>
                <span>{delivery.orderedTargets[index]?.displayLabel}</span>
                <strong>{RESULT_LABELS[binding.result]}</strong>
              </li>
            ))}
          </ul>
          <div className={styles.referenceAnswer}>
            <span>References revealed by the accepted completion delivery</span>
            {delivery.orderedReferences.map((binding, index) => (
              <div key={binding.targetId}>
                <strong>{delivery.orderedTargets[index]?.displayLabel}</strong>
                <p>{binding.referenceAnswer}</p>
              </div>
            ))}
          </div>
          {delivery.completion.orderedResults.some(({ result }) => (
            result === "unverified"
          )) && (
            <p className={styles.unverified} role="status">
              An unverified target is not counted as secure; it remains marked for review.
            </p>
          )}
        </section>
      )}

      {requestIssue && delivery.stage !== "complete" && (
        <div className={styles.evaluatorIssue} role="alert">
          <strong>Stage unavailable</strong>
          <span>{requestIssue}</span>
        </div>
      )}
    </section>
  );
}

function phaseStatus(
  currentPhase: BroadRecallRuntimeMethodPhase,
  view: BroadRecallRuntimeView,
  phaseIndex: number,
) {
  if (view === "complete") return "complete" as const;
  const currentIndex = BROAD_RECALL_RUNTIME_PHASES.indexOf(currentPhase);
  if (phaseIndex < currentIndex) return "complete" as const;
  if (phaseIndex === currentIndex) return "current" as const;
  return "pending" as const;
}

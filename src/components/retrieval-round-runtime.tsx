"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, EyeOff, RotateCcw } from "lucide-react";
import type { MethodRuntime } from "@/lib/session-generation/method-runtime";
import {
  isRetrievalRoundComplete,
  recordRecall,
  revealActivePrompt,
  startRetrievalRound,
  summarizeRetrievalRound,
  type RetrievalRecall,
  type RetrievalRoundSummary,
} from "@/lib/learning/retrieval-round-progress";

import styles from "./retrieval-round-runtime.module.css";

type RetrievalRound = Extract<MethodRuntime, { kind: "retrieval_round" }>;

export type RetrievalRoundRuntimeProps = {
  runtime: RetrievalRound;
  onComplete?: (summary: RetrievalRoundSummary) => void;
};

const RECALL_CHOICES: Array<{ value: RetrievalRecall; label: string; hint: string }> = [
  { value: "got_it", label: "I had it", hint: "Retrieved without help" },
  { value: "partly", label: "Partly", hint: "Some of it came back" },
  { value: "missed", label: "Missed it", hint: "Could not retrieve it" },
];

/**
 * Retrieval practice delivered as itself.
 *
 * The learner sees one prompt at a time, must commit an attempt before any
 * answer appears, and rates what actually came back from memory. Anything not
 * retrieved returns later in the same round. A hint is available only after an
 * attempt, so it repairs a stalled retrieval instead of replacing one.
 */
export function RetrievalRoundRuntime({ runtime, onComplete }: RetrievalRoundRuntimeProps) {
  const [state, setState] = useState(() => startRetrievalRound(runtime.prompts.length));
  const [attempt, setAttempt] = useState("");
  const [hintShown, setHintShown] = useState(false);

  const complete = isRetrievalRoundComplete(state);
  const summary = useMemo(() => summarizeRetrievalRound(state), [state]);
  const activeIndex = state.activeIndex;
  const activePrompt = activeIndex === null ? null : runtime.prompts[activeIndex];
  const activeState = activeIndex === null ? null : state.prompts[activeIndex];
  const answered = state.prompts.filter((prompt) => prompt.lastRecall !== null).length;

  if (complete) {
    return (
      <section className={styles.round} aria-live="polite">
        <header className={styles.header}>
          <span className={styles.eyebrow}>RECALL ROUND COMPLETE</span>
          <h3>What came back without your notes</h3>
        </header>
        <dl className={styles.summary}>
          <div><dt>Retrieved</dt><dd>{summary.remembered}</dd></div>
          <div><dt>Shaky</dt><dd>{summary.shaky}</dd></div>
          <div><dt>Missed</dt><dd>{summary.missed}</dd></div>
        </dl>
        <p className={styles.note}>
          {summary.unresolvedIndexes.length === 0
            ? "You retrieved every prompt in this round."
            : `${summary.unresolvedIndexes.length} ${summary.unresolvedIndexes.length === 1 ? "prompt" : "prompts"} did not come back reliably. YOVA will bring ${summary.unresolvedIndexes.length === 1 ? "it" : "them"} back in a later check rather than counting ${summary.unresolvedIndexes.length === 1 ? "it" : "them"} as learned.`}
        </p>
        {onComplete && (
          <button className="button primary" type="button" onClick={() => onComplete(summary)}>
            Continue <ArrowRight size={16} />
          </button>
        )}
      </section>
    );
  }

  if (!activePrompt || !activeState) return null;

  const goNext = (recall: RetrievalRecall) => {
    setState((current) => recordRecall(current, recall));
    setAttempt("");
    setHintShown(false);
  };

  return (
    <section className={styles.round}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>RECALL ROUND</span>
        <h3>{runtime.sourceClosedReminder}</h3>
        <p className={styles.progress}>
          {answered} of {summary.total} answered
          {/* Revealing an answer counts an attempt, so the badge must wait for
              the prompt to actually come back rather than firing mid-question. */}
          {activeState.attempts > 0 && !activeState.revealed
            && <span className={styles.repeat}><RotateCcw size={13} /> second pass</span>}
        </p>
      </header>

      <div className={styles.prompt}>
        <p className={styles.promptText}>{activePrompt.prompt}</p>

        {!activeState.revealed ? (
          <>
            <label className={styles.attemptLabel}>
              <span>Your answer, from memory</span>
              <textarea
                rows={4}
                value={attempt}
                autoFocus
                placeholder="Write what you can recall. An incomplete answer is still useful."
                onChange={(event) => setAttempt(event.target.value)}
              />
            </label>

            {activePrompt.hint && (
              hintShown
                ? <p className={styles.hint}>{activePrompt.hint}</p>
                : (
                  <button className={styles.hintButton} type="button" onClick={() => setHintShown(true)}>
                    I am stuck — show a hint
                  </button>
                )
            )}

            <div className={styles.actions}>
              <button
                className="button primary"
                type="button"
                disabled={attempt.trim().length === 0}
                onClick={() => setState(revealActivePrompt)}
              >
                <EyeOff size={16} /> Check what I recalled
              </button>
              <small className={styles.gate}>
                The answer stays hidden until you have written something.
              </small>
            </div>
          </>
        ) : (
          <>
            <div className={styles.comparison}>
              <div>
                <span className={styles.comparisonLabel}>You wrote</span>
                <p className={styles.learnerText}>{attempt}</p>
              </div>
              <div>
                <span className={styles.comparisonLabel}>Expected</span>
                <p className={styles.expectedText}>{activePrompt.expectedAnswer}</p>
              </div>
            </div>

            <fieldset className={styles.recall}>
              <legend>How much of that actually came back?</legend>
              <div className={styles.recallChoices}>
                {RECALL_CHOICES.map((choice) => (
                  <button key={choice.value} type="button" onClick={() => goNext(choice.value)}>
                    {choice.value === "got_it" && <Check size={15} />}
                    <strong>{choice.label}</strong>
                    <small>{choice.hint}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </section>
  );
}

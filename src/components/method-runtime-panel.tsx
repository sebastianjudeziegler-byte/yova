import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Network } from "lucide-react";
import type { MethodRuntime } from "@/lib/session-generation/method-runtime";

import styles from "./method-runtime-panel.module.css";

type WorkedExampleRuntime = Extract<MethodRuntime, { kind: "worked_example" }>;
type ErrorRepairRuntime = Extract<MethodRuntime, { kind: "error_repair" }>;
type ConceptMapRuntime = Extract<MethodRuntime, { kind: "concept_map" }>;

function conceptMapNodeLabel(runtime: ConceptMapRuntime, nodeId: string) {
  return runtime.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function conceptMapLinePrefix(runtime: ConceptMapRuntime, index: number) {
  const connection = runtime.connections[index];
  if (!connection) return "";
  return `${index + 1}. ${conceptMapNodeLabel(runtime, connection.fromId)} → ${conceptMapNodeLabel(runtime, connection.toId)}: `;
}

export function conceptMapDraftPhrases(runtime: ConceptMapRuntime, value: string) {
  const lines = value.split("\n");
  return runtime.connections.map((_, index) => {
    const prefix = conceptMapLinePrefix(runtime, index);
    const line = lines[index] ?? "";
    return line.startsWith(prefix) ? line.slice(prefix.length) : "";
  });
}

export function conceptMapDraftAnswer(runtime: ConceptMapRuntime, phrases: readonly string[]) {
  return runtime.connections
    .map((_, index) => `${conceptMapLinePrefix(runtime, index)}${phrases[index]?.trim() ?? ""}`)
    .join("\n");
}

export function conceptMapDraftIsComplete(runtime: ConceptMapRuntime, value: string | null) {
  if (!value) return false;
  return conceptMapDraftPhrases(runtime, value).every((phrase) => phrase.trim().length >= 3);
}

export function WorkedExampleRuntimePanel({ runtime }: { runtime: WorkedExampleRuntime }) {
  return <section className={styles.panel} aria-label="Worked example with fading">
    <header className={styles.header}>
      <div><Eye size={17} /><span>WORKED EXAMPLE</span></div>
      <strong>Study the reasoning, then supply the faded step</strong>
    </header>

    <div className={styles.problem}>
      <span>COMPLETE MODEL</span>
      <h2>{runtime.problem}</h2>
      <ol className={styles.steps}>{runtime.steps.map((step, index) => <li key={`${index}-${step.statement}`}>
        <span>{index + 1}</span>
        <div><strong>{step.statement}</strong><p>{step.why}</p></div>
      </li>)}</ol>
    </div>

    <div className={styles.faded}>
      <span>SUPPORT FADES HERE</span>
      <h3>{runtime.fadedProblem}</h3>
      <ol className={styles.fadedSteps}>{runtime.fadedSteps.map((step, index) => <li key={`${index}-${step.statement}`} className={step.prompt ? styles.missing : undefined}>
        <span>{index + 1}</span>
        <div>
          {step.prompt
            ? <><strong>{step.prompt}</strong><small>Use the answer area below to supply this step before checking.</small></>
            : <strong>{step.statement}</strong>}
        </div>
      </li>)}</ol>
    </div>
  </section>;
}

export function ErrorRepairRuntimePanel({ runtime }: { runtime: ErrorRepairRuntime }) {
  return <section className={styles.panel} aria-label="Practice-test error repair">
    <header className={styles.header}>
      <div><AlertTriangle size={17} /><span>ERROR REPAIR</span></div>
      <strong>Rebuild the rule, then apply it to a fresh case</strong>
    </header>

    <div className={styles.repairGrid}>
      <article>
        <span>WHAT WENT WRONG</span>
        <h3>{runtime.observedError}</h3>
        <p>{runtime.whyItSeemedReasonable}</p>
      </article>
      <article>
        <span>RULE CONTRAST</span>
        <p className={styles.incorrect}><AlertTriangle size={15} /> {runtime.incorrectRule}</p>
        <p className={styles.correct}><CheckCircle2 size={15} /> {runtime.correctRule}</p>
      </article>
    </div>

    <div className={styles.warning}><strong>Watch for this cue</strong><p>{runtime.warningSign}</p></div>
    <div className={styles.corrected}><span>CORRECTED EXAMPLE</span><p>{runtime.correctedExample}</p></div>
    <div className={styles.transfer}><ArrowRight size={17} /><div><span>FRESH CHECK</span><strong>{runtime.parallelPrompt}</strong><small>Answer this in the activity response below before comparing with the model.</small></div></div>
  </section>;
}

export function ConceptMapRuntimePanel({
  runtime,
  value,
  disabled,
  revealExpected,
  onChange,
}: {
  runtime: ConceptMapRuntime;
  value: string;
  disabled: boolean;
  revealExpected: boolean;
  onChange: (value: string) => void;
}) {
  const phrases = conceptMapDraftPhrases(runtime, value);

  return <section className={styles.panel} aria-label="Concept map builder">
    <header className={styles.header}>
      <div><Network size={17} /><span>CONCEPT MAP</span></div>
      <strong>Build each connection with a relationship phrase</strong>
    </header>
    <div className={styles.mapInstructions}><p>{runtime.instructions}</p><small>Your phrases stay in this check only; YOVA stores the result, not your draft map.</small></div>
    <div className={styles.nodeCloud} aria-label="Concepts to connect">
      {runtime.nodes.map((node) => <span key={node.id}>{node.label}</span>)}
    </div>
    <ol className={styles.connectionList}>
      {runtime.connections.map((connection, index) => {
        const from = conceptMapNodeLabel(runtime, connection.fromId);
        const to = conceptMapNodeLabel(runtime, connection.toId);
        return <li key={`${connection.fromId}-${connection.toId}`}>
          <div className={styles.connectionHeading}><strong>{from}</strong><ArrowRight size={16} /><strong>{to}</strong></div>
          <label htmlFor={`concept-map-${index}`}><span>{connection.prompt}</span><input
            id={`concept-map-${index}`}
            type="text"
            value={phrases[index] ?? ""}
            disabled={disabled}
            placeholder="Write the relationship, not just a linking word"
            onChange={(event) => {
              const next = [...phrases];
              next[index] = event.target.value;
              onChange(conceptMapDraftAnswer(runtime, next));
            }}
          /></label>
          {revealExpected && <div className={styles.expectedRelationship}><span>REFERENCE RELATIONSHIP</span><p>{connection.expectedRelationship}</p></div>}
        </li>;
      })}
    </ol>
  </section>;
}

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import type { SessionRoute } from "@/lib/routing/session-route";
import type { HubRail } from "@/lib/session-shapes/session-hub";
import type { SessionTip } from "@/lib/session-shapes/session-tips";
import type { SourceDescription } from "@/lib/session-shapes/slots-schema";
import styles from "./session-hub.module.css";

/**
 * The in-session hub around the step card (Brief 1.5 item 6; handoff
 * docs/redesign/design/session-hub-3a.md, frame 3A). Presentational only: the
 * shape reducers own progression, and every reason shown is a fired rule.
 */

/** "STEP 2 OF 5" for the step card's kicker row. */
export const StepPosition = createContext<string | null>(null);

export function StepHead({ children }: { children: ReactNode }) {
  const position = useContext(StepPosition);
  return <div className={styles.stepHead}>
    <span className={styles.kicker}>{children}</span>
    {position && <span className={styles.stepOf}>{position}</span>}
  </div>;
}

export function HubHeader({ eyebrow, topic, methodLine, onExit, exitIcon }: { eyebrow: string; topic: string; methodLine: string; onExit: () => void; exitIcon: ReactNode }) {
  return <header className={styles.header}>
    <div className={styles.headerMeta}>
      <span className={styles.kicker}>{eyebrow}</span>
      <strong className={styles.topic}>{topic}</strong>
      <small className={styles.methodLine}>{methodLine}</small>
    </div>
    <button type="button" className={styles.exit} onClick={onExit}>{exitIcon} Exit session</button>
  </header>;
}

export type MethodControl = "hidden" | "enabled" | "locked";

export function HubBriefing({ route, pills, methodControl, methodPanelOpen, onToggleMethodPanel }: {
  route: SessionRoute;
  pills: Array<{ ruleId: string; head: string }>;
  methodControl: MethodControl;
  methodPanelOpen: boolean;
  onToggleMethodPanel: () => void;
}) {
  const method = CORE_METHOD_CATALOG[route.methodId];
  return <section className={styles.briefing} aria-label="How to study this">
    <div className={styles.briefingLead}>
      <span className={styles.kicker}>HOW TO STUDY THIS</span>
      <h2 className={styles.methodName}>{route.methodName}</h2>
      <p className={styles.methodWhat}>{method.what}</p>
      {methodControl === "enabled" && <button type="button" className={styles.changeMethod} aria-expanded={methodPanelOpen} onClick={onToggleMethodPanel}>Change method before you start</button>}
      {methodControl === "locked" && <>
        <button type="button" className={styles.changeMethodLocked} disabled>Method locked for this session</button>
        <p className={styles.lockedLine}>Locked once you start producing. Switching now would throw away the work this session is measuring.</p>
      </>}
    </div>
    <div className={styles.briefingDetail}>
      <ol className={styles.instructions}>
        {method.how.map((instruction, index) => <li key={instruction}><span className={styles.indexChip} aria-hidden="true">{index + 1}</span><span>{instruction}</span></li>)}
      </ol>
      {pills.length > 0 && <div className={styles.because}>
        <span className={styles.becauseLabel}>CHOSEN BECAUSE</span>
        <ul>{pills.map((pill) => <li key={pill.ruleId} data-pill-rule-id={pill.ruleId}>{pill.head}</li>)}</ul>
      </div>}
    </div>
  </section>;
}

export function HubTipCard({ tip, stepNumber, planId, topicTitle }: { tip: SessionTip; stepNumber: number; planId: string; topicTitle: string }) {
  return <section className={styles.tip} aria-label="YOVA tip" data-testid="hub-tip" data-tip-step={tip.step} data-tip-rule-id={tip.ruleId} data-tip-origin={tip.origin}>
    <span className={styles.tipKicker}>YOVA TIP · STEP {stepNumber}</span>
    <p className={styles.tipTitle}>{tip.title}</p>
    <p className={styles.tipBody}>{tip.body}</p>
    <AskYova
      planId={planId}
      question={`Expand on this study tip for ${topicTitle}: ${tip.title} ${tip.body}`}
      idleLabel="Ask YOVA to expand"
      buttonClassName={styles.tipExpand}
      answerClassName={styles.tipAnswer}
    />
  </section>;
}

export function HubTimerCard({ clock, limitMinutes, progress, over, paused, hidden, onPause, onResume, onExtend, onHide, onShow, clockIcon }: {
  clock: string;
  limitMinutes: number;
  progress: number;
  over: boolean;
  paused: boolean;
  hidden: boolean;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
  onHide: () => void;
  onShow: () => void;
  clockIcon: ReactNode;
}) {
  if (hidden) return <button type="button" className={styles.timerShow} onClick={onShow}>Timer hidden, show it</button>;
  return <section className={styles.card} aria-label="Timer" data-timer-over={over}>
    <div className={styles.clockRow}>
      <span className={styles.clock} aria-label={`Session timer, ${limitMinutes} minute nudge`}>{clock}</span>
      <span className={styles.clockLimit}>/ {limitMinutes}:00</span>
      <span className={over ? styles.overPill : styles.pacePill}>{clockIcon} {over ? "OVER" : paused ? "PAUSED" : "RUNNING"}</span>
    </div>
    <div className={styles.bar} role="progressbar" aria-label="Time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <span className={over ? styles.barFillOver : styles.barFill} style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
    <div className={styles.timerControls}>
      {paused ? <button type="button" className={styles.ghost} onClick={onResume}>Resume</button> : <button type="button" className={styles.ghost} onClick={onPause}>Pause</button>}
      <button type="button" className={styles.ghost} aria-label="Add 5 minutes" onClick={onExtend}>+5</button>
      <button type="button" className={styles.ghost} onClick={onHide}>Hide</button>
    </div>
  </section>;
}

export function HubShapeCard({ rail }: { rail: HubRail }) {
  return <section className={styles.card} aria-label="Session shape">
    <span className={styles.kicker}>{rail.kicker}</span>
    <ol className={styles.shapeSteps}>
      {rail.rows.map((row, index) => <li key={`${row.key}-${index}`} data-status={row.status} aria-current={row.status === "current" ? "step" : undefined}>
        <span className={styles.shapeIndex} aria-hidden="true">{index + 1}</span>
        <span className={styles.shapeLabel}><strong>{row.label}</strong><small>{row.blurb}</small></span>
        <span className={styles.shapeMinutes}>{row.minutes === null ? "" : `${row.minutes} MIN`}</span>
      </li>)}
    </ol>
  </section>;
}

export function HubTargetCard({ target }: { target: string }) {
  return <section className={styles.card} aria-label="Today's target">
    <span className={styles.kicker}>TODAY&apos;S TARGET</span>
    <p className={styles.target}>{target}</p>
  </section>;
}

export function HubSourceCard({ source }: { source: SourceDescription | null }) {
  return <section className={styles.card} aria-label="Your source">
    <span className={styles.kicker}>YOUR SOURCE</span>
    <p className={styles.sourceLine}>{source ? `${source.name}${source.location ? ` · ${source.location}` : ""}` : "No material added. YOVA explains this topic in the session."}</p>
  </section>;
}

type AskStatus = "idle" | "loading" | "ready" | "error";

/**
 * One ephemeral tutor question, answered inline so the learner stays in the
 * session. Used on a wrong answer and by the tip's expand action.
 */
export function AskYova({ planId, question, idleLabel, buttonClassName, answerClassName }: { planId: string; question: string; idleLabel: string; buttonClassName: string; answerClassName: string }) {
  const [status, setStatus] = useState<AskStatus>("idle");
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, planId, persistenceMode: "ephemeral", history: [] }),
      });
      const body = await response.json().catch(() => null) as { messages?: Array<{ role: string; content: string }>; error?: string } | null;
      const reply = body?.messages?.find((message) => message.role === "assistant")?.content;
      if (!response.ok || !reply) throw new Error(body?.error ?? "YOVA could not explain this right now.");
      setAnswer(reply);
      setStatus("ready");
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "YOVA could not explain this right now.");
      setStatus("error");
    }
  };
  if (status === "idle") return <button type="button" className={buttonClassName} onClick={() => void ask()}><HelpCircle size={15} /> {idleLabel}</button>;
  if (status === "loading") return <span className={styles.asking}><span className="button-spinner dark" /> Asking YOVA…</span>;
  return <div className={answerClassName} role={status === "error" ? "alert" : undefined} data-testid="baseline-ask-yova"><strong>{status === "error" ? "YOVA could not explain this right now." : "YOVA explains"}</strong><p>{answer}</p></div>;
}

"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, Clock3, HelpCircle, RotateCcw, Sparkles, X } from "lucide-react";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { KeyPoint, PracticeQuestion } from "@/lib/practice/compose-practice";
import { personalizationNote } from "@/lib/routing/personalization-note";
import {
  alternativeProduceSteps,
  methodNameForProduceStep,
  type ProduceStep,
  type SessionRoute,
  type SessionShape,
} from "@/lib/routing/session-route";
import {
  currentShapeAStep,
  initialShapeAState,
  produceAsText,
  produceStepLabel,
  shapeAReducer,
  type ShapeAComparison,
  type ShapeAProduceInput,
  type ShapeAState,
} from "@/lib/session-shapes/shape-a";
import {
  currentShapeCQuestion,
  currentShapeCRound,
  initialShapeCState,
  lastShapeCAnswer,
  SHAPE_C_ESCALATION_MESSAGE,
  shapeCReducer,
  shapeCTotals,
  type ShapeCState,
} from "@/lib/session-shapes/shape-c";
import { makeSlotIds, requestComparison, requestDirection, requestLearnBlock, requestPractice, ShapeSlotClientError } from "@/lib/session-shapes/slots-client";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";
import {
  SHAPE_SLOT_HONEST_ERROR,
  type DirectionResponse,
  type LearnBlockResponse,
  type SourceDescription,
  type SourceExcerpt,
} from "@/lib/session-shapes/slots-schema";
import styles from "./baseline-session.module.css";

/**
 * The baseline session runner. Shape A and Shape C are coded step sequences
 * (docs/redesign/01-SESSION-SHAPES.md); this component renders whatever step
 * the reducers say is current and asks the API to fill one bounded slot at a
 * time. It never assembles a session and never sizes it to a time slot.
 */
export type BaselineSessionSource = {
  description: SourceDescription | null;
  excerpts: SourceExcerpt[];
};

export type BaselineSessionResult = {
  shape: SessionShape;
  methodName: string;
  ruleIds: string[];
  noteRuleId: string;
  correctAnswers: number;
  totalAnswers: number;
  keyPointOutcomes: Array<{ keyPointId: string; text: string; outcome: "secure" | "needs_review" }>;
  topicDone: boolean;
  escalated: boolean;
  produced: string | null;
  comparison: ShapeAComparison | null;
  elapsedSeconds: number;
};

export type BaselineSessionProps = {
  plan: LearningPlan;
  session: LearningPlanSession;
  topic: KnowledgeMapTopic | null;
  route: SessionRoute;
  nextSession: LearningPlanSession | null;
  onChangeProduceStep: (step: ProduceStep) => void;
  onExit: () => void;
  onComplete: (result: BaselineSessionResult) => Promise<boolean>;
};

type SlotStatus = "idle" | "loading" | "ready" | "error";

function slotErrorMessage(error: unknown) {
  if (error instanceof ShapeSlotClientError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return SHAPE_SLOT_HONEST_ERROR;
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function BaselineSession(props: BaselineSessionProps) {
  const { plan, session, topic, route, nextSession, onChangeProduceStep, onExit, onComplete } = props;
  const planMaterials = plan.materials;
  const planSourceMode = plan.sourceMode;
  const source: BaselineSessionSource = useMemo(
    () => baselineSourceForTopic({ materials: planMaterials, sourceMode: planSourceMode }, topic),
    [planMaterials, planSourceMode, topic],
  );
  const topicId = topic?.id ?? session.topicIds?.[0] ?? null;
  const topicTitle = topic?.title ?? session.title;
  const slotTopic = useMemo(() => ({
    id: topicId ?? "00000000-0000-4000-8000-000000000000",
    title: topicTitle,
    description: (topic?.description ?? session.objective).slice(0, 400).padEnd(8, "."),
    subtopics: (topic?.subtopics ?? []).slice(0, 12),
    taskType: route.input.taskType,
  }), [route.input.taskType, session.objective, topic, topicId, topicTitle]);
  const modifiers = useMemo(() => ({
    instructionStyle: route.instructionStyle,
    weighting: route.weighting,
    produceStep: route.produceStep,
    explanationFocus: route.explanationFocus,
    questionCap: route.questionCap,
  }), [route.explanationFocus, route.instructionStyle, route.produceStep, route.questionCap, route.weighting]);
  const note = useMemo(() => personalizationNote(route), [route]);

  // ---------------------------------------------------------------- timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    startedAtRef.current ??= Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1_000));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const timerOver = elapsedSeconds >= route.timerMinutes * 60;

  // ---------------------------------------------------------------- shapes
  const [aState, dispatchA] = useReducer(shapeAReducer, route, initialShapeAState);
  const [cState, dispatchC] = useReducer(shapeCReducer, route, initialShapeCState);
  // Active Recall: Shape A's study step hands off to closed-book questions.
  const handoffToQuestions = route.shape === "A" && route.produceStep === "retrieval_questions";
  const aStep = currentShapeAStep(aState);
  const inQuestions = route.shape === "C" || (handoffToQuestions && aStep?.kind === "end");
  const [started, setStarted] = useState(route.visibility !== "chooser");
  const [methodPanelOpen, setMethodPanelOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishIssue, setFinishIssue] = useState<string | null>(null);

  // ---------------------------------------------------------------- slots
  // Every request starts from an event (a click, or the first render's
  // hand-off) and only updates state when its promise settles, so no effect
  // sets state synchronously.
  const [direction, setDirection] = useState<DirectionResponse | null>(null);
  const [learnBlock, setLearnBlock] = useState<LearnBlockResponse | null>(null);
  const [learnStatus, setLearnStatus] = useState<SlotStatus>("idle");
  const [learnError, setLearnError] = useState<string | null>(null);
  const [compareStatus, setCompareStatus] = useState<SlotStatus>("idle");
  const [compareError, setCompareError] = useState<string | null>(null);
  const [practiceKeyPoints, setPracticeKeyPoints] = useState<KeyPoint[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const planId = plan.id;
  const planSessionId = session.id;

  const sourceDescription = source.description;
  const requestStudySlot = useCallback((signal: AbortSignal) => {
    const request = route.learnPath === "source" && sourceDescription
      ? requestDirection({ ...makeSlotIds(), planId, planSessionId, action: "direction", topic: slotTopic, modifiers, source: sourceDescription, entry: route.entry === "brief_review" ? "brief_review" : "study_full" }, signal)
        .then((result) => { setDirection(result); })
      : requestLearnBlock({ ...makeSlotIds(), planId, planSessionId, action: "learn_block", topic: slotTopic, modifiers }, signal)
        .then((result) => { setLearnBlock(result); setPracticeKeyPoints(result.keyPoints); });
    request.then(() => setLearnStatus("ready")).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      setLearnError(message);
      setLearnStatus("error");
    });
  }, [route.learnPath, route.entry, sourceDescription, slotTopic, modifiers, planId, planSessionId]);

  const needsStudySlot = started && !inQuestions && (
    (route.shape === "A" && (aStep?.kind === "direct" || aStep?.kind === "explanation" || aStep?.kind === "worked_structure"))
    || (route.shape === "C" && cState.phase === "brief_study")
  );
  // The effect owns its request: an unmount (including StrictMode's
  // development remount) aborts it, and the guard on status restarts it.
  useEffect(() => {
    if (!needsStudySlot || learnStatus !== "idle") return;
    const controller = new AbortController();
    requestStudySlot(controller.signal);
    return () => controller.abort();
  }, [needsStudySlot, learnStatus, requestStudySlot]);
  const retryStudySlot = () => {
    setLearnError(null);
    setLearnStatus("idle");
  };
  const studyLoading = learnStatus === "idle" && needsStudySlot;

  const sourceExcerpts = source.excerpts;
  const requestPracticeRound = useCallback((round: number, outstandingKeyPointIds: string[], keyPoints: KeyPoint[], signal: AbortSignal) => {
    requestPractice({
      ...makeSlotIds(),
      planId,
      planSessionId,
      action: "practice",
      topic: slotTopic,
      modifiers,
      round,
      keyPoints,
      outstandingKeyPointIds,
      excerpts: sourceExcerpts.slice(0, 8),
      attempt: crypto.randomUUID(),
    }, signal).then((result) => {
      if (!keyPoints.length) setPracticeKeyPoints(result.keyPoints);
      dispatchC({ type: "questions_ready", questions: result.questions });
    }).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      dispatchC({ type: "questions_failed", message });
    });
  }, [slotTopic, modifiers, sourceExcerpts, planId, planSessionId]);

  const nextRoundNumber = (currentShapeCRound(cState)?.number ?? 0) + 1;
  const outstandingKeyPointIds = cState.outstandingKeyPointIds;
  const practiceLoading = started && inQuestions && cState.phase === "loading";
  useEffect(() => {
    if (!practiceLoading) return;
    const controller = new AbortController();
    requestPracticeRound(nextRoundNumber, outstandingKeyPointIds, practiceKeyPoints, controller.signal);
    return () => controller.abort();
  }, [practiceLoading, nextRoundNumber, outstandingKeyPointIds, practiceKeyPoints, requestPracticeRound]);
  const retryPractice = () => dispatchC({ type: "continue" });

  /**
   * Round 1 of an AI-explained block reuses the questions generated in the
   * same call as the explanation: practice cannot test what the explanation
   * did not cover. Dispatched from the click that enters the questions.
   */
  const enterQuestionsFromLearnBlock = () => {
    if (!learnBlock || currentShapeCRound(cState)) return;
    dispatchC({ type: "questions_ready", questions: learnBlock.questions });
  };

  const continueShapeA = () => {
    const next = shapeAReducer(aState, { type: "continue" });
    dispatchA({ type: "continue" });
    if (handoffToQuestions && currentShapeAStep(next)?.kind === "end") enterQuestionsFromLearnBlock();
  };

  const requestCompare = useCallback((produce: ShapeAProduceInput) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    requestComparison({
      ...makeSlotIds(),
      planId,
      planSessionId,
      action: "compare",
      topic: slotTopic,
      modifiers,
      produced: produceAsText(produce).slice(0, 6_000),
      reference: { excerpts: sourceExcerpts.slice(0, 8), keyPoints: learnBlock?.keyPoints ?? [] },
    }, controller.signal).then((result) => {
      dispatchA({ type: "comparison_ready", comparison: { feedback: result.feedback, missing: result.missing, incorrect: result.incorrect } });
      setCompareStatus("ready");
    }).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      setCompareError(message);
      setCompareStatus("error");
    });
  }, [slotTopic, modifiers, sourceExcerpts, learnBlock, planId, planSessionId]);

  const submitProduce = (produce: ShapeAProduceInput) => {
    const next = shapeAReducer(aState, { type: "submit_produce", produce });
    if (next === aState) return;
    dispatchA({ type: "submit_produce", produce });
    if (currentShapeAStep(next)?.kind === "compare") {
      setCompareStatus("loading");
      setCompareError(null);
      requestCompare(produce);
    }
  };
  const retryCompare = () => {
    if (!aState.produce) return;
    setCompareStatus("loading");
    setCompareError(null);
    requestCompare(aState.produce);
  };

  // ---------------------------------------------------------------- end
  const totals = shapeCTotals(cState);
  const atEnd = route.shape === "A"
    ? (handoffToQuestions ? ["done", "escalate"].includes(cState.phase) : aStep?.kind === "end")
    : ["done", "escalate"].includes(cState.phase);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setFinishIssue(null);
    const outcomes = practiceKeyPoints.map((keyPoint) => ({
      keyPointId: keyPoint.id,
      text: keyPoint.text,
      outcome: cState.outstandingKeyPointIds.includes(keyPoint.id) || cState.phase === "escalate" ? "needs_review" as const : "secure" as const,
    })).filter(() => totals.total > 0);
    const ok = await onComplete({
      shape: route.shape,
      methodName: route.methodName,
      ruleIds: route.ruleIds,
      noteRuleId: note.ruleId,
      correctAnswers: totals.correct,
      totalAnswers: totals.total,
      keyPointOutcomes: outcomes,
      topicDone: cState.phase === "done",
      escalated: cState.phase === "escalate",
      produced: aState.produce ? produceAsText(aState.produce) : null,
      comparison: aState.comparison,
      elapsedSeconds,
    });
    if (!ok) {
      setFinishing(false);
      setFinishIssue("YOVA could not save this session. Your work is still on screen; try again.");
    }
  };

  // ---------------------------------------------------------------- render
  const stepList = route.shape === "A" ? aState.steps : [];
  const restate = route.instructionStyle === "plain_restated";
  const alternatives = alternativeProduceSteps(route);
  const canChangeMethod = route.visibility !== "silent" && alternatives.length > 0 && !inQuestions && aState.index === 0 && !aState.produce;

  return <div className={styles.shell} data-shape={route.shape} data-method={route.methodId} data-rule-ids={route.ruleIds.join(" ")}>
    <header className={styles.top}>
      <div className={styles.topMeta}>
        <span className="step-label">{route.shape === "A" ? "LEARN BLOCK" : "PRACTICE BLOCK"} · {plan.title}</span>
        <strong>{topicTitle}</strong>
        <small>Method: {route.methodName}{route.visibility === "silent" ? "" : " · chosen from your profile"}</small>
      </div>
      <div className={styles.topActions}>
        <span className={`${styles.timer} ${timerOver ? styles.timerOver : ""}`} aria-label={`Session timer, ${route.timerMinutes} minute nudge`}><Clock3 size={14} /> {formatClock(elapsedSeconds)} / {route.timerMinutes}:00</span>
        {canChangeMethod && <button type="button" className="button ghost" aria-expanded={methodPanelOpen} onClick={() => setMethodPanelOpen((open) => !open)}>Change method</button>}
        <button type="button" className="button ghost" onClick={onExit}><X size={16} /> Exit</button>
      </div>
    </header>

    {stepList.length > 0 && <ol className={styles.steps} aria-label="Session steps">
      {stepList.map((step, index) => <li key={`${step.kind}-${index}`} aria-current={index === aState.index ? "step" : undefined} data-done={index < aState.index}>{step.label}</li>)}
    </ol>}

    <div className={styles.content}>
      {timerOver && !aState.timerAcknowledged && !cState.timerAcknowledged && !atEnd && <div className={styles.nudge} role="status">
        <span><Clock3 size={16} /> Your {route.timerMinutes}-minute timer is up. Stop at a natural break, or keep going.</span>
        <button type="button" className="button secondary" onClick={() => { dispatchA({ type: "acknowledge_timer" }); dispatchC({ type: "acknowledge_timer" }); }}>Keep going</button>
      </div>}

      {(methodPanelOpen || !started) && route.visibility !== "silent" && <section className={styles.methodPanel} aria-label="Method choice">
        <span className="step-label">{route.visibility === "chooser" ? "CHOOSE HOW TO PROVE IT" : "CHANGE METHOD"}</span>
        <p>{note.sentence}</p>
        <div className={styles.methodOptions}>
          {route.produceStep && <button type="button" aria-pressed onClick={() => { setMethodPanelOpen(false); setStarted(true); }}><strong>{route.methodName}</strong> · {produceStepLabel(route.produceStep)} (YOVA&apos;s pick)</button>}
          {alternatives.map((step) => <button type="button" key={step} aria-pressed={false} onClick={() => { setMethodPanelOpen(false); setStarted(true); onChangeProduceStep(step); }}><strong>{methodNameForProduceStep(route, step)}</strong> · {produceStepLabel(step)}</button>)}
        </div>
        {!started && <button type="button" className="button primary" onClick={() => setStarted(true)}>Start with {route.methodName} <ArrowRight size={16} /></button>}
      </section>}

      {started && !atEnd && !inQuestions && route.shape === "A" && aStep && <ShapeAStepCard
        step={aStep.kind}
        route={route}
        state={aState}
        restate={restate}
        direction={direction}
        learnBlock={learnBlock}
        learnStatus={studyLoading ? "loading" : learnStatus}
        learnError={learnError}
        compareStatus={compareStatus}
        compareError={compareError}
        onRetryStudy={retryStudySlot}
        onRetryCompare={retryCompare}
        onContinue={continueShapeA}
        onSubmitProduce={submitProduce}
        onSubmitRepair={(text) => dispatchA({ type: "submit_repair", text })}
        onSkipRepair={() => dispatchA({ type: "skip_repair" })}
        onExit={onExit}
      />}

      {started && !atEnd && route.shape === "C" && cState.phase === "brief_study" && <section className={styles.card}>
        <span className="step-label">BRIEF STUDY</span>
        <h2>{topicTitle}</h2>
        {restate && <p className={styles.restated}>Read this once, then answer questions without it.</p>}
        {studyLoading && <p className={styles.loading}><span className="button-spinner dark" /> Preparing a short explanation…</p>}
        {learnStatus === "error" && <HonestError message={learnError} onRetry={retryStudySlot} onExit={onExit} />}
        {route.learnPath === "source" && direction && <><p>{direction.whatToLookAt}</p><p>{direction.howToApproach}</p></>}
        {learnBlock && <><div className={styles.explanation}>{learnBlock.explanation}</div><ul className={styles.keyPoints}>{learnBlock.keyPoints.map((keyPoint) => <li key={keyPoint.id}>{keyPoint.text}</li>)}</ul></>}
        {learnStatus === "ready" && <div className={styles.actions}><button type="button" className="button primary" onClick={() => { dispatchC({ type: "continue" }); enterQuestionsFromLearnBlock(); }}>Start the questions <ArrowRight size={16} /></button></div>}
      </section>}

      {started && !atEnd && inQuestions && <ShapeCCard
        state={cState}
        route={route}
        restate={restate}
        onAnswer={(choiceIndex) => dispatchC({ type: "answer", choiceIndex })}
        onNext={() => dispatchC({ type: "next" })}
        onStartNextRound={() => dispatchC({ type: "start_next_round" })}
        onRetry={retryPractice}
        planId={plan.id}
        onExit={onExit}
      />}

      {atEnd && <section className={styles.card} aria-labelledby="baseline-session-end-title">
        <span className="step-label">SESSION COMPLETE</span>
        <h2 id="baseline-session-end-title">{cState.phase === "escalate" ? "This one isn't sticking yet." : route.shape === "A" && !handoffToQuestions ? "You studied, produced and compared." : cState.phase === "done" ? "A full round passed clean." : "Practice complete."}</h2>
        {cState.phase === "escalate" && <div className={styles.feedback}><strong>{SHAPE_C_ESCALATION_MESSAGE}</strong><p>Your next learn block on this topic will use a different produce step.</p></div>}
        <div className={styles.endGrid}>
          {totals.total > 0 && <div><span>Questions</span><strong>{totals.correct} of {totals.total} correct</strong><small>{cState.rounds.length} {cState.rounds.length === 1 ? "round" : "rounds"}, checked in code</small></div>}
          {aState.comparison && <div><span>Compared</span><strong>{aState.comparison.missing.length === 0 && aState.comparison.incorrect.length === 0 ? "Nothing named as missing" : `${aState.comparison.missing.length} missing · ${aState.comparison.incorrect.length} to correct`}</strong><small>Feedback, not a verdict</small></div>}
          <div><span>What&apos;s next</span><strong>{nextSession ? nextSession.title : "Nothing else queued in this plan"}</strong><small>{nextSession ? `${nextSession.learningMode === "learn" ? "Learn block" : "Practice block"} · ${nextSession.estimatedMinutes} min` : "Add a topic or open another plan"}</small></div>
        </div>
        <p className={styles.note} data-rule-id={note.ruleId}><Sparkles size={16} /> <span>{note.sentence}</span></p>
        {finishIssue && <div className={styles.issue}><AlertCircle size={16} /><span>{finishIssue}</span></div>}
        <div className={styles.actions}>
          <button type="button" className="button primary large" disabled={finishing} onClick={() => void finish()}>{finishing ? "Saving…" : "Finish"} {!finishing && <ArrowRight size={16} />}</button>
        </div>
      </section>}
    </div>
  </div>;
}

function HonestError({ message, onRetry, onExit }: { message: string | null; onRetry: () => void; onExit: () => void }) {
  return <div className={styles.issue} role="alert">
    <AlertCircle size={18} />
    <div>
      <p>{message ?? SHAPE_SLOT_HONEST_ERROR}</p>
      <div className={styles.actions}>
        <button type="button" className="button secondary" onClick={onRetry}><RotateCcw size={14} /> Try again</button>
        <button type="button" className="button ghost" onClick={onExit}>Exit and add material</button>
      </div>
    </div>
  </div>;
}

function ShapeAStepCard({ step, route, state, restate, direction, learnBlock, learnStatus, learnError, compareStatus, compareError, onRetryStudy, onRetryCompare, onContinue, onSubmitProduce, onSubmitRepair, onSkipRepair, onExit }: {
  step: ShapeAState["steps"][number]["kind"];
  route: SessionRoute;
  state: ShapeAState;
  restate: boolean;
  direction: DirectionResponse | null;
  learnBlock: LearnBlockResponse | null;
  learnStatus: SlotStatus;
  learnError: string | null;
  compareStatus: SlotStatus;
  compareError: string | null;
  onRetryStudy: () => void;
  onRetryCompare: () => void;
  onContinue: () => void;
  onSubmitProduce: (produce: ShapeAProduceInput) => void;
  onSubmitRepair: (text: string) => void;
  onSkipRepair: () => void;
  onExit: () => void;
}) {
  const [text, setText] = useState("");
  const [concepts, setConcepts] = useState<string[]>(["", "", ""]);
  const [links, setLinks] = useState<Array<{ from: string; to: string; label: string }>>([{ from: "", to: "", label: "" }]);
  const [repair, setRepair] = useState("");
  const numbered = route.instructionStyle === "numbered_steps";

  if (step === "direct") {
    return <section className={styles.card}>
      <span className="step-label">{route.entry === "brief_review" ? "BRIEF REVIEW" : "STUDY YOUR MATERIAL"}</span>
      <h2>{direction?.whatToLookAt ?? "Open your material for this topic."}</h2>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Preparing your direction…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {direction && <p>{direction.howToApproach}</p>}
      {restate && <p className={styles.restated}>Task: study the material, then come back and continue.</p>}
      <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>I&apos;m going to study it <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "away") {
    return <section className={styles.card}>
      <span className="step-label">WHEN YOU ARE BACK</span>
      <h2>Take your time with the material.</h2>
      <p>Nothing is tracked while you are away. Continue when you have studied it.</p>
      {restate && <p className={styles.restated}>Task: come back and press Continue after studying.</p>}
      <div className={styles.actions}><button type="button" className="button primary large" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "explanation") {
    return <section className={styles.card}>
      <span className="step-label">{route.entry === "brief_review" ? "BRIEF REVIEW" : "READ THE EXPLANATION"}</span>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Building the explanation, key points and questions together…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {learnBlock && <>
        <div className={styles.explanation}>{learnBlock.explanation}</div>
        <div><strong>Key points</strong><ul className={styles.keyPoints}>{learnBlock.keyPoints.map((keyPoint) => <li key={keyPoint.id}>{keyPoint.text}</li>)}</ul></div>
        {restate && <p className={styles.restated}>Task: read this once. Next you will {route.produceStep ? produceStepLabel(route.produceStep).toLowerCase() : "continue"} with it hidden.</p>}
        <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
      </>}
    </section>;
  }
  if (step === "worked_structure") {
    return <section className={styles.card}>
      <span className="step-label">THE STRUCTURE FIRST</span>
      <h2>Here is the shape of it before you produce.</h2>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Preparing the structure…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      <ol className={styles.structure}>{(learnBlock?.structure ?? (direction ? [direction.whatToLookAt, direction.howToApproach] : [])).map((line, index) => <li key={index}>{line}</li>)}</ol>
      <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "produce") {
    const produceStep = route.produceStep ?? "typed_explanation";
    const label = produceStepLabel(produceStep);
    return <section className={styles.card}>
      <span className="step-label">PRODUCE · SOURCE HIDDEN</span>
      <h2>{label}</h2>
      {restate && <p className={styles.restated}>Task: {label.toLowerCase()}, without looking at the material.</p>}
      {numbered && <ol className={styles.structure}><li>Close the material.</li><li>{label}.</li><li>Submit it; YOVA names what is missing or wrong.</li></ol>}
      {produceStep === "concept_map" ? <div className={styles.mapGrid}>
        <div><strong>Concepts</strong><div className={styles.mapConcepts}>{concepts.map((concept, index) => <input key={index} aria-label={`Concept ${index + 1}`} value={concept} placeholder={`Concept ${index + 1}`} onChange={(event) => setConcepts(concepts.map((value, at) => (at === index ? event.target.value : value)))} />)}</div><button type="button" className="button ghost" onClick={() => setConcepts([...concepts, ""])}>Add concept</button></div>
        <div><strong>Labelled links</strong>{links.map((link, index) => <div className={styles.mapRow} key={index}><input aria-label={`Link ${index + 1} from`} placeholder="From" value={link.from} onChange={(event) => setLinks(links.map((value, at) => (at === index ? { ...value, from: event.target.value } : value)))} /><input aria-label={`Link ${index + 1} label`} placeholder="relationship" value={link.label} onChange={(event) => setLinks(links.map((value, at) => (at === index ? { ...value, label: event.target.value } : value)))} /><input aria-label={`Link ${index + 1} to`} placeholder="To" value={link.to} onChange={(event) => setLinks(links.map((value, at) => (at === index ? { ...value, to: event.target.value } : value)))} /><button type="button" className="button ghost" aria-label={`Remove link ${index + 1}`} onClick={() => setLinks(links.filter((_, at) => at !== index))}><X size={14} /></button></div>)}<button type="button" className="button ghost" onClick={() => setLinks([...links, { from: "", to: "", label: "" }])}>Add link</button></div>
        <div className={styles.actions}><button type="button" className="button primary" onClick={() => onSubmitProduce({ kind: "concept_map", concepts, links })}>Compare my map <ArrowRight size={16} /></button><small>Needs at least one concept and one labelled link.</small></div>
      </div> : <>
        <textarea className={styles.textarea} aria-label={label} value={text} placeholder={produceStep === "worked_solution" ? "Work the comparable problem step by step." : produceStep === "outline" ? "Your claim, then the supporting reasons in order." : "Explain it in your own words."} onChange={(event) => setText(event.target.value)} />
        <div className={styles.actions}><button type="button" className="button primary" disabled={!text.trim()} onClick={() => onSubmitProduce({ kind: produceStep === "outline" || produceStep === "worked_solution" ? produceStep : "typed_explanation", text })}>Compare with the source <ArrowRight size={16} /></button></div>
      </>}
    </section>;
  }
  if (step === "compare") {
    return <section className={styles.card}>
      <span className="step-label">COMPARE</span>
      <h2>What is missing or wrong</h2>
      {compareStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Comparing with the source…</p>}
      {compareStatus === "error" && <div className={styles.issue} role="alert"><AlertCircle size={18} /><div><p>{compareError ?? SHAPE_SLOT_HONEST_ERROR}</p><div className={styles.actions}><button type="button" className="button secondary" onClick={onRetryCompare}><RotateCcw size={14} /> Try again</button><button type="button" className="button ghost" onClick={onSkipRepair}>Move on without feedback</button></div></div></div>}
      {state.comparison && <div className={styles.feedback} data-testid="baseline-comparison">
        <p>{state.comparison.feedback}</p>
        {state.comparison.missing.length > 0 && <div><strong>Missing</strong><ul>{state.comparison.missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {state.comparison.incorrect.length > 0 && <div><strong>To correct</strong><ul>{state.comparison.incorrect.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <small>Feedback, not a verdict. Nothing here changes the topic&apos;s status.</small>
      </div>}
      {state.comparison && <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>}
    </section>;
  }
  if (step === "repair") {
    const gaps = [...(state.comparison?.missing ?? []), ...(state.comparison?.incorrect ?? [])];
    return <section className={styles.card}>
      <span className="step-label">REPAIR · OPTIONAL</span>
      <h2>Address the named gaps, or move on.</h2>
      {gaps.length > 0 ? <ul className={styles.keyPoints}>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p>Nothing was named as missing. You can add anything you want to fix.</p>}
      {restate && <p className={styles.restated}>Task: write the missing parts, or press Move on.</p>}
      <textarea className={styles.textarea} aria-label="Repair" value={repair} placeholder="Add or correct the parts named above." onChange={(event) => setRepair(event.target.value)} />
      <div className={styles.actions}>
        <button type="button" className="button primary" disabled={!repair.trim()} onClick={() => onSubmitRepair(repair)}>Save repair <ArrowRight size={16} /></button>
        <button type="button" className="button ghost" onClick={onSkipRepair}>Move on</button>
      </div>
    </section>;
  }
  return null;
}

function ShapeCCard({ state, route, restate, onAnswer, onNext, onStartNextRound, onRetry, planId, onExit }: {
  state: ShapeCState;
  route: SessionRoute;
  restate: boolean;
  onAnswer: (choiceIndex: number) => void;
  onNext: () => void;
  onStartNextRound: () => void;
  onRetry: () => void;
  planId: string;
  onExit: () => void;
}) {
  const round = currentShapeCRound(state);
  const question: PracticeQuestion | null = currentShapeCQuestion(state);
  const answer = lastShapeCAnswer(state);
  const answered = round?.answers.length ?? 0;
  if (state.phase === "loading") {
    return <section className={styles.card}><span className="step-label">CLOSED-BOOK PRACTICE</span><p className={styles.loading}><span className="button-spinner dark" /> Writing fresh questions for this attempt…</p></section>;
  }
  if (state.phase === "failed") {
    return <section className={styles.card}><span className="step-label">CLOSED-BOOK PRACTICE</span><HonestError message={state.error} onRetry={onRetry} onExit={onExit} /></section>;
  }
  if (state.phase === "round_complete") {
    return <section className={styles.card}>
      <span className="step-label">ROUND {round?.number} COMPLETE</span>
      <h2>{state.outstandingKeyPointIds.length} {state.outstandingKeyPointIds.length === 1 ? "point" : "points"} still to pass.</h2>
      <p>Round {(round?.number ?? 0) + 1} of at most {state.roundCeiling} covers only what was missed, with fresh questions.</p>
      <div className={styles.actions}><button type="button" className="button primary" onClick={onStartNextRound}>Start round {(round?.number ?? 0) + 1} <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (!round || !question) return null;
  const revealed = state.phase === "revealed" && answer?.questionId === question.id;
  const shownQuestion = revealed ? round.questions[round.answers.length - 1] : question;
  const shownAnswer = revealed ? answer : null;
  return <section className={styles.card} data-testid="baseline-question">
    <span className="step-label">ROUND {round.number} · QUESTION {Math.min(answered + (revealed ? 0 : 1), round.questions.length)} OF {round.questions.length}</span>
    <p className={styles.progressLine}>{route.weighting === "terms_first" ? "Definitions and terms first." : "Relationships and comparisons first."} No source shown.</p>
    <h2>{shownQuestion.prompt}</h2>
    {restate && !revealed && <p className={styles.restated}>Task: choose one answer.</p>}
    <div className={styles.choices} role="group" aria-label="Answer choices">
      {shownQuestion.choices.map((choice, index) => {
        const isCorrect = index === shownQuestion.correctChoiceIndex;
        const chosen = shownAnswer?.choiceIndex === index;
        const className = [styles.choice, revealed && isCorrect ? styles.choiceCorrect : "", revealed && chosen && !isCorrect ? styles.choiceWrong : ""].join(" ");
        return <button type="button" key={index} className={className} disabled={revealed} aria-pressed={chosen} onClick={() => onAnswer(index)}>
          {revealed && isCorrect && <Check size={16} aria-label="Correct answer" />}
          {revealed && chosen && !isCorrect && <X size={16} aria-label="Your answer" />}
          <span>{choice}</span>
        </button>;
      })}
    </div>
    {revealed && shownAnswer && <div className={styles.feedback} data-testid="baseline-reveal" data-correct={shownAnswer.correct}>
      <strong>{shownAnswer.correct ? "Correct." : `Not quite. The answer is: ${shownQuestion.choices[shownQuestion.correctChoiceIndex]}`}</strong>
      <p>{shownQuestion.explanation}</p>
      <div className={styles.actions}>
        <button type="button" className="button primary" onClick={onNext}>{answered < round.questions.length ? "Next question" : "Finish round"} <ArrowRight size={16} /></button>
        {!shownAnswer.correct && <AskYovaInline key={shownQuestion.id} planId={planId} question={`Why is "${shownQuestion.choices[shownQuestion.correctChoiceIndex]}" the right answer to: ${shownQuestion.prompt}`} />}
      </div>
    </div>}
  </section>;
}

/**
 * "Ask YOVA" on a wrong answer: one ephemeral tutor question, answered inline
 * so the learner stays in the session. No forced repeat, no repair loop.
 */
function AskYovaInline({ planId, question }: { planId: string; question: string }) {
  const [status, setStatus] = useState<SlotStatus>("idle");
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
  if (status === "idle") return <button type="button" className="button ghost" onClick={() => void ask()}><HelpCircle size={15} /> Ask YOVA</button>;
  if (status === "loading") return <span className={styles.loading}><span className="button-spinner dark" /> Asking YOVA…</span>;
  return <div className={styles.feedback} role={status === "error" ? "alert" : undefined} data-testid="baseline-ask-yova"><strong>{status === "error" ? "YOVA could not explain this right now." : "YOVA explains"}</strong><p>{answer}</p></div>;
}

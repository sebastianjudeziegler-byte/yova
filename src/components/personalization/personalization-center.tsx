"use client";

import {
  BatteryMedium,
  CalendarClock,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  Eye,
  FlaskConical,
  Focus,
  History as HistoryIcon,
  ListChecks,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  SearchCheck,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS,
  STUDY_PROFILE_DIMENSION_CONTENT,
  STUDY_PROFILE_PRODUCT_ADAPTATIONS,
} from "@/lib/study-profile/content";
import { STUDY_PROFILE_QUESTIONS } from "@/lib/study-profile/questions";
import type {
  StudyProfileAnswerId,
  StudyProfileDimension,
  StudyProfileQuestionId,
} from "@/lib/study-profile/types";
import {
  completedStudyProfileSnapshot,
  evaluateActivePersonalizationExperiment,
  readPersonalizationStateFromAnswers,
  setPersonalizationControl,
  setPersonalizationWorkspaceSetting,
  stopPersonalizationExperiment,
  updatePersonalizationStateInAnswers,
  upsertPersonalizationCorrection,
  withStudyProfileAnswer,
  type PersonalizationControls,
  type PersonalizationState,
  type PersonalizationWorkspaceSettings,
} from "@/lib/personalization/personalization-state";
import styles from "./personalization-center.module.css";

export type PersonalizationEvidenceKind =
  | "self_report"
  | "today"
  | "seen_once"
  | "repeated"
  | "tested"
  | "mixed"
  | "paused";

export type PersonalizationCenterSignal = {
  id: string;
  signal: string;
  visibleResult: string;
  evidence: PersonalizationEvidenceKind;
  evidenceDetail?: string;
  explanation?: string;
  canCorrect?: boolean;
  canPause?: boolean;
  status?: "suggested" | "applied";
};

export type PersonalizationTendency = {
  id: StudyProfileDimension;
  label?: string;
  summary: string;
  visibleResult: string;
  evidence?: PersonalizationEvidenceKind;
  evidenceDetail?: string;
};

export type PersonalizationSuggestion = {
  id: string;
  title: string;
  explanation: string;
  evidence?: string;
  actionLabel?: string;
};

export type PersonalizationDecision = {
  id: string;
  title: string;
  explanation: string;
  changes?: string[];
  status?: "suggested" | "applied";
  actionLabel?: string;
};

export type PersonalizationReceipt = {
  title?: string;
  because: string;
  changed: string;
  check?: string;
  actionLabel?: string;
};

export type PersonalizationWeeklyReview = {
  title?: string;
  summary: string;
  facts: string[];
  pattern?: string;
  proposedChange?: string;
  actionLabel?: string;
};

export type PersonalizationEnergySuggestion = {
  title?: string;
  recommendedWindow: string;
  explanation: string;
  evidence: string;
  actionLabel?: string;
};

export type PersonalizationHistoryItem = {
  id: string;
  occurredAt: string;
  title: string;
  reason: string;
  status?: string;
  canUndo?: boolean;
};

export type PersonalizationExperimentProgress = {
  completedSessions: number;
  targetSessions: number;
  measure: string;
};

export type PersonalizationOptionalQuestionPrompt = {
  questionId: StudyProfileQuestionId;
  reason: string;
  changes: string;
};

export type PersonalizationCenterProps = {
  answers: readonly string[];
  onAnswersChange: (answers: string[]) => void;
  signals?: PersonalizationCenterSignal[];
  tendencies?: PersonalizationTendency[];
  suggestions?: PersonalizationSuggestion[];
  decisions?: PersonalizationDecision[];
  receipt?: PersonalizationReceipt | null;
  weeklyReview?: PersonalizationWeeklyReview | null;
  energySuggestion?: PersonalizationEnergySuggestion | null;
  history?: PersonalizationHistoryItem[];
  experimentProgress?: PersonalizationExperimentProgress | null;
  optionalQuestionPrompt?: PersonalizationOptionalQuestionPrompt | null;
  onSuggestionAction?: (id: string) => void;
  onDecisionAction?: (id: string) => void;
  onReceiptAction?: () => void;
  onWeeklyReview?: () => void;
  onAcceptEnergySuggestion?: () => void;
  onDismissEnergySuggestion?: () => void;
  onUndoHistory?: (id: string) => void;
};

const EVIDENCE_LABELS: Record<PersonalizationEvidenceKind, string> = {
  self_report: "You told YOVA",
  today: "For today",
  seen_once: "Seen once",
  repeated: "Repeated pattern",
  tested: "Tested",
  mixed: "Mixed evidence",
  paused: "Paused by you",
};

const TENDENCY_META: ReadonlyArray<{
  id: StudyProfileDimension;
  title: string;
  emptySummary: string;
  emptyResult: string;
  Icon: typeof CirclePlay;
}> = [
  {
    id: "starting_friction",
    title: "Starting",
    emptySummary: "How easily a plan turns into a first real action.",
    emptyResult: "Can change the size and clarity of the first step.",
    Icon: CirclePlay,
  },
  {
    id: "structure_need",
    title: "Structure",
    emptySummary: "How much visible order helps you begin and continue.",
    emptyResult: "Can change how much of the session path is shown.",
    Icon: ListChecks,
  },
  {
    id: "attention_variability",
    title: "Attention",
    emptySummary: "How steadily attention holds across active work.",
    emptyResult: "Can change checkpoints and planned activity switches.",
    Icon: Focus,
  },
  {
    id: "calibration_risk",
    title: "Confidence checking",
    emptySummary: "How closely confidence matches closed-note performance.",
    emptyResult: "Can add predictions and confidence comparisons.",
    Icon: SearchCheck,
  },
  {
    id: "mistake_sensitivity",
    title: "Handling mistakes",
    emptySummary: "How uncertainty affects the first attempt and repair.",
    emptyResult: "Can change how feedback and retries are introduced.",
    Icon: ShieldCheck,
  },
  {
    id: "cognitive_stamina",
    title: "Study stamina",
    emptySummary: "How usable focus changes during demanding work.",
    emptyResult: "Can change block shape and timing suggestions.",
    Icon: BatteryMedium,
  },
];

const WORKSPACE_GROUPS: ReadonlyArray<{
  key: keyof PersonalizationWorkspaceSettings;
  title: string;
  description: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}> = [
  {
    key: "layout",
    title: "Session path",
    description: "Choose how much of the path stays visible while you work.",
    options: [
      { value: "automatic", label: "Let YOVA decide" },
      { value: "one_step", label: "One step" },
      { value: "full_path", label: "Full path" },
    ],
  },
  {
    key: "textDensity",
    title: "Text amount",
    description: "Reduce supporting text without removing required ideas.",
    options: [
      { value: "automatic", label: "Let YOVA decide" },
      { value: "standard", label: "Standard" },
      { value: "reduced", label: "Less text" },
    ],
  },
  {
    key: "motion",
    title: "Motion",
    description: "Control decorative motion in the study workspace.",
    options: [
      { value: "automatic", label: "Use device setting" },
      { value: "standard", label: "Standard" },
      { value: "reduced", label: "Reduced" },
    ],
  },
  {
    key: "visualStructure",
    title: "Section borders",
    description: "Make the borders around existing session sections easier to see.",
    options: [
      { value: "automatic", label: "Let YOVA decide" },
      { value: "standard", label: "Standard" },
      { value: "more", label: "Stronger borders" },
    ],
  },
  {
    key: "checkIns",
    title: "Progress highlight",
    description: "Highlight the existing session progress area. This does not add more check-ins.",
    options: [
      { value: "automatic", label: "Let YOVA decide" },
      { value: "standard", label: "Standard" },
      { value: "more", label: "Highlight progress" },
    ],
  },
];

const CONTROL_COPY: ReadonlyArray<{
  key: keyof PersonalizationControls;
  title: string;
  description: string;
}> = [
  { key: "selfReport", title: "Use what I tell YOVA", description: "Use profile answers and corrections in future sessions." },
  { key: "behavior", title: "Learn from my study activity", description: "Use repeated study behavior for optional personalization suggestions. Answer results still protect your learning progress." },
  { key: "timing", title: "Suggest timing improvements", description: "Compare completed work across time windows before suggesting a move." },
  { key: "experiments", title: "Suggest personal tests", description: "Offer one optional comparison at a time. Nothing starts without approval." },
  { key: "optionalQuestions", title: "Ask optional profile questions", description: "Offer occasional questions that explain what their answer would change." },
  { key: "receipts", title: "Show personalization proof", description: "Show a receipt only when something meaningful changed." },
];

const QUESTION_IMPACT_COPY: Record<StudyProfileQuestionId, string> = {
  q1: "Helps YOVA recommend how small and clear your first study step should be.",
  q2: "Helps YOVA recommend a direct start or a little setup before your first attempt.",
  q3: "Helps YOVA recommend how much of the session path to show at once.",
  q4: "Helps YOVA recommend how clearly tasks should be ordered before you begin.",
  q5: "Helps YOVA recommend block length and where to place checkpoints.",
  q6: "Helps YOVA recommend whether to keep one activity or switch activity types at checkpoints.",
  q7: "Helps YOVA recommend when to use closed-note recall instead of more rereading.",
  q8: "Helps YOVA recommend when to compare your confidence with checked answers.",
  q9: "Helps YOVA recommend whether to offer a hint before or after your first attempt.",
  q10: "Helps YOVA recommend how to frame rough attempts, feedback, and retries.",
  q11: "Helps YOVA recommend shorter blocks or reset points during demanding work.",
  q12: "Helps YOVA decide whether a timing recommendation may be useful.",
};

export function PersonalizationCenter({
  answers,
  onAnswersChange,
  signals = [],
  tendencies = [],
  suggestions = [],
  decisions = [],
  receipt = null,
  weeklyReview = null,
  energySuggestion = null,
  history = [],
  experimentProgress = null,
  optionalQuestionPrompt = null,
  onSuggestionAction,
  onDecisionAction,
  onReceiptAction,
  onWeeklyReview,
  onAcceptEnergySuggestion,
  onDismissEnergySuggestion,
  onUndoHistory,
}: PersonalizationCenterProps) {
  const headingId = useId();
  const [deepeningOpen, setDeepeningOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [expandedSignalId, setExpandedSignalId] = useState<string | null>(null);
  const [correctingSignalId, setCorrectingSignalId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [doNotInfer, setDoNotInfer] = useState(false);

  const state = useMemo(() => readPersonalizationStateFromAnswers(answers), [answers]);
  const snapshot = useMemo(() => completedStudyProfileSnapshot(state), [state]);
  const answeredQuestionCount = Object.keys(state.studyProfile.answers).length;
  const tendencyById = useMemo(
    () => new Map(tendencies.map((tendency) => [tendency.id, tendency])),
    [tendencies],
  );
  const currentQuestion = STUDY_PROFILE_QUESTIONS[questionIndex];
  const currentQuestionImpact = currentQuestion
    ? optionalQuestionPrompt?.questionId === currentQuestion.id
      ? optionalQuestionPrompt.changes
      : QUESTION_IMPACT_COPY[currentQuestion.id]
    : null;
  const activeExperiment = state.activeExperiment;
  const savedExperimentProgress = useMemo(
    () => evaluateActivePersonalizationExperiment(activeExperiment),
    [activeExperiment],
  );

  const saveState = (update: (current: PersonalizationState) => PersonalizationState) => {
    onAnswersChange(updatePersonalizationStateInAnswers(answers, update));
  };

  const setSignalPaused = (signalId: string, paused: boolean) => {
    saveState((current) => ({
      ...current,
      pausedSignalIds: paused
        ? [...new Set([...current.pausedSignalIds, signalId])]
        : current.pausedSignalIds.filter((id) => id !== signalId),
    }));
  };

  const saveCorrection = (signalId: string) => {
    const note = correctionText.trim();
    if (!note && !doNotInfer) return;
    saveState((current) => upsertPersonalizationCorrection(current, {
      signalId,
      correctedValue: null,
      note: note || null,
      doNotInfer,
      updatedAt: new Date().toISOString(),
    }));
    setCorrectingSignalId(null);
    setCorrectionText("");
    setDoNotInfer(false);
  };

  const removeCorrection = (signalId: string) => {
    saveState((current) => ({
      ...current,
      corrections: current.corrections.filter((item) => item.signalId !== signalId),
    }));
    setCorrectingSignalId(null);
    setCorrectionText("");
    setDoNotInfer(false);
  };

  const answerStudyProfileQuestion = (
    questionId: StudyProfileQuestionId,
    answer: StudyProfileAnswerId,
  ) => {
    saveState((current) => {
      const next = withStudyProfileAnswer(current, questionId, answer);
      const complete = STUDY_PROFILE_QUESTIONS.every((question) => Boolean(next.studyProfile.answers[question.id]));
      return complete && !next.studyProfile.completedAt
        ? { ...next, studyProfile: { ...next.studyProfile, completedAt: new Date().toISOString() } }
        : next;
    });
  };

  const moveQuestion = (direction: 1 | -1) => {
    setQuestionIndex((current) => (
      current + direction + STUDY_PROFILE_QUESTIONS.length
    ) % STUDY_PROFILE_QUESTIONS.length);
  };

  const moveAnswerSelection = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => {
    if (!currentQuestion) return;
    const lastIndex = currentQuestion.options.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? (optionIndex + 1) % currentQuestion.options.length
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? (optionIndex - 1 + currentQuestion.options.length) % currentQuestion.options.length
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextOption = currentQuestion.options[nextIndex];
    answerStudyProfileQuestion(currentQuestion.id, nextOption.id);
    const radioButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    radioButtons?.[nextIndex]?.focus();
  };

  const openDeepening = (dimension?: StudyProfileDimension) => {
    const index = dimension
      ? STUDY_PROFILE_QUESTIONS.findIndex((question) => question.dimension === dimension && !state.studyProfile.answers[question.id])
      : optionalQuestionPrompt && !state.studyProfile.answers[optionalQuestionPrompt.questionId]
        ? STUDY_PROFILE_QUESTIONS.findIndex((question) => question.id === optionalQuestionPrompt.questionId)
        : STUDY_PROFILE_QUESTIONS.findIndex((question) => !state.studyProfile.answers[question.id]);
    setQuestionIndex(index >= 0 ? index : 0);
    setDeepeningOpen(true);
  };

  const setWorkspaceValue = (
    key: keyof PersonalizationWorkspaceSettings,
    value: string,
  ) => {
    saveState((current) => setPersonalizationWorkspaceSetting(
      current,
      key,
      value as PersonalizationWorkspaceSettings[typeof key],
      new Date().toISOString(),
    ));
  };

  const setControlValue = (key: keyof PersonalizationControls, enabled: boolean) => {
    saveState((current) => setPersonalizationControl(
      current,
      key,
      enabled,
      new Date().toISOString(),
    ));
  };

  const stopExperiment = () => {
    if (!activeExperiment) return;
    saveState((current) => stopPersonalizationExperiment(current, new Date().toISOString()));
  };

  return (
    <section className={styles.center} aria-labelledby={headingId}>
      <header className={styles.hero}>
        <div className={styles.heroIcon}><Sparkles size={20} /></div>
        <div>
          <span className={styles.eyebrow}>Usually me</span>
          <h2 id={headingId}>How YOVA is adapting to you</h2>
          <p>See what YOVA has applied, what it is only recommending, and the evidence behind each one. These are working patterns, not fixed labels.</p>
        </div>
      </header>

      <div className={styles.signalHead} aria-hidden="true">
        <span>Study pattern</span><span>Evidence</span><span>Personalization</span><span />
      </div>
      <div className={styles.signalList}>
        {signals.length > 0 ? signals.map((signal, signalIndex) => {
          const correction = state.corrections.find((item) => item.signalId === signal.id);
          const manuallyPaused = state.pausedSignalIds.includes(signal.id);
          const paused = manuallyPaused || correction?.doNotInfer === true;
          const expanded = expandedSignalId === signal.id;
          const detailsId = `${headingId}-signal-details-${signalIndex}`;
          const signalStatus = signal.status ?? (/^\s*applied:/i.test(signal.visibleResult) ? "applied" : "suggested");
          const visibleResult = signal.visibleResult.replace(/^\s*(applied|recommendation):\s*/i, "");
          return (
            <article className={`${styles.signalRow} ${paused ? styles.paused : ""}`} key={signal.id}>
              <div className={styles.signalName}><strong>{signal.signal}</strong>{paused && <small>Suggestions paused</small>}</div>
              <EvidenceBadge kind={signal.evidence} detail={signal.evidenceDetail} />
              <div className={styles.visibleResult}>
                <StatusBadge status={paused ? "paused" : signalStatus} />
                <span>{visibleResult}</span>
                {correction?.note && <small>{correction.doNotInfer ? "Not used for future suggestions" : "Context you added"}: {correction.note}</small>}
              </div>
              <div className={styles.rowActions}>
                {(signal.explanation || signal.canCorrect || signal.canPause) && (
                  <button type="button" className={styles.iconButton} aria-expanded={expanded} aria-controls={detailsId} aria-label={`Review ${signal.signal}`} onClick={() => setExpandedSignalId(expanded ? null : signal.id)}><ChevronDown size={17} /></button>
                )}
              </div>
              {expanded && (
                <div className={styles.signalDetails} id={detailsId}>
                  {signal.explanation && <p>{signal.explanation}</p>}
                  <div className={styles.detailActions}>
                    {signal.canCorrect !== false && <button type="button" onClick={() => { setCorrectingSignalId(signal.id); setCorrectionText(correction?.note ?? ""); setDoNotInfer(correction?.doNotInfer ?? false); }}><PencilLine size={15} /> Add context</button>}
                    {signal.canPause !== false && !correction?.doNotInfer && <button type="button" onClick={() => setSignalPaused(signal.id, !manuallyPaused)}>{manuallyPaused ? <Play size={15} /> : <Pause size={15} />}{manuallyPaused ? "Resume suggestions" : "Pause suggestions"}</button>}
                    {correction && <button type="button" onClick={() => removeCorrection(signal.id)}><RotateCcw size={15} /> Remove saved context</button>}
                  </div>
                  {correctingSignalId === signal.id && (
                    <div className={styles.correctionForm}>
                      <label><span>Add context for YOVA to consider</span><textarea rows={3} maxLength={500} value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} placeholder="Example: Those sessions ended because I was interrupted, not because the work was too long." /></label>
                      <p className={styles.correctionHelp}>A note adds context. It does not turn off this pattern by itself.</p>
                      <label className={styles.checkbox}><input type="checkbox" checked={doNotInfer} onChange={(event) => setDoNotInfer(event.target.checked)} /><span>Do not use this pattern for future suggestions</span></label>
                      <div><button type="button" onClick={() => setCorrectingSignalId(null)}>Cancel</button><button type="button" className={styles.primarySmall} disabled={!correctionText.trim() && !doNotInfer} onClick={() => saveCorrection(signal.id)}>Save</button></div>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        }) : (
          <div className={styles.emptyState}><Eye size={18} /><p>YOVA needs profile answers or real session activity before it can show a supported personalization change.</p></div>
        )}
      </div>

      {receipt && state.controls.receipts && (
        <section className={styles.receipt} aria-label="Personalization proof">
          <Sparkles size={18} />
          <div><span>{receipt.title ?? "Why this was different"}</span><StatusBadge status="applied" /><p><strong>Because:</strong> {receipt.because}</p><p><strong>YOVA changed:</strong> {receipt.changed}</p>{receipt.check && <small><strong>Next check:</strong> {receipt.check}</small>}</div>
          {onReceiptAction && <button type="button" onClick={onReceiptAction}>{receipt.actionLabel ?? "Got it"}</button>}
        </section>
      )}

      <details className={styles.section}>
        <summary><span className={styles.sectionIcon}><SlidersHorizontal size={18} /></span><div><strong>Your study tendencies</strong><small>{answeredQuestionCount} of 12 optional questions answered</small></div><ChevronDown size={18} /></summary>
        <div className={styles.sectionBody}>
          <p className={styles.sectionIntro}>These describe current study habits and preferences. They do not describe a brain type or ability.</p>
          <div className={styles.tendencyGrid}>
            {TENDENCY_META.map(({ id, title, emptySummary, emptyResult, Icon }) => {
              const supplied = tendencyById.get(id);
              const score = snapshot?.scores[id];
              const profileContent = score ? STUDY_PROFILE_DIMENSION_CONTENT[id].levels[score.classification] : null;
              const calibrationAdaptation = id === "calibration_risk" && snapshot
                ? STUDY_PROFILE_CALIBRATION_PRODUCT_ADAPTATIONS[snapshot.calibrationDirection]
                : null;
              const standardAdaptation = score ? STUDY_PROFILE_PRODUCT_ADAPTATIONS[id][score.classification] : null;
              const answeredForDimension = STUDY_PROFILE_QUESTIONS.filter((question) => question.dimension === id && state.studyProfile.answers[question.id]).length;
              const summary = supplied?.summary ?? profileContent?.summary ?? emptySummary;
              const result = supplied?.visibleResult ?? calibrationAdaptation?.detail ?? standardAdaptation?.detail ?? emptyResult;
              return (
                <article className={styles.tendencyCard} key={id}>
                  <header><span><Icon size={17} /></span><div><strong>{title}</strong><small>{supplied?.label ?? score?.userFacingLabel ?? `${answeredForDimension} of 2 answered`}</small></div></header>
                  <p>{summary}</p>
                  <div className={styles.tendencyResult}><span>What this can change</span><strong>{result}</strong></div>
                  {(supplied?.evidence || score) && <EvidenceBadge kind={supplied?.evidence ?? "self_report"} detail={supplied?.evidenceDetail} compact />}
                  {answeredForDimension < 2 && state.controls.optionalQuestions && <button type="button" className={styles.textAction} onClick={() => openDeepening(id)}>Answer an optional question</button>}
                </article>
              );
            })}
          </div>

          {state.controls.optionalQuestions && (
            <div className={styles.deepenBlock}>
              <div><strong>Want deeper personalization?</strong><p>{optionalQuestionPrompt?.reason ?? "Answer one question now or stop at any time. Each answer changes a specific part of YOVA."}</p>{optionalQuestionPrompt && <small>{optionalQuestionPrompt.changes}</small>}</div>
              <button type="button" onClick={() => openDeepening()}>{answeredQuestionCount ? "Continue questions" : "Answer one question"}</button>
            </div>
          )}

          {deepeningOpen && state.controls.optionalQuestions && currentQuestion && (
            <section className={styles.questionCard} aria-labelledby={`${headingId}-question`}>
              <header><div><span>Optional · Question {questionIndex + 1} of {STUDY_PROFILE_QUESTIONS.length}</span><h3 id={`${headingId}-question`}>{currentQuestion.prompt}</h3></div><button type="button" onClick={() => setDeepeningOpen(false)}>Done for now</button></header>
              <p id={`${headingId}-question-help`}>Choose what is most often true. You can change this later. Use the arrow keys to move between choices.</p>
              {currentQuestionImpact && <p className={styles.questionImpact} id={`${headingId}-question-impact`}><strong>What this question can change:</strong> {currentQuestionImpact}</p>}
              <div className={styles.answerList} role="radiogroup" aria-label={`Answers for question ${questionIndex + 1}`} aria-describedby={`${headingId}-question-help ${headingId}-question-impact`}>
                {currentQuestion.options.map((option, optionIndex) => {
                  const selected = state.studyProfile.answers[currentQuestion.id] === option.id;
                  const hasSelectedAnswer = Boolean(state.studyProfile.answers[currentQuestion.id]);
                  return <button type="button" role="radio" aria-checked={selected} tabIndex={selected || (!hasSelectedAnswer && optionIndex === 0) ? 0 : -1} className={selected ? styles.answerSelected : ""} key={option.id} onKeyDown={(event) => moveAnswerSelection(event, optionIndex)} onClick={() => answerStudyProfileQuestion(currentQuestion.id, option.id)}><span aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span><strong>{option.label}</strong>{selected && <Check size={15} aria-hidden="true" />}</button>;
                })}
              </div>
              <footer><button type="button" onClick={() => moveQuestion(-1)}>Previous</button><button type="button" onClick={() => moveQuestion(1)}>{state.studyProfile.answers[currentQuestion.id] ? "Next question" : "Skip"}</button></footer>
            </section>
          )}
        </div>
      </details>

      {(suggestions.length > 0 || decisions.length > 0) && (
        <section className={styles.recommendations}>
          <header><Settings2 size={18} /><div><strong>Personalization activity</strong><small>Applied changes and optional recommendations</small></div></header>
          {[...suggestions, ...decisions].slice(0, 3).map((item) => {
            const isDecision = "changes" in item;
            const status = isDecision ? item.status ?? "suggested" : "suggested";
            return (
              <article key={item.id}>
                <div><StatusBadge status={status} /><strong>{item.title}</strong><p>{item.explanation}</p>{"evidence" in item && item.evidence && <small>{item.evidence}</small>}{isDecision && item.changes?.length ? <ul>{item.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}</div>
                {item.actionLabel && <button type="button" onClick={() => isDecision ? onDecisionAction?.(item.id) : onSuggestionAction?.(item.id)}>{item.actionLabel}</button>}
              </article>
            );
          })}
        </section>
      )}

      {(weeklyReview || energySuggestion) && (
        <div className={styles.insightGrid}>
          {weeklyReview && <article className={styles.insightCard}><span><Clock3 size={18} /></span><div><small>Weekly review</small><h3>{weeklyReview.title ?? "Your week with YOVA"}</h3><p>{weeklyReview.summary}</p><ul>{weeklyReview.facts.slice(0, 3).map((fact) => <li key={fact}>{fact}</li>)}</ul>{weeklyReview.pattern && <p className={styles.patternNote}><strong>Working pattern:</strong> {weeklyReview.pattern}</p>}{weeklyReview.proposedChange && <p className={styles.changeNote}><strong>One change to consider:</strong> {weeklyReview.proposedChange}</p>}{weeklyReview.actionLabel && onWeeklyReview && <button type="button" onClick={onWeeklyReview}>{weeklyReview.actionLabel}</button>}</div></article>}
          {energySuggestion && state.controls.timing && <article className={styles.insightCard}><span><CalendarClock size={18} /></span><div><small>Timing suggestion</small><h3>{energySuggestion.title ?? `Try more demanding work in the ${energySuggestion.recommendedWindow}`}</h3><p>{energySuggestion.explanation}</p><em>{energySuggestion.evidence}</em><div className={styles.insightActions}>{onDismissEnergySuggestion && <button type="button" onClick={onDismissEnergySuggestion}>Not now</button>}{onAcceptEnergySuggestion && <button type="button" className={styles.primarySmall} onClick={onAcceptEnergySuggestion}>{energySuggestion.actionLabel ?? "Review suggestion"}</button>}</div></div></article>}
        </div>
      )}

      {activeExperiment && state.controls.experiments && (
        <section className={styles.experiment}>
          <div className={styles.experimentIcon}><FlaskConical size={19} /></div>
          <div className={styles.experimentCopy}><span>YOVA is testing</span><h3>{activeExperiment.variantA} or {activeExperiment.variantB}</h3><p>Only this one feature changes. YOVA will compare similar work and will not turn the result into a fixed learner label.</p><div><strong>{experimentProgress ? `${experimentProgress.completedSessions} of ${experimentProgress.targetSessions} comparable sessions` : `${savedExperimentProgress.sessionsA + savedExperimentProgress.sessionsB} completed · ${activeExperiment.minimumSessionsPerVariant} per option needed`}</strong><small>{experimentProgress?.measure ?? `${savedExperimentProgress.checkedAnswers} checked answers · completion, accuracy, and challenge feedback`}</small></div></div>
          <button type="button" onClick={stopExperiment}>Stop test</button>
        </section>
      )}

      <details className={styles.section}>
        <summary><span className={styles.sectionIcon}><Settings2 size={18} /></span><div><strong>Study workspace</strong><small>Change how sessions look and feel</small></div><ChevronDown size={18} /></summary>
        <div className={styles.sectionBody}>
          <p className={styles.sectionIntro}>These settings change presentation, not what counts as learned.</p>
          <div className={styles.workspaceList}>
            {WORKSPACE_GROUPS.map((group) => (
              <fieldset key={group.key}>
                <legend>{group.title}</legend><p>{group.description}</p>
                <div>{group.options.map((option) => { const selected = state.workspace[group.key] === option.value; return <button type="button" aria-pressed={selected} className={selected ? styles.choiceSelected : ""} key={option.value} onClick={() => setWorkspaceValue(group.key, option.value)}>{selected && <Check size={13} />}{option.label}</button>; })}</div>
              </fieldset>
            ))}
          </div>
        </div>
      </details>

      <details className={styles.section}>
        <summary><span className={styles.sectionIcon}><ShieldCheck size={18} /></span><div><strong>Personalization controls</strong><small>You decide which information YOVA may use</small></div><ChevronDown size={18} /></summary>
        <div className={styles.sectionBody}>
          <div className={styles.controlList}>
            {CONTROL_COPY.map((control) => (
              <div key={control.key}><div><strong>{control.title}</strong><p id={`${headingId}-${control.key}-description`}>{control.description}</p></div><button type="button" role="switch" aria-checked={state.controls[control.key]} aria-label={`${control.title}: ${state.controls[control.key] ? "on" : "off"}`} aria-describedby={`${headingId}-${control.key}-description`} className={state.controls[control.key] ? styles.switchOn : styles.switchOff} onClick={() => setControlValue(control.key, !state.controls[control.key])}><span aria-hidden="true" /></button></div>
            ))}
          </div>
        </div>
      </details>

      {(history.length > 0 || state.experimentHistory.length > 0 || state.corrections.length > 0) && (
        <details className={styles.section}>
          <summary><span className={styles.sectionIcon}><HistoryIcon size={18} /></span><div><strong>Personalization history</strong><small>Changes, corrections, tests, and reversals</small></div><ChevronDown size={18} /></summary>
          <div className={styles.sectionBody}>
            <div className={styles.historyList}>
              {history.map((item) => <article key={item.id}><span><RotateCcw size={15} /></span><div><small>{formatDate(item.occurredAt)}{item.status ? ` · ${item.status}` : ""}</small><strong>{item.title}</strong><p>{item.reason}</p></div>{item.canUndo && onUndoHistory && <button type="button" onClick={() => onUndoHistory(item.id)}>Undo</button>}</article>)}
              {state.experimentHistory.map((item) => <article key={`experiment-${item.id}-${item.completedAt}`}><span><FlaskConical size={15} /></span><div><small>{formatDate(item.completedAt)} · {experimentResultLabel(item.result)}</small><strong>Personal test finished</strong><p>{item.summary}</p></div></article>)}
              {state.corrections.map((item) => <article key={`correction-${item.signalId}`}><span><PencilLine size={15} /></span><div><small>{formatDate(item.updatedAt)} · {item.doNotInfer ? "Future suggestions stopped" : "Context added"}</small><strong>{item.signalId.replaceAll("_", " ")}</strong><p>{item.note ?? "YOVA will not use this pattern for future suggestions."}</p></div></article>)}
            </div>
          </div>
        </details>
      )}
    </section>
  );
}

function EvidenceBadge({ kind, detail, compact = false }: { kind: PersonalizationEvidenceKind; detail?: string; compact?: boolean }) {
  const Icon = kind === "self_report"
    ? UserRound
    : kind === "today"
      ? CalendarClock
      : kind === "seen_once"
        ? Eye
        : kind === "repeated"
          ? RotateCcw
          : kind === "paused"
            ? Pause
            : kind === "mixed"
              ? SearchCheck
              : FlaskConical;
  return <span className={`${styles.evidenceBadge} ${styles[kind]} ${compact ? styles.compactBadge : ""}`}><Icon size={13} aria-hidden="true" /><span>{EVIDENCE_LABELS[kind]}</span>{detail && <small>{detail}</small>}</span>;
}

function StatusBadge({ status }: { status: "suggested" | "applied" | "paused" }) {
  const label = status === "applied" ? "Applied" : status === "paused" ? "Suggestions paused" : "Recommendation";
  return <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>{label}</span>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function experimentResultLabel(result: "promising_a" | "promising_b" | "mixed" | "stopped") {
  if (result === "mixed") return "Mixed result";
  if (result === "stopped") return "Stopped";
  return "Promising result";
}
